import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { validateDocument } from "../src/api/validate.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { MemoryStorage } from "./helpers/memoryStorage.js";

const bytes = Buffer.from("ISO-10303-21;\nEND-ISO-10303-21;\n");
const hash = crypto.createHash("sha256").update(bytes).digest("hex");

async function setup() {
  const storage = new MemoryStorage();
  const store = new ProjectStore(storage, validateDocument);
  const doc = await store.create("Blobs");
  return { storage, store, doc, blobs: store.blobs(doc.id) };
}

describe("blob store", () => {
  it("stores equal bytes once under their sha256", async () => {
    const { storage, doc, blobs } = await setup();
    const write = vi.spyOn(storage, "writeAtomic");
    expect(await blobs.has(hash)).toBe(false);
    expect(await blobs.put(bytes)).toBe(hash);
    expect(await blobs.put(Buffer.from(bytes))).toBe(hash);
    expect(write).toHaveBeenCalledOnce();
    expect(await storage.files(`projects/${doc.id}/blobs`)).toEqual([hash]);
    expect(await blobs.has(hash)).toBe(true);
    expect(await blobs.get(hash)).toEqual(bytes);
  });

  it("fails get on a corrupted blob", async () => {
    const { storage, doc, blobs } = await setup();
    await blobs.put(bytes);
    await storage.writeAtomic(`projects/${doc.id}/blobs/${hash}`, "tampered");
    await expect(blobs.get(hash)).rejects.toThrow(`blob ${hash} is corrupted`);
  });

  it("rejects a hash that is not lowercase sha256 hex", async () => {
    const { blobs } = await setup();
    await expect(blobs.get("../document.json")).rejects.toThrow(
      "invalid blob hash",
    );
    await expect(blobs.get(hash.toUpperCase())).rejects.toThrow(
      "invalid blob hash",
    );
    await expect(blobs.get(hash)).rejects.toThrow("not found");
  });

  it("copies blobs when a project is duplicated", async () => {
    const { store, doc, blobs } = await setup();
    await blobs.put(bytes);
    const copy = await store.duplicate(doc.id);
    expect(await store.blobs(copy.id).get(hash)).toEqual(bytes);
    await store.remove(doc.id);
    expect(await store.blobs(copy.id).get(hash)).toEqual(bytes);
    expect(await store.blobs(doc.id).has(hash)).toBe(false);
  });
});
