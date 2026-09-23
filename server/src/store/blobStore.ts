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
