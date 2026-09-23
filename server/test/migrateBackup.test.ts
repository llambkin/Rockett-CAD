import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { SCHEMA_VERSION, type CadDocument } from "@rockett/shared";
import { ProjectStore } from "../src/store/projectStore.js";
import { validateDocument } from "../src/api/validate.js";
import { documentMigrations, migrate } from "../src/store/migrations.js";
import { LocalStorage, type Data, type Storage } from "../src/store/storage.js";
import { MemoryStorage } from "./helpers/memoryStorage.js";
import { PendingBlobs } from "../src/store/blobStore.js";

const fixtureRaw = await fs.readFile(
  path.join(import.meta.dirname, "fixtures", "schema", "v4.json"),
);
const fixture = JSON.parse(fixtureRaw.toString("utf8")) as CadDocument;
const id = fixture.id;
const project = `projects/${id}`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const original = new Map([
  ["document.json", fixtureRaw],
  ["assets/0123456789abcdef.png", png],
  ["exports/part.stl", Buffer.from("solid part\nendsolid part\n")],
]);
const pending = new PendingBlobs(new Map([["0123456789abcdef.png", png]]));
const migratedDoc = migrate(documentMigrations, fixture, pending);
const backedUp = new Map<string, Buffer>(original);
for (const [hash, bytes] of pending.blobs) backedUp.set(`blobs/${hash}`, bytes);
const migrated = new Map(
  [...backedUp].filter(([name]) => !name.startsWith("assets/")),
).set("document.json", Buffer.from(JSON.stringify(migratedDoc, null, 1)));

type When = "before" | "after";
type Files = Map<string, Buffer>;

interface Backend {
  failing: Storage;
  clean: Storage;
  ops: () => number;
}

class FailingStorage implements Storage {
  count = 0;

  constructor(
    private readonly inner: Storage,
    private readonly failAt: number,
    private readonly when: When,
  ) {}

  read(file: string) {
    return this.inner.read(file);
  }

  list(dir: string) {
    return this.inner.list(dir);
  }

  files(dir: string) {
    return this.inner.files(dir);
  }

  writeAtomic(file: string, data: Data) {
    return this.mutate(() => this.inner.writeAtomic(file, data));
  }

  move(from: string, to: string) {
    return this.mutate(() => this.inner.move(from, to));
  }

  remove(target: string) {
    return this.mutate(() => this.inner.remove(target));
  }

  private async mutate(op: () => Promise<void>) {
    const n = ++this.count;
    if (n === this.failAt && this.when === "before")
      throw new Error("injected");
    await op();
    if (n === this.failAt && this.when === "after") throw new Error("injected");
  }
}

function memory(failAt: number, when: When): Backend {
  const clean = new MemoryStorage();
  const failing = new FailingStorage(clean, failAt, when);
  return { failing, clean, ops: () => failing.count };
}

async function local(failAt: number, when: When): Promise<Backend> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-migrate-"));
  let count = 0;
  const step = async <T>(op: () => Promise<T>): Promise<T> => {
    const n = ++count;
    if (n === failAt && when === "before") throw new Error("injected");
    const result = await op();
    if (n === failAt && when === "after") throw new Error("injected");
    return result;
  };
  const failingFs = {
    ...fs,
    open: async (file: string, flags?: string) => {
      const handle = await fs.open(file, flags);
      return Object.assign(Object.create(handle), {
        writeFile: (data: string | Uint8Array) =>
          step(() => handle.writeFile(data)),
        sync: () => handle.sync(),
        close: () => handle.close(),
      });
    },
    rename: (from: string, to: string) => step(() => fs.rename(from, to)),
    rm: (target: string, options?: { recursive?: boolean; force?: boolean }) =>
      step(() => fs.rm(target, options)),
  } as typeof fs;
  return {
    failing: new LocalStorage(root, failingFs),
    clean: new LocalStorage(root, fs),
    ops: () => count,
  };
}

const backends: Array<
  [string, (failAt: number, when: When) => Promise<Backend>]
> = [
  ["memory storage", async (failAt, when) => memory(failAt, when)],
  ["local storage", local],
];

