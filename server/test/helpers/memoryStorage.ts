import {
  storagePath,
  type Data,
  type Storage,
} from "../../src/store/storage.js";

export class MemoryStorage implements Storage {
  readonly data = new Map<string, Buffer>();

  async read(file: string): Promise<Buffer> {
    const data = this.data.get(storagePath(file));
    if (!data) throw new Error(`${file} not found`);
    return data;
  }

  async writeAtomic(file: string, data: Data): Promise<void> {
    const chunks: Uint8Array[] = [];
    if (typeof data === "string" || data instanceof Uint8Array)
      chunks.push(Buffer.from(data));
    else for await (const chunk of data) chunks.push(chunk);
    this.data.set(storagePath(file), Buffer.concat(chunks));
  }

  async move(from: string, to: string): Promise<void> {
    this.data.set(storagePath(to), await this.read(from));
    this.data.delete(storagePath(from));
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
