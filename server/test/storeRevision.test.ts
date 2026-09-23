import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { SCHEMA_VERSION } from "@rockett/shared";
import { ProjectStore } from "../src/store/projectStore.js";
import { validateDocument } from "../src/api/validate.js";
import { LocalStorage } from "../src/store/storage.js";

const fixtures = path.join(import.meta.dirname, "fixtures", "schema");
const rootVersion = JSON.parse(
  await fs.readFile(
    path.join(import.meta.dirname, "../../package.json"),
    "utf8",
  ),
).version as string;

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-revision-"));
  return {
    dir,
    store: new ProjectStore(new LocalStorage(dir, fs), validateDocument),
  };
}

async function stored(dir: string, id: string) {
  return JSON.parse(
    await fs.readFile(path.join(dir, "projects", id, "document.json"), "utf8"),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("document revision", () => {
  it("counts each save and stamps the app that wrote it", async () => {
    vi.stubEnv("ROCKETT_COMMIT", "abc1234");
    const { dir, store } = await tempStore();
    const doc = await store.create("Counted");
    expect(doc.revision).toBe(1);
    for (const expected of [2, 3]) {
      const loaded = await store.load(doc.id);
      await store.save(loaded);
      expect(loaded.revision).toBe(expected);
    }
    const saved = await stored(dir, doc.id);
    expect(saved.revision).toBe(3);
    expect(saved.savedWith).toEqual({
      version: rootVersion,
      commit: "abc1234",
    });
  });

  it("takes the stored revision, not the one the caller holds", async () => {
    const { store } = await tempStore();
    const doc = await store.create("Stale");
    const stale = await store.load(doc.id);
    await store.save(await store.load(doc.id));
    await store.save(stale);
    expect((await store.load(doc.id)).revision).toBe(3);
  });

  it("does not bump the revision on a load", async () => {
    const { dir, store } = await tempStore();
    const doc = await store.create("Read only");
    await store.load(doc.id);
    await store.list();
    expect((await stored(dir, doc.id)).revision).toBe(1);
  });

  it("loads the previous schema with revision 0 and no savedWith", async () => {
    const raw = await fs.readFile(path.join(fixtures, "v6.json"), "utf8");
    const fixture = JSON.parse(raw);
    expect(fixture.schemaVersion).toBe(6);
    expect(fixture).not.toHaveProperty("revision");
    const { dir, store } = await tempStore();
    await fs.mkdir(path.join(dir, "projects", fixture.id), { recursive: true });
    await fs.writeFile(
      path.join(dir, "projects", fixture.id, "document.json"),
      raw,
    );
    const loaded = await store.load(fixture.id);
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.revision).toBe(0);
    expect(loaded.savedWith).toBeNull();
    expect(loaded.features).toEqual(fixture.features);
    await store.save(loaded);
    expect((await stored(dir, fixture.id)).revision).toBe(1);
  });
});