async function seed(storage: Storage): Promise<void> {
  for (const [name, data] of original)
    await storage.writeAtomic(`${project}/${name}`, data);
}

async function snapshot(storage: Storage, dir: string): Promise<Files> {
  const out: Files = new Map();
  const names = await storage.files(dir);
  names.sort();
  for (const name of names) out.set(name, await storage.read(`${dir}/${name}`));
  return out;
}

async function backups(storage: Storage): Promise<string[]> {
  const names = await storage.list(`backups/${project}`);
  names.sort();
  return names;
}

function same(a: Files, b: Files, except?: string): boolean {
  return (
    a.size === b.size &&
    [...b].every(([k, v]) => k === except || a.get(k)?.equals(v) === true)
  );
}

function generation(live: Files): string {
  if (
    [...original].every(([k, v]) => live.get(k)?.equals(v) === true) &&
    [...live].every(([k, v]) => backedUp.get(k)?.equals(v) === true)
  )
    return "old";
  if (same(live, migrated)) return "migrated";
  const doc = JSON.parse(live.get("document.json")?.toString() ?? "{}");
  if (
    same(live, migrated, "document.json") &&
    doc.name === "Edited" &&
    doc.schemaVersion === SCHEMA_VERSION
  )
    return "saved";
  return "mixed";
}

