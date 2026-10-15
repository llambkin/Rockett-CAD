import { afterEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  DOCUMENT_EDITS,
  type CadDocument,
  type Feature,
} from "@rockett/shared";
import { api } from "../src/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function server(start: number) {
  let revision = start;
  const calls: Array<{ method: string; url: string; ifMatch: string | null }> =
    [];
  const document = (): CadDocument => ({
    ...createEmptyDocument("p1", "Part"),
    revision,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      calls.push({
        method,
        url,
        ifMatch: new Headers(init.headers).get("If-Match"),
      });
      if (url === "/api/projects")
        return Response.json([
          { id: "p2", name: "Listed", revision: 9, status: "ok" },
        ]);
      if (method !== "GET") revision++;
      const evaluation = {
        bodies: [],
        featureStatuses: [],
        sketches: [],
        planes: [],
        kernelMs: 0,
      };
      if (url.endsWith("/evaluate")) return Response.json(evaluation);
      return Response.json({ document: document(), evaluation });
    }),
  );
  return calls;
}

const sketch = {
  id: "s1",
  type: "sketch",
  name: "",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [],
  constraints: [],
} as Feature;

const edits: Array<[string, (id: string) => Promise<unknown>]> = [
  ["POST /projects/:id/rename", (id) => api.renameProject(id, "New")],
  [
    "PUT /projects/:id/document",
    (id) => api.replaceDocument(id, createEmptyDocument(id, "Undo")),
  ],
  [
    "POST /projects/:id/import-step",
    (id) => api.importStep(new File(["x"], "a.step"), id),
  ],
  ["POST /projects/:id/features", (id) => api.addFeature(id, sketch)],
  [
    "PUT /projects/:id/features/:fid",
    (id) => api.updateFeature(id, "s1", { name: "S" }),
  ],
  ["DELETE /projects/:id/features/:fid", (id) => api.deleteFeature(id, "s1")],
  ["POST /projects/:id/timeline", (id) => api.setTimeline(id, 0)],
  [
    "PUT /projects/:id/bodies/:bodyId",
    (id) => api.updateBody(id, "b1", { name: "B" }),
  ],
  ["PUT /projects/:id/groups", (id) => api.updateGroups(id, [])],
];

it("covers every document edit route", () => {
  expect(new Set(edits.map(([name]) => name))).toEqual(
    new Set([...DOCUMENT_EDITS].map((r) => `${r.method} ${r.path}`)),
  );
});

it("sends the last received revision with each document edit", async () => {
  const calls = server(4);
  await api.getProject("p1");
  let expected = 4;
  for (const [, edit] of edits) {
    await edit("p1");
    expect(calls.at(-1)!.ifMatch).toBe(`"${expected}"`);
    expected++;
  }
});

it("sends the revision from the project list", async () => {
  const calls = server(0);
  await api.listProjects();
  await api.renameProject("p2", "From the list");
  expect(calls.at(-1)!.ifMatch).toBe('"9"');
});

it("sends no If-Match on reads or project creation", async () => {
  const calls = server(2);
  await api.getProject("p1");
  await api.evaluate("p1");
  await api.createProject("New");
  expect(calls.map((c) => c.ifMatch)).toEqual([null, null, null]);
});
