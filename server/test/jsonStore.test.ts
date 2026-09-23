import { describe, expect, it } from "vitest";
import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { JsonStore } from "../src/store/jsonStore.js";
import { LocalStorage } from "../src/store/storage.js";

interface Note {
  version: number;
  text: string;
}

async function tempStore(onWrite: (root: string) => void = () => {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-json-"));
  const store = new JsonStore<Note>({
    storage: new LocalStorage(root, fs),
    root: "",
    name: "note",
    key: /^[a-z0-9]+$/,
    file: "note.json",
    migrate: (raw) => ({ ...(raw as Note), version: 2 }),
    validate: (note) => {
      if (!note.text) throw new Error("empty note");
      onWrite(root);
    },
  });
  return { root, store };
}

describe("json store", () => {
  it("round trips a value through its migration", async () => {
    const { root, store } = await tempStore();
    await store.write("a", { version: 1, text: "hello" });
    expect(await store.read("a")).toEqual({ version: 2, text: "hello" });
    expect(await store.keys()).toEqual(["a"]);
    await expect(store.write("a", { version: 1, text: "" })).rejects.toThrow(
      "empty note",
    );
    expect(await store.read("a")).toEqual({ version: 2, text: "hello" });
    expect(await fs.readdir(path.join(root, "a"))).toEqual(["note.json"]);
    await store.remove("a");
    await expect(store.read("a")).rejects.toThrow("note a not found");
    expect(await store.keys()).toEqual([]);
  });

  it("orders writes to one key in call order", async () => {
    const onDisk: string[] = [];
    const { store } = await tempStore((root) => {
      const file = path.join(root, "a", "note.json");
      onDisk.push(
        existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).text : "",
      );
    });
    const texts = Array.from({ length: 12 }, (_, i) => `v${i}`);
    await Promise.all(
      texts.map((text) => store.write("a", { version: 1, text })),
    );
    expect(onDisk).toEqual(["", ...texts.slice(0, -1)]);
    expect((await store.read("a")).text).toBe("v11");
  });

  it("rejects bad keys and lists only valid ones", async () => {
    const { root, store } = await tempStore();
    const note = { version: 1, text: "x" };
    await expect(store.read("../etc")).rejects.toThrow("invalid note id");
    await expect(store.write("A/b", note)).rejects.toThrow("invalid note id");
    await expect(store.remove("..")).rejects.toThrow("invalid note id");
    await fs.mkdir(path.join(root, "Bad-Key"));
    await store.write("ok", note);
    expect(await store.keys()).toEqual(["ok"]);
  });
});
