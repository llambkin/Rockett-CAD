import type { promises } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type Data = string | Uint8Array | AsyncIterable<Uint8Array>;

export interface Storage {
  read(file: string): Promise<Buffer>;
  readRange(file: string, start: number, end: number): Promise<Buffer>;
  stamp(file: string): Promise<string | undefined>;
  modified(file: string): Promise<number>;
  writeAtomic(file: string, data: Data): Promise<void>;
  append(file: string, data: Uint8Array): Promise<void>;
  move(from: string, to: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  files(dir: string): Promise<string[]>;
  remove(target: string): Promise<void>;
}

type Fs = Pick<
  typeof promises,
  "mkdir" | "open" | "readFile" | "readdir" | "rename" | "rm" | "stat"
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

export const isMissing = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

export async function readFirst(storage: Storage, files: string[]) {
  for (const file of files) {
    try {
      return { file, data: await storage.read(file) };
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return undefined;
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

  async readRange(file: string, start: number, end: number): Promise<Buffer> {
    const handle = await this.fs.open(this.resolve(file), "r");
    try {
      const out = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(out, 0, out.length, start);
      return out.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async stamp(file: string): Promise<string | undefined> {
    try {
      const s = await this.fs.stat(this.resolve(file), { bigint: true });
      return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
    } catch (err) {
      if (isMissing(err)) return undefined;
      throw err;
    }
  }

  async modified(file: string): Promise<number> {
    return (await this.fs.stat(this.resolve(file))).mtimeMs;
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

  async append(file: string, data: Uint8Array): Promise<void> {
    const full = this.resolve(file);
    await this.fs.mkdir(path.dirname(full), { recursive: true });
    const handle = await this.fs.open(full, "a");
    let created: boolean;
    try {
      await handle.writeFile(data);
      await handle.sync();
      created = (await handle.stat()).size === data.byteLength;
    } finally {
      await handle.close();
    }
    if (created) await this.sync(path.dirname(full), "r");
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
      if (isMissing(err)) return [];
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
      if (isMissing(err)) return [];
      throw err;
    }
  }

  async remove(target: string): Promise<void> {
    const full = this.resolve(target);
    await this.fs.rm(full, { recursive: true, force: true });
    try {
      await this.sync(path.dirname(full), "r");
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
}
