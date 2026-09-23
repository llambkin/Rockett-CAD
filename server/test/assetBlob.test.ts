import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { CadDocument } from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { validateDocument } from "../src/api/validate.js";
import { LocalStorage, type Storage } from "../src/store/storage.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

const fixtures = path.join(import.meta.dirname, "fixtures", "schema");
const v7raw = await fs.readFile(path.join(fixtures, "v7.json"), "utf8");
const v8raw = await fs.readFile(path.join(fixtures, "v8.json"), "utf8");
const v7 = JSON.parse(v7raw);
const v8 = JSON.parse(v8raw);
const inline = Buffer.from(
  v7.features.find((f: { type: string }) => f.type === "importStep").data,
  "utf8",
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const legacyId = "0123456789abcdef.png";
const sha = (data: Buffer) =>
  crypto.createHash("sha256").update(data).digest("hex");
const imageId = sha(png);
const stepId = sha(inline);

let app: TestApp;

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

async function seed(root: string, raw: string, withStepBlob: boolean) {
  const id = JSON.parse(raw).id as string;
  const project = path.join(root, "projects", id);
  await fs.mkdir(path.join(project, "assets"), { recursive: true });
  await fs.writeFile(path.join(project, "document.json"), raw);
  await fs.writeFile(path.join(project, "assets", legacyId), png);
  if (withStepBlob) {
    await fs.mkdir(path.join(project, "blobs"), { recursive: true });
    await fs.writeFile(path.join(project, "blobs", stepId), inline);
  }
  return { id, project };
}

async function exists(file: string) {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

function imageOf(doc: CadDocument) {
  return doc.features.find((f) => f.type === "referenceImage")!;
}

async function geometry(store: ProjectStore, doc: CadDocument) {
  dropEngine(doc.id);
  const engine = engineFor(doc.id);
  const sources = await store.sources(doc);
  const result = engine.evaluate(doc, undefined, sources);
  const body = result.bodies.find((b) => b.bodyId === "b:imp1")!;
  const volume = volumeOf(
    engine.stateAt(doc, undefined, sources).bodies.get("b:imp1")!.shape,
  );
  dropEngine(doc.id);
  return { volume, positions: body.positions, faces: body.faces };
}

describe("reference images in the blob store", () => {
  it("migrates a previous-schema PNG to a blob, serves identical bytes under the new id and drops assets/", async () => {
    const { id, project } = await seed(app.dataDir, v8raw, true);
    const opened = (await (await app.request(`/api/projects/${id}`)).json())
      .document;
    expect(imageOf(opened).assetId).toBe(imageId);
    const early = await app.request(`/api/projects/${id}/assets/${imageId}`);
    expect(early.status).toBe(200);
    expect(Buffer.from(await early.arrayBuffer())).toEqual(png);

    const renamed = await app.request(`/api/projects/${id}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Migrated" }),
    });
    expect(renamed.status).toBe(200);

    expect(await exists(path.join(project, "assets"))).toBe(false);
    expect(await fs.readFile(path.join(project, "blobs", imageId))).toEqual(
      png,
    );
    const saved = JSON.parse(
      await fs.readFile(path.join(project, "document.json"), "utf8"),
    );
    expect(imageOf(saved).assetId).toBe(imageId);
    const served = await app.request(`/api/projects/${id}/assets/${imageId}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(png);
    expect(
      (await app.request(`/api/projects/${id}/assets/${legacyId}`)).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/projects/${id}/assets/${stepId}`)).status,
    ).toBe(404);

    const backups = path.join(app.dataDir, "backups", "projects", id);
    const [backup] = await fs.readdir(backups);
    const files = path.join(backups, backup!, "files");
    expect(await fs.readFile(path.join(files, "assets", legacyId))).toEqual(
      png,
    );
    expect(await fs.readFile(path.join(files, "document.json"), "utf8")).toBe(
      v8raw,
    );
  });

  it("stores an uploaded image as a blob named by its sha256", async () => {
    const created = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Images" }),
    });
    const { document } = await created.json();
    const form = new FormData();
    form.append("image", new Blob([png]), "pixel.png");
    const res = await app.request(`/api/projects/${document.id}/assets`, {
      method: "POST",
      body: form,
    });
    expect(await res.json()).toEqual({ assetId: imageId });
    const project = path.join(app.dataDir, "projects", document.id);
    expect(await fs.readFile(path.join(project, "blobs", imageId))).toEqual(
      png,
    );
    expect(await exists(path.join(project, "assets"))).toBe(false);
  });

  it("round trips a project with inline STEP and a reference image to identical geometry and pixels", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-assetblob-"));
    const { id, project } = await seed(root, v7raw, false);
    const store = new ProjectStore(
      new LocalStorage(root, fs),
      validateDocument,
    );
    const before = await store.load(id);
    expect(imageOf(before).assetId).toBe(imageId);
    const shape = await geometry(store, before);
    expect(shape.volume).toBeCloseTo(6000, 6);
    expect((await store.readAsset(id, imageId)).data).toEqual(png);

    await store.save(before);

    expect(await exists(path.join(project, "assets"))).toBe(false);
    expect(await fs.readFile(path.join(project, "blobs", imageId))).toEqual(
      png,
    );
    expect(await fs.readFile(path.join(project, "blobs", stepId))).toEqual(
      inline,
    );
    const after = await store.load(id);
    expect(await geometry(store, after)).toEqual(shape);
    expect(await store.readAsset(id, imageId)).toEqual({
      data: png,
      mime: "image/png",
    });
    const { revision: _r, savedWith: _s, modifiedAt: _m, ...kept } = after;
    const { revision: _r2, savedWith: _s2, modifiedAt: _m2, ...was } = before;
    expect(kept).toEqual(was);
  });

  it("keeps assets/ and the old document when the backup does not read back", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-assetblob-"));
    const { id, project } = await seed(root, v8raw, true);
    const local = new LocalStorage(root, fs);
    let corrupt = true;
    const storage: Storage = {
      read: async (file) => {
        const data = await local.read(file);
        return corrupt && file.startsWith("backups/") && file.endsWith(".png")
          ? Buffer.concat([data, Buffer.from("x")])
          : data;
      },
      writeAtomic: (file, data) => local.writeAtomic(file, data),
      list: (dir) => local.list(dir),
      files: (dir) => local.files(dir),
      remove: (target) => local.remove(target),
    };
    const store = new ProjectStore(storage, validateDocument);
    await expect(store.save(await store.load(id))).rejects.toThrow(/damaged/);
    expect(await fs.readFile(path.join(project, "assets", legacyId))).toEqual(
      png,
    );
    expect(await fs.readFile(path.join(project, "document.json"), "utf8")).toBe(
      v8raw,
    );

    corrupt = false;
    await store.save(await store.load(id));
    expect(await exists(path.join(project, "assets"))).toBe(false);
  });

  it("gives a duplicate of an unmigrated project its image blob and no assets/", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-assetblob-"));
    const { id } = await seed(root, v8raw, true);
    const store = new ProjectStore(
      new LocalStorage(root, fs),
      validateDocument,
    );
    const copy = await store.duplicate(id);
    const project = path.join(root, "projects", copy.id);
    expect(await fs.readFile(path.join(project, "blobs", imageId))).toEqual(
      png,
    );
    expect(await exists(path.join(project, "assets"))).toBe(false);
    expect(imageOf(copy).assetId).toBe(imageId);
  });

  it("uploads an old project file with a legacy image and downloads it keyed by hash", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([
        JSON.stringify({
          format: "rockett-project",
          version: 1,
          document: v8,
          assets: {
            [legacyId]: png.toString("base64"),
            [stepId]: inline.toString("base64"),
          },
        }),
      ]),
      "old.rockett",
    );
    const up = await app.request("/api/projects/file", {
      method: "POST",
      body: form,
    });
    expect(up.status).toBe(200);
    const { document } = await up.json();
    expect(imageOf(document).assetId).toBe(imageId);
    const file = await (
      await app.request(`/api/projects/${document.id}/file`)
    ).json();
    expect(Object.keys(file.assets).sort()).toEqual([imageId, stepId].sort());
    expect(Buffer.from(file.assets[imageId], "base64")).toEqual(png);
  });
});
