import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(() => app.close());

async function call(method: string, url: string, body?: unknown) {
  const res = await app.request(`/api${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

async function folder(name: string, parentId?: string) {
  const { status, body } = await call("POST", "/folders", { name, parentId });
  expect(status).toBe(200);
  return body.folder.id as string;
}

async function project(name: string, folderId?: string) {
  const { status, body } = await call("POST", "/projects", { name, folderId });
  expect(status).toBe(200);
  return body.document.id as string;
}

const tree = async () => (await call("GET", "/folders")).body;

describe("folders", () => {
  it("creates, renames and moves folders", async () => {
    const brackets = await folder("Brackets");
    const steel = await folder("Steel", brackets);
    expect((await tree()).folders).toEqual(
      expect.arrayContaining([
        { id: brackets, name: "Brackets", parentId: null },
        { id: steel, name: "Steel", parentId: brackets },
      ]),
    );
    const renamed = await call("PATCH", `/folders/${steel}`, { name: "Iron" });
    expect(renamed.body.folder).toEqual({
      id: steel,
      name: "Iron",
      parentId: brackets,
    });
    const moved = await call("PATCH", `/folders/${steel}`, { parentId: null });
    expect(moved.body.folder.parentId).toBeNull();
    const saved = JSON.parse(
      await fs.readFile(
        path.join(app.dataDir, "folders", "folders.json"),
        "utf8",
      ),
    );
    expect(saved.version).toBe(1);
  });

  it("rejects a move that makes a cycle", async () => {
    const a = await folder("A");
    const b = await folder("B", a);
    const c = await folder("C", b);
    for (const parentId of [a, c]) {
      const res = await call("PATCH", `/folders/${a}`, { parentId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("validation");
    }
    const found = (await tree()).folders.find((f: any) => f.id === a);
    expect(found.parentId).toBeNull();
  });

  it("rejects a missing parent", async () => {
    const before = (await tree()).folders.length;
    const created = await call("POST", "/folders", {
      name: "Orphan",
      parentId: "nope",
    });
    expect(created.status).toBe(400);
    const a = await folder("Mover");
    const moved = await call("PATCH", `/folders/${a}`, { parentId: "nope" });
    expect(moved.status).toBe(400);
    expect((await tree()).folders).toHaveLength(before + 1);
    expect((await call("PATCH", "/folders/nope", { name: "X" })).status).toBe(
      404,
    );
  });

  it("deletes only an empty folder", async () => {
    const outer = await folder("Outer");
    const inner = await folder("Inner", outer);
    const res = await call("DELETE", `/folders/${outer}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "conflict",
      error: 'Folder "Outer" is not empty. Move or delete its 1 item first.',
    });
    const id = await project("Held", inner);
    expect((await call("DELETE", `/folders/${inner}`)).status).toBe(409);
    await call("PUT", `/projects/${id}/folder`, { folderId: null });
    expect((await call("DELETE", `/folders/${inner}`)).status).toBe(200);
    expect((await call("DELETE", `/folders/${outer}`)).status).toBe(200);
    const ids = (await tree()).folders.map((f: any) => f.id);
    expect(ids).not.toContain(outer);
    expect(ids).not.toContain(inner);
  });

  it("moves a project between folders and back to the root", async () => {
    const target = await folder("Target");
    const id = await project("Motor mount");
    expect((await tree()).placement[id]).toBeUndefined();
    const moved = await call("PUT", `/projects/${id}/folder`, {
      folderId: target,
    });
    expect(moved.status).toBe(200);
    expect((await tree()).placement[id]).toBe(target);
    const missing = await call("PUT", `/projects/${id}/folder`, {
      folderId: "nope",
    });
    expect(missing.status).toBe(400);
    expect((await tree()).placement[id]).toBe(target);
    await call("PUT", `/projects/${id}/folder`, { folderId: null });
    expect((await tree()).placement[id]).toBeUndefined();
    const gone = await call("PUT", "/projects/000000000000/folder", {
      folderId: target,
    });
    expect(gone.status).toBe(404);
  });

  it("creates a project in a folder in one call", async () => {
    const target = await folder("Landing");
    const id = await project("Lid", target);
    expect((await tree()).placement[id]).toBe(target);
  });

  it("creates nothing when the folder is missing", async () => {
    const before = (await call("GET", "/projects")).body.length;
    const res = await call("POST", "/projects", {
      name: "Stray",
      folderId: "nope",
    });
    expect(res.status).toBe(400);
    expect((await call("GET", "/projects")).body).toHaveLength(before);
  });

  it("drops the placement when the project is deleted", async () => {
    const target = await folder("Bin");
    const id = await project("Doomed", target);
    expect((await call("DELETE", `/projects/${id}`)).status).toBe(200);
    expect((await tree()).placement[id]).toBeUndefined();
    expect((await call("DELETE", `/folders/${target}`)).status).toBe(200);
  });

  it("validates bodies through the schema", async () => {
    const res = await call("POST", "/folders", { name: "" });
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe("/name");
  });
});
