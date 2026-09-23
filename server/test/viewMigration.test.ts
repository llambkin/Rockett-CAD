import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

const fixture = await fs.readFile(
  path.join(import.meta.dirname, "fixtures", "schema", "v10.json"),
  "utf8",
);
const id = "schema-v10";
const hidden = {
  version: 1,
  hidden: { bodies: ["b:ext1"], features: ["sk1"] },
};

let app: TestApp;

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

const file = (name: string) => path.join(app.dataDir, "projects", id, name);

async function call(
  method: string,
  url: string,
  body?: unknown,
  revision?: number,
) {
  const res = await app.request(`/api${url}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const type = res.headers.get("content-type") ?? "";
  return {
    status: res.status,
    body: type.includes("json") ? await res.json() : undefined,
  };
}

const sketch = (doc: { features: Array<{ id: string }> }) =>
  doc.features.find((f) => f.id === "sk1");

describe("view migration", () => {
  beforeAll(async () => {
    await fs.mkdir(file(""), { recursive: true });
    await fs.writeFile(file("document.json"), fixture);
  });

  it("reports the hidden body and sketch before the document is rewritten", async () => {
    expect(await call("GET", `/projects/${id}/view`)).toEqual({
      status: 200,
      body: hidden,
    });
    const { body } = await call("GET", `/projects/${id}`);
    expect(body.document.schemaVersion).toBe(SCHEMA_VERSION);
    expect(sketch(body.document)).toMatchObject({ visible: false });
    expect(body.document).not.toHaveProperty("camera");
    await expect(fs.stat(file("view.json"))).rejects.toThrow();
  });

  it("moves view facts into view.json when the document is saved, after a backup", async () => {
    const renamed = await call(
      "POST",
      `/projects/${id}/rename`,
      { name: "Migrated" },
      5,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.document.revision).toBe(6);
    const stored = await fs.readFile(file("document.json"), "utf8");
    expect(stored).not.toMatch(/"visible"|"camera"/);
    expect(JSON.parse(stored).bodyMeta).toEqual({
      "b:ext1": { name: "Body1" },
    });
    expect(JSON.parse(await fs.readFile(file("view.json"), "utf8"))).toEqual(
      hidden,
    );
    const backups = path.join(app.dataDir, "backups", "projects", id);
    const [backup] = await fs.readdir(backups);
    expect(backup).toMatch(/^v10-/);
    expect(
      await fs.readFile(
        path.join(backups, backup!, "files", "document.json"),
        "utf8",
      ),
    ).toBe(fixture);
  });

  it("writes a legacy body or feature visible patch to view.json without a revision bump", async () => {
    const before = await fs.readFile(file("document.json"));
    const body = await call(
      "PUT",
      `/projects/${id}/bodies/b:ext1`,
      { visible: true },
      6,
    );
    expect(body.status).toBe(200);
    expect(body.body.document.revision).toBe(6);
    expect(body.body.evaluation.bodies[0]).toMatchObject({
      bodyId: "b:ext1",
      visible: true,
    });
    const feature = await call(
      "PUT",
      `/projects/${id}/features/sk1`,
      { feature: { visible: true } },
      6,
    );
    expect(feature.status).toBe(200);
    expect(feature.body.document.revision).toBe(6);
    expect(sketch(feature.body.document)).toMatchObject({ visible: true });
    expect(await call("GET", `/projects/${id}/view`)).toEqual({
      status: 200,
      body: { version: 1, hidden: { bodies: [], features: [] } },
    });
    expect(await fs.readFile(file("document.json"))).toEqual(before);
  });

  it("exports the bodies view.json leaves visible by default", async () => {
    const exported = () =>
      call("POST", `/projects/${id}/export`, { format: "stl", bodyIds: [] });
    expect((await exported()).status).toBe(200);
    await call("PUT", `/projects/${id}/view`, {
      version: 1,
      hidden: { bodies: ["b:ext1"], features: [] },
    });
    expect(await exported()).toMatchObject({
      status: 400,
      body: { error: "no bodies to export" },
    });
  });
});
