import crypto from "node:crypto";
import path from "node:path";
import { sha256, StoreError } from "./jsonStore.js";
import type { Storage } from "./storage.js";

export const HASH_RE = /^[0-9a-f]{64}$/;

export class PendingBlobs {
  readonly blobs = new Map<string, Buffer>();
  readonly used = new Set<string>();

  constructor(readonly assets: ReadonlyMap<string, Buffer> = new Map()) {
    for (const bytes of assets.values()) this.put(bytes);
  }

  put(bytes: Uint8Array): string {
    const hash = sha256(bytes);
    this.blobs.set(hash, Buffer.from(bytes));
    return hash;
  }

  asset(name: string): Buffer | undefined {
    const bytes = this.assets.get(name);
    if (bytes) this.used.add(name);
    return bytes;
  }
}

export interface Staged {
  path: string;
  hash: string;
  size: number;
}

export class Uploads {
  constructor(
    private readonly storage: Storage,
    private readonly dir = "uploads",
  ) {}

  async stage(chunks: AsyncIterable<Uint8Array>): Promise<Staged> {
    const file = path.posix.join(this.dir, crypto.randomUUID()),
      hash = crypto.createHash("sha256");
    let size = 0;
    await this.storage.writeAtomic(
      file,
      (async function* () {
        for await (const chunk of chunks) {
          hash.update(chunk);
          size += chunk.byteLength;
          yield chunk;
        }
      })(),
    );
    return { path: file, hash: hash.digest("hex"), size };
  }

  read(staged: Staged): Promise<Buffer> {
    return this.storage.read(staged.path);
  }

  discard(staged: Pick<Staged, "path">): Promise<void> {
    return this.storage.remove(staged.path);
  }
}

export class BlobStore {
  constructor(
    private readonly storage: Storage,
    private readonly dir: string,
  ) {}

  private file(hash: string): string {
    if (!HASH_RE.test(hash)) throw new StoreError("invalid blob hash");
    return path.posix.join(this.dir, hash);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const hash = sha256(bytes);
    if (!(await this.has(hash)))
      await this.storage.writeAtomic(this.file(hash), bytes);
    return hash;
  }

  async adopt(staged: Staged): Promise<string> {
    if (await this.has(staged.hash)) await this.storage.remove(staged.path);
    else await this.storage.move(staged.path, this.file(staged.hash));
    return staged.hash;
  }

  async get(hash: string): Promise<Buffer> {
    const file = this.file(hash);
    let data: Buffer;
    try {
      data = await this.storage.read(file);
    } catch {
      throw new StoreError(`blob ${hash} not found`, "not_found");
    }
    if (sha256(data) !== hash)
      throw new StoreError(`blob ${hash} is corrupted`, "internal");
    return data;
  }

  async has(hash: string): Promise<boolean> {
    return (await this.storage.list(this.dir)).includes(hash);
  }
}
