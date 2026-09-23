import type { promises } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Storage {
  read(file: string): Promise<Buffer>;
  writeAtomic(file: string, data: string | Uint8Array): Promise<void>;
  list(dir: string): Promise<string[]>;
  remove(target: string): Promise<void>;
}

export type Fs = Pick<
  typeof promises,
  "mkdir" | "open" | "readFile" | "readdir" | "rename" | "rm"
>;

export function storagePath(target: string, allowRoot = false): string {
  const parts = target.split(/[\\/]/).filter((p) => p !== "" && p !== ".");
  if (
    path.posix.isAbsolute(target) ||
    path.win32.isAbsolute(target) ||
    parts.includes("..") ||
    (parts.length === 0 && !allowRoot)
  )
    throw new Error(`invalid storage path: ${target}`);
  return parts.join("/");
}

export class LocalStorage implements Storage {
  constructor(
    private readonly root: string,
    private readonly fs: Fs,
  ) {}

  private resolve(target: string, allowRoot = false): string {
    return path.join(this.root, storagePath(target, allowRoot));
  }

  async read(file: string): Promise<Buffer> {
    return this.fs.readFile(this.resolve(file));
  }

  async writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
    const full = this.resolve(file);
    const dir = path.dirname(full);
    await this.fs.mkdir(dir, { recursive: true });
    const tmp = `${full}.${crypto.randomUUID()}.tmp`;
    try {
      await this.sync(tmp, "w", data);
      await this.fs.rename(tmp, full);
    } finally {
      await this.fs.rm(tmp, { force: true });
    }
    await this.sync(dir, "r");
  }

  private async sync(
    target: string,
    flags: string,
    data?: string | Uint8Array,
  ): Promise<void> {
    const handle = await this.fs.open(target, flags);
    try {
      if (data !== undefined) await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async list(dir: string): Promise<string[]> {
    try {
      return await this.fs.readdir(this.resolve(dir, true));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async remove(target: string): Promise<void> {
    await this.fs.rm(this.resolve(target), { recursive: true, force: true });
  }
}
