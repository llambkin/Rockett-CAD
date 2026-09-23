import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { LocalStorage, type Storage } from "../src/store/storage.js";
import { MemoryStorage } from "./helpers/memoryStorage.js";

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "rockett-storage-"));
}

function recordingFs(root: string, calls: string[]): typeof fs {
  const rel = (p: unknown) => path.relative(root, String(p)) || ".";
  return {
    ...fs,
    open: async (file: string, flags?: string) => {
      const handle = await fs.open(file, flags);
      const name = rel(file).replace(/\.[0-9a-f-]+\.tmp$/, ".tmp");
      return Object.assign(Object.create(handle), {
        writeFile: (data: string | Uint8Array) => {
          calls.push(`write ${name}`);
          return handle.writeFile(data);
        },
        sync: () => {
          calls.push(`sync ${name}`);
          return handle.sync();
        },
        close: () => handle.close(),
      });
    },
    rename: (from: string, to: string) => {
      calls.push(`rename ${rel(to)}`);
      return fs.rename(from, to);
    },
  } as typeof fs;
}

const storages: Array<[string, () => Promise<Storage>]> = [
  ["local", async () => new LocalStorage(await tempRoot(), fs)],
  ["memory", async () => new MemoryStorage()],
];

describe.each(storages)("%s storage", (_, make) => {
  it("reads, writes, lists and removes root-relative paths", async () => {
    const storage = await make();
    expect(await storage.list("")).toEqual([]);
    await storage.writeAtomic("a/one.json", "1");
    await storage.writeAtomic("a/one.json", "2");
    await storage.writeAtomic("b/two.json", Buffer.from("two"));
    expect((await storage.read("a/one.json")).toString()).toBe("2");
    expect(new Set(await storage.list(""))).toEqual(new Set(["a", "b"]));
    expect(await storage.list("a")).toEqual(["one.json"]);
    await storage.writeAtomic("b/c/d/three.json", "3");
    const nested = await storage.files("b");
    nested.sort();
    expect(nested).toEqual(["c/d/three.json", "two.json"]);
    expect(await storage.files("missing")).toEqual([]);
    await storage.remove("a");
    await expect(storage.read("a/one.json")).rejects.toThrow();
    expect(await storage.list("")).toEqual(["b"]);
  });

  it("rejects traversal and absolute paths", async () => {
    const storage = await make();
    for (const bad of ["../x", "a/../../x", "a\\..\\x", "/etc/passwd", ""]) {
      await expect(storage.read(bad)).rejects.toThrow("invalid storage path");
      await expect(storage.writeAtomic(bad, "x")).rejects.toThrow(
        "invalid storage path",
      );
      await expect(storage.remove(bad)).rejects.toThrow("invalid storage path");
      await expect(storage.files(bad)).rejects.toThrow("invalid storage path");
    }
    await expect(storage.list("..")).rejects.toThrow("invalid storage path");
  });
});

describe("local storage", () => {
  it("syncs the file before the rename and the directory after it", async () => {
    const root = await tempRoot();
    const calls: string[] = [];
    const storage = new LocalStorage(root, recordingFs(root, calls));
    await storage.writeAtomic("p/doc.json", "{}");
    expect(calls).toEqual([
      "write p/doc.json.tmp",
      "sync p/doc.json.tmp",
      "rename p/doc.json",
      "sync p",
    ]);
    expect(await fs.readdir(path.join(root, "p"))).toEqual(["doc.json"]);
  });
});
