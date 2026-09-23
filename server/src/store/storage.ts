import type { promises } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type Data = string | Uint8Array | AsyncIterable<Uint8Array>;

export interface Storage {
  read(file: string): Promise<Buffer>;
  writeAtomic(file: string, data: Data): Promise<void>;
  move(from: string, to: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  files(dir: string): Promise<string[]>;
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

  async writeAtomic(file: string, data: Data): Promise<void> {
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

  async move(from: string, to: string): Promise<void> {
    const target = this.resolve(to);
    await this.fs.mkdir(path.dirname(target), { recursive: true });
    await this.fs.rename(this.resolve(from), target);
    await this.sync(path.dirname(target), "r");
  }

  private async sync(
    target: string,
    flags: string,
    data?: Data,
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

  async files(dir: string): Promise<string[]> {
    const root = this.resolve(dir);
    try {
      const entries = await this.fs.readdir(root, {
        recursive: true,
        withFileTypes: true,
      });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path
            .relative(root, path.join(entry.parentPath, entry.name))
            .split(path.sep)
            .join("/"),
        );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async remove(target: string): Promise<void> {
    await this.fs.rm(this.resolve(target), { recursive: true, force: true });
  }
}
