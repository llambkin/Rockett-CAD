import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCUMENT_EDITS, pathFor, type CadDocument } from "@rockett/shared";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(() => app.close());

async function create(name: string): Promise<CadDocument> {
  const res = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return ((await res.json()) as { document: CadDocument }).document;
}

const rename = (id: string, name: string, ifMatch?: string) =>
  app.request(`/api/projects/${id}/rename`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ifMatch !== undefined && { "If-Match": ifMatch }),
    },
    body: JSON.stringify({ name }),
  });

describe("document revision preconditions", () => {
  it("sends the document revision as the ETag of a project read", async () => {
    const doc = await create("Read");
    const res = await app.request(`/api/projects/${doc.id}`);
    expect(res.headers.get("ETag")).toBe(`"${doc.revision}"`);
  });

  it("keeps the first of two writers from the same revision", async () => {
    const doc = await create("Start");
    const r = doc.revision;
    const first = await rename(doc.id, "First", `"${r}"`);
    expect(first.status).toBe(200);
    expect(first.headers.get("ETag")).toBe(`"${r + 1}"`);
    const second = await rename(doc.id, "Second", `"${r}"`);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      code: "conflict",
      revision: r + 1,
    });
    const stored = await app.store.load(doc.id);
    expect(stored.name).toBe("First");
    expect(stored.revision).toBe(r + 1);
  });

  it("answers 428 without writing when If-Match is missing", async () => {
    const doc = await create("Unchanged");
    const res = await rename(doc.id, "Changed");
    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ code: "precondition_required" });
    expect((await app.store.load(doc.id)).name).toBe("Unchanged");
  });

  it("rejects an If-Match that is not a quoted revision", async () => {
    const doc = await create("Malformed");
    expect((await rename(doc.id, "x", "*")).status).toBe(400);
  });

  it.each([...DOCUMENT_EDITS].map((route) => [route.method, route.path]))(
    "%s %s requires If-Match",
    async (method, routePath) => {
      const doc = await create("Every edit");
      const route = [...DOCUMENT_EDITS].find(
        (r) => r.method === method && r.path === routePath,
      )!;
      const res = await app.request(
        `/api${pathFor(route, { id: doc.id, fid: "f1", bodyId: "b1" })}`,
        {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: 0, groups: [] }),
        },
      );
      expect(res.status).toBe(428);
    },
  );

  it("lists each readable project with its revision", async () => {
    const doc = await create("Listed");
    const list = (await (await app.request("/api/projects")).json()) as Array<{
      id: string;
      revision?: number;
    }>;
    expect(list.find((p) => p.id === doc.id)?.revision).toBe(doc.revision);
  });
});
