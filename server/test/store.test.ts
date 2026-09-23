import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../src/store/projectStore.js";
import { validateDocument } from "../src/api/validate.js";
import { LocalStorage } from "../src/store/storage.js";
import {
  documentMigrations,
  migrate,
  TooNewError,
} from "../src/store/migrations.js";
import { createEmptyDocument, SCHEMA_VERSION } from "@rockett/shared";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function tempStore(): Promise<ProjectStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-test-"));
  return new ProjectStore(new LocalStorage(dir, fs), validateDocument);
}

describe("project store", () => {
  it("upgrades legacy documents without changing feature history", () => {
    const legacy = {
      ...createEmptyDocument("legacy", "Legacy"),
      schemaVersion: 1,
    };
    const upgraded = migrate(documentMigrations, legacy);
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(upgraded.features).toEqual(legacy.features);
    expect(legacy.schemaVersion).toBe(1);
  });

  it("refuses to load a document from a newer schema", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-test-"));
    const store = new ProjectStore(new LocalStorage(dir, fs), validateDocument);
    const doc = await store.create("Future");
    const file = path.join(dir, "projects", doc.id, "document.json");
    await fs.writeFile(file, JSON.stringify({ ...doc, schemaVersion: 99 }));
    await expect(store.load(doc.id)).rejects.toBeInstanceOf(TooNewError);
    expect(await store.list()).toEqual([
      expect.objectContaining({
        id: doc.id,
        name: "Future",
        status: "tooNew",
        schemaVersion: 99,
        error: expect.stringMatching(/version 99 is newer/),
      }),
    ]);
  });

  it("rejects an invalid stored document with 422 and lists it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-test-"));
    const store = new ProjectStore(new LocalStorage(dir, fs), validateDocument);
    const good = await store.create("Good");
    const bad = await store.create("Broken");
    const file = path.join(dir, "projects", bad.id, "document.json");
    await fs.writeFile(
      file,
      JSON.stringify({ ...bad, features: [{ id: "f1", type: "nope" }] }),
    );
    await expect(store.load(bad.id)).rejects.toMatchObject({
      code: "unprocessable",
      message: `project ${bad.id} is invalid: unknown feature type nope`,
    });
    const list = await store.list();
    expect(list.find((p) => p.id === good.id)?.status).toBe("ok");
    expect(list.find((p) => p.id === bad.id)).toMatchObject({
      name: "Broken",
      featureCount: 1,
      status: "invalid",
      error: `project ${bad.id} is invalid: unknown feature type nope`,
    });
  });

  it("keeps concurrent saves atomic without temporary-file collisions", async () => {
    const store = await tempStore();
    const doc = await store.create("Concurrent");
    const versions = Array.from({ length: 12 }, (_, i) => ({
      ...doc,
      name: `Version ${i}`,
    }));
    const results = await Promise.allSettled(
      versions.map((version) => store.save(version)),
    );
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    const loaded = await store.load(doc.id);
    expect(loaded.name).toBe("Version 11");
  });

  it("creates, saves, and reloads a project with full parametric data", async () => {
    const store = await tempStore();
    const doc = await store.create("My Part");
    doc.features.push({
      id: "sk1",
      type: "sketch",
      name: "Sketch1",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: [{ id: "p1", kind: "point", x: 1.5, y: 2.5 }],
      constraints: [{ id: "c1", type: "fix", point: "p1" }],
    });
    doc.timelinePosition = 1;
    doc.bodyMeta["b:x"] = { name: "Housing", visible: false };
    await store.save(doc);

    const loaded = await store.load(doc.id);
    expect(loaded.name).toBe("My Part");
    expect(loaded.features).toHaveLength(1);
    expect(loaded.features[0]!.type).toBe("sketch");
    expect((loaded.features[0] as any).constraints[0].type).toBe("fix");
    expect(loaded.bodyMeta["b:x"]!.name).toBe("Housing");
    expect(loaded.bodyMeta["b:x"]!.visible).toBe(false);
    expect(loaded.timelinePosition).toBe(1);
  });

  it("lists and duplicates projects", async () => {
    const store = await tempStore();
    const a = await store.create("A");
    const { assetId } = await store.saveAsset(a.id, png);
    await store.create("B");
    const list = await store.list();
    expect(list).toHaveLength(2);

    const copy = await store.duplicate(a.id, "A2");
    expect(copy.id).not.toBe(a.id);
    expect(copy.name).toBe("A2");
    expect((await store.readAsset(copy.id, assetId)).data).toEqual(png);
    expect(await store.list()).toHaveLength(3);
  });

  it("rejects path-traversal project ids", async () => {
    const store = await tempStore();
    await expect(store.load("../etc/passwd")).rejects.toThrow(/invalid/);
    await expect(store.load("..%2F..")).rejects.toThrow(/invalid/);
  });

  it("leaves no asset file when storage fails mid-write", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-test-"));
    const failing = {
      ...fs,
      open: async (file: string, flags?: string) => {
        const handle = await fs.open(file, flags);
        return Object.assign(Object.create(handle), {
          writeFile: async (data: Uint8Array) => {
            if (!file.includes(`${path.sep}blobs${path.sep}`))
              return handle.writeFile(data);
            await handle.writeFile(data.subarray(0, 8));
            throw new Error("disk full");
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        });
      },
    } as typeof fs;
    const store = new ProjectStore(
      new LocalStorage(dir, failing),
      validateDocument,
    );
    const doc = await store.create("Assets");
    await expect(store.saveAsset(doc.id, png)).rejects.toThrow("disk full");
    const blobs = path.join(dir, "projects", doc.id, "blobs");
    expect(await fs.readdir(blobs).catch(() => [])).toEqual([]);
  });

  it("removes projects", async () => {
    const store = await tempStore();
    const doc = await store.create("Gone");
    await store.remove(doc.id);
    await expect(store.load(doc.id)).rejects.toThrow(/not found/);
  });
});
