import { storagePath, type Storage } from "../../src/store/storage.js";

export class MemoryStorage implements Storage {
  readonly data = new Map<string, Buffer>();

  async read(file: string): Promise<Buffer> {
    const data = this.data.get(storagePath(file));
    if (!data) throw new Error(`${file} not found`);
    return data;
  }

  async writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
    this.data.set(
      storagePath(file),
      typeof data === "string" ? Buffer.from(data) : Buffer.from(data),
    );
  }

  async list(dir: string): Promise<string[]> {
    const root = storagePath(dir, true);
    const prefix = root ? `${root}/` : "";
    const names = new Set<string>();
    for (const key of this.data.keys())
      if (key.startsWith(prefix))
        names.add(key.slice(prefix.length).split("/")[0]!);
    return [...names];
  }

  async files(dir: string): Promise<string[]> {
    const prefix = `${storagePath(dir)}/`;
    return [...this.data.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));
  }

  async remove(target: string): Promise<void> {
    const root = storagePath(target);
    for (const key of this.data.keys())
      if (key === root || key.startsWith(`${root}/`)) this.data.delete(key);
  }
}
