import {
  storagePath,
  type Data,
  type Storage,
} from "../../src/store/storage.js";

export class MemoryStorage implements Storage {
  readonly data = new Map<string, Buffer>();
  private readonly stamps = new WeakMap<Buffer, string>();
  private writes = 0;
  private readonly times = new Map<string, number>();

  async read(file: string): Promise<Buffer> {
    const data = this.data.get(storagePath(file));
    if (!data)
      throw Object.assign(new Error(`${file} not found`), { code: "ENOENT" });
    return data;
  }

  async readRange(file: string, start: number, end: number): Promise<Buffer> {
    return (await this.read(file)).subarray(start, end);
  }

  async stamp(file: string): Promise<string | undefined> {
    const data = this.data.get(storagePath(file));
    if (!data) return undefined;
    if (!this.stamps.has(data)) this.stamps.set(data, String(++this.writes));
    return this.stamps.get(data);
  }

  async modified(file: string): Promise<number> {
    await this.read(file);
    return this.times.get(storagePath(file)) ?? 0;
  }

  async writeAtomic(file: string, data: Data): Promise<void> {
    const chunks: Uint8Array[] = [];
    if (typeof data === "string" || data instanceof Uint8Array)
      chunks.push(Buffer.from(data));
    else for await (const chunk of data) chunks.push(chunk);
    this.data.set(storagePath(file), Buffer.concat(chunks));
    this.times.set(storagePath(file), Date.now());
  }

  async append(file: string, data: Uint8Array): Promise<void> {
    const key = storagePath(file);
    this.data.set(
      key,
      Buffer.concat([this.data.get(key) ?? Buffer.alloc(0), data]),
    );
    this.times.set(key, Date.now());
  }

  async move(from: string, to: string): Promise<void> {
    this.data.set(storagePath(to), await this.read(from));
    this.times.set(
      storagePath(to),
      this.times.get(storagePath(from)) ?? Date.now(),
    );
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
