import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION, type CadDocument } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";
import { trackRevisions } from "./helpers/revisions.js";

const gears = {
  version: 2,
  data: { teeth: 24, module: 1.5, nested: { profile: [0, 1.25, null] } },
};

const sketch = {
  id: "sk",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [],
  constraints: [],
};

let app: TestApp;
const send = trackRevisions((url, init) => app.request(url, init));

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

async function call(method: string, url: string, body?: unknown) {
  const res = await send(`/api${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

async function created(): Promise<CadDocument> {
  return (await call("POST", "/projects", { name: "Gears" })).body.document;
}

describe("document extensions", () => {
  it("starts a new document with no extension data", async () => {
    expect((await created()).extensions).toEqual({});
  });

  it("keeps acme.gears data through PUT /document, a feature edit and a reload", async () => {
    const doc = await created();
    const put = await call("PUT", `/projects/${doc.id}/document`, {
      document: { ...doc, extensions: { "acme.gears": gears } },
    });
    expect(put.status).toBe(200);
    expect(put.body.document.extensions).toEqual({ "acme.gears": gears });
    const added = await call("POST", `/projects/${doc.id}/features`, {
      feature: sketch,
    });
    expect(added.body.document.extensions).toEqual({ "acme.gears": gears });
    const edited = await call("PUT", `/projects/${doc.id}/features/sk`, {
      feature: { name: "Gear sketch" },
    });
    expect(edited.body.document.extensions).toEqual({ "acme.gears": gears });
    const loaded = await call("GET", `/projects/${doc.id}`);
    expect(loaded.body.document.extensions).toEqual({ "acme.gears": gears });
  });

  it.each(["Acme:Gears", "acme..gears", "1acme", "acme.Gears"])(
    "rejects the extension id %s with 400",
    async (key) => {
      const doc = await created();
      const res = await call("PUT", `/projects/${doc.id}/document`, {
        document: { ...doc, extensions: { [key]: gears } },
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("validation");
    },
  );

  it("rejects an extension without its version and data envelope", async () => {
    const doc = await created();
    const res = await call("PUT", `/projects/${doc.id}/document`, {
      document: { ...doc, extensions: { "acme.gears": { teeth: 24 } } },
    });
    expect(res.status).toBe(400);
  });

  it("migrates a schema 9 project to empty extensions and keeps data it already held", async () => {
    const raw = JSON.parse(
      await fs.readFile(
        path.join(import.meta.dirname, "fixtures", "schema", "v9.json"),
        "utf8",
      ),
    );
    for (const [id, extensions] of [
      ["plain-v9", undefined],
      ["gears-v9", { "acme.gears": gears }],
    ] as const) {
      const dir = path.join(app.dataDir, "projects", id);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, "document.json"),
        JSON.stringify({ ...raw, id, ...(extensions && { extensions }) }),
      );
      const loaded = await app.store.load(id);
      expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
      expect(loaded.extensions).toEqual(extensions ?? {});
      const renamed = await call("GET", `/projects/${id}`).then(() =>
        call("POST", `/projects/${id}/rename`, { name: "Saved" }),
      );
      expect(renamed.status).toBe(200);
      const saved = JSON.parse(
        await fs.readFile(path.join(dir, "document.json"), "utf8"),
      );
      expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
      expect(saved.extensions).toEqual(extensions ?? {});
    }
  });
});
