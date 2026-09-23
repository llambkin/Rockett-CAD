import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProjectStore } from "../src/store/projectStore.js";
import { migrateDocument } from "../src/store/migrations.js";
import { createEmptyDocument, SCHEMA_VERSION } from "@rockett/shared";

async function tempStore(): Promise<ProjectStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-test-"));
  const store = new ProjectStore(dir);
  await store.init();
  return store;
}

describe("project store", () => {
  it("upgrades legacy documents without changing feature history", () => {
    const legacy = {
      ...createEmptyDocument("legacy", "Legacy"),
      schemaVersion: 1,
    };
    const upgraded = migrateDocument(legacy);
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(upgraded.features).toEqual(legacy.features);
    expect(legacy.schemaVersion).toBe(1);
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
    expect(loaded.features[0].type).toBe("sketch");
    expect((loaded.features[0] as any).constraints[0].type).toBe("fix");
    expect(loaded.bodyMeta["b:x"].name).toBe("Housing");
    expect(loaded.bodyMeta["b:x"].visible).toBe(false);
    expect(loaded.timelinePosition).toBe(1);
  });

  it("lists and duplicates projects", async () => {
    const store = await tempStore();
    const a = await store.create("A");
    await store.create("B");
    const list = await store.list();
    expect(list).toHaveLength(2);

    const copy = await store.duplicate(a.id, "A2");
    expect(copy.id).not.toBe(a.id);
    expect(copy.name).toBe("A2");
    expect(await store.list()).toHaveLength(3);
  });

  it("rejects path-traversal project ids", async () => {
    const store = await tempStore();
    await expect(store.load("../etc/passwd")).rejects.toThrow(/invalid/);
    await expect(store.load("..%2F..")).rejects.toThrow(/invalid/);
  });

  it("removes projects", async () => {
    const store = await tempStore();
    const doc = await store.create("Gone");
    await store.remove(doc.id);
    await expect(store.load(doc.id)).rejects.toThrow(/not found/);
  });
});