function sha(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function edit(store: ProjectStore): Promise<CadDocument> {
  const doc = await store.load(id);
  doc.name = "Edited";
  return doc;
}

describe.each(backends)("project migration on %s", (_, make) => {
  it("backs up the complete old project before the first save migrates it", async () => {
    const { failing: storage } = await make(0, "before");
    await seed(storage);
    const store = new ProjectStore(storage, validateDocument);
    await store.save(await edit(store));

    const [backup, ...others] = await backups(storage);
    expect(others).toEqual([]);
    const entries = [...backedUp];
    entries.sort(([a], [b]) => (a < b ? -1 : 1));
    const sums = entries
      .map(([name, data]) => `${sha(data)}  ${name}\n`)
      .join("");
    expect(backup).toBe(`v4-${sha(Buffer.from(sums)).slice(0, 16)}`);
    const dir = `backups/${project}/${backup}`;
    expect((await storage.read(`${dir}/SHA256SUMS`)).toString()).toBe(sums);
    expect(await snapshot(storage, `${dir}/files`)).toEqual(backedUp);
    expect(
      (await storage.read(`${dir}/files/document.json`)).equals(fixtureRaw),
    ).toBe(true);

    const restored = new MemoryStorage();
    for (const [name, data] of await snapshot(storage, `${dir}/files`))
      await restored.writeAtomic(`${project}/${name}`, data);
    expect(await snapshot(restored, project)).toEqual(backedUp);
    const reopened = new ProjectStore(restored, validateDocument);
    const loaded = await reopened.load(id);
    expect(loaded.features).toEqual(migratedDoc.features);
    expect(loaded.bodyMeta).toEqual(fixture.bodyMeta);
    expect((await reopened.readAsset(id, sha(png))).data).toEqual(png);

    await store.save(await edit(store));
    expect(await backups(storage)).toEqual([backup]);
  });

  it("keeps a separate backup for a different original at the same schema", async () => {
    const { failing: storage } = await make(0, "before");
    await seed(storage);
    const store = new ProjectStore(storage, validateDocument);
    await store.save(await edit(store));
    const [first] = await backups(storage);
    const firstFiles = await snapshot(storage, `backups/${project}/${first}`);

    const changed = { ...fixture, name: "Restored by hand" };
    await storage.writeAtomic(
      `${project}/document.json`,
      JSON.stringify(changed),
    );
    await store.save(await edit(store));

    expect(await backups(storage)).toHaveLength(2);
    expect(await snapshot(storage, `backups/${project}/${first}`)).toEqual(
      firstFiles,
    );
  });

  it(
    "recovers one complete generation after a failure before or after each write",
    { timeout: 60_000 },
    async () => {
      const counting = await make(0, "before");
      await seed(counting.clean);
      const store = new ProjectStore(counting.failing, validateDocument);
      await store.save(await edit(store));
      const total = counting.ops();
      expect(total).toBeGreaterThan(6);

      for (let n = 1; n <= total; n++)
        for (const when of ["before", "after"] as const) {
          const label = `failure ${when} op ${n}`;
          const backend = await make(n, when);
          await seed(backend.clean);
          const failing = new ProjectStore(backend.failing, validateDocument);
          await expect(failing.save(await edit(failing))).rejects.toThrow(
            "injected",
          );

          const restarted = new ProjectStore(backend.clean, validateDocument);
          expect((await restarted.inventory()).failed).toEqual([]);
          expect(
            generation(await snapshot(backend.clean, project)),
            label,
          ).toMatch(/^(old|migrated|saved)$/);
          expect(await backend.clean.list(`backups/${project}`)).not.toContain(
            "migrating.json",
          );

          await restarted.save(await edit(restarted));
          expect((await restarted.load(id)).name).toBe("Edited");
          const kept = await backups(backend.clean);
          expect(kept, label).toHaveLength(1);
          expect(
            await snapshot(
              backend.clean,
              `backups/${project}/${kept[0]}/files`,
            ),
          ).toEqual(backedUp);
        }
    },
  );

  it(
    "retries a failed migration in the same process with one backup",
    { timeout: 60_000 },
    async () => {
      const counting = await make(0, "before");
      await seed(counting.clean);
      const store = new ProjectStore(counting.failing, validateDocument);
      await store.save(await edit(store));
      const total = counting.ops();

      for (let n = 1; n <= total; n++)
        for (const when of ["before", "after"] as const) {
          const backend = await make(n, when);
          await seed(backend.clean);
          const retried = new ProjectStore(backend.failing, validateDocument);
          await expect(retried.save(await edit(retried))).rejects.toThrow(
            "injected",
          );
          await retried.save(await edit(retried));
          expect((await retried.load(id)).name).toBe("Edited");
          const kept = await backups(backend.clean);
          expect(kept, `failure ${when} op ${n}`).toHaveLength(1);
          expect(
            await snapshot(
              backend.clean,
              `backups/${project}/${kept[0]}/files`,
            ),
          ).toEqual(backedUp);
        }
    },
  );

  it("keeps a migrating save and a retained export written during its backup", async () => {
    const { clean } = await make(0, "before");
    await seed(clean);
    const stl = Buffer.from("solid newer\nendsolid newer\n");
    let exported: Promise<void> | undefined;
    const storage: Storage = {
      read: (file) => clean.read(file),
      list: (dir) => clean.list(dir),
      files: (dir) => clean.files(dir),
      remove: (target) => clean.remove(target),
      move: (from, to) => clean.move(from, to),
      writeAtomic: async (file, data) => {
        if (file.startsWith("backups/") && !exported) {
          exported = store.saveExport(id, "part.stl", stl);
          for (let i = 0; i < 20; i++)
            await new Promise((resolve) => setImmediate(resolve));
        }
        await clean.writeAtomic(file, data);
      },
    };
    const store = new ProjectStore(storage, validateDocument);

    await store.save(await edit(store));
    await exported;

    const [backup] = await backups(clean);
    const dir = `backups/${project}/${backup}`;
    const copied = await snapshot(clean, `${dir}/files`);
    expect(copied).toEqual(backedUp);
    for (const line of (await clean.read(`${dir}/SHA256SUMS`))
      .toString()
      .split("\n")
      .filter(Boolean))
      expect(sha(copied.get(line.slice(66))!)).toBe(line.slice(0, 64));
    expect(await clean.read(`${project}/exports/part.stl`)).toEqual(stl);
    expect((await store.load(id)).name).toBe("Edited");
  });

  it("inventories outdated projects at boot without migrating them", async () => {
    const { clean: storage } = await make(0, "before");
    await seed(storage);
    const store = new ProjectStore(storage, validateDocument);
    await store.create("Fresh");
    expect(await store.inventory()).toEqual({
      recovered: [],
      outdated: [id],
      failed: [],
    });
    expect(await snapshot(storage, project)).toEqual(original);
    expect(await backups(storage)).toEqual([]);
  });
});
