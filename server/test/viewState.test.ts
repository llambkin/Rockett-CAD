import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CadDocument } from "@rockett/shared";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(() => app?.close());

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(`/api${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

async function created(): Promise<CadDocument> {
  return (await call("POST", "/projects", { name: "View" })).body.document;
}

const hidden = {
  version: 1,
  hidden: { bodies: ["b:extrude-1", "b:extrude-1:2"], features: ["sketch-1"] },
};

const file = (id: string, name: string) =>
  path.join(app.dataDir, "projects", id, name);

describe("project view state", () => {
  it("shows everything before a view is saved", async () => {
    const doc = await created();
    expect(await call("GET", `/projects/${doc.id}/view`)).toEqual({
      status: 200,
      body: { version: 1, hidden: { bodies: [], features: [] } },
    });
  });

  it("round-trips a PUT through view.json without touching the document", async () => {
    const doc = await created();
    const before = await fs.readFile(file(doc.id, "document.json"));
    const put = await call("PUT", `/projects/${doc.id}/view`, hidden);
    expect(put).toEqual({ status: 200, body: hidden });
    expect(await call("GET", `/projects/${doc.id}/view`)).toEqual({
      status: 200,
      body: hidden,
    });
    expect(
      JSON.parse(await fs.readFile(file(doc.id, "view.json"), "utf8")),
    ).toEqual(hidden);
    expect(await fs.readFile(file(doc.id, "document.json"))).toEqual(before);
    const loaded = await call("GET", `/projects/${doc.id}`);
    expect(loaded.body.document.revision).toBe(doc.revision);
  });

  it.each([
    [{ ...hidden, hidden: { bodies: [5], features: [] } }, "/hidden/bodies/0"],
    [{ ...hidden, version: 2 }, "/version"],
    [{ version: 1, hidden: { bodies: [] } }, "/hidden"],
    [{ ...hidden, camera: {} }, "/camera"],
  ])("rejects %j with 400 and writes nothing", async (body, detail) => {
    const doc = await created();
    const res = await call("PUT", `/projects/${doc.id}/view`, body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "validation", detail });
    await expect(fs.stat(file(doc.id, "view.json"))).rejects.toThrow();
  });

  it("answers 404 for a project that does not exist", async () => {
    expect((await call("GET", "/projects/missing/view")).status).toBe(404);
    expect((await call("PUT", "/projects/missing/view", hidden)).status).toBe(
      404,
    );
    await expect(fs.stat(file("missing", "view.json"))).rejects.toThrow();
  });
});
