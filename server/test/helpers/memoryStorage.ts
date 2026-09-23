import { storagePath, type Storage } from "../../src/store/storage.js";

export class MemoryStorage implements Storage {
  readonly files = new Map<string, Buffer>();

  async read(file: string): Promise<Buffer> {
    const data = this.files.get(storagePath(file));
    if (!data) throw new Error(`${file} not found`);
    return data;
  }

  async writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
    this.files.set(
      storagePath(file),
      typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
    );
  }

  async list(dir: string): Promise<string[]> {
    const root = storagePath(dir, true);
    const prefix = root ? `${root}/` : "";
    const names = new Set<string>();
    for (const key of this.files.keys())
      if (key.startsWith(prefix))
        names.add(key.slice(prefix.length).split("/")[0]!);
    return [...names];
  }

  async remove(target: string): Promise<void> {
    const root = storagePath(target);
    for (const key of this.files.keys())
      if (key === root || key.startsWith(`${root}/`)) this.files.delete(key);
  }
}
