import crypto from "node:crypto";
import path from "node:path";
import type { ApiErrorCode } from "@rockett/shared";
import { migrate, type Migrations } from "./migrations.js";
import { ProjectQueue } from "./projectQueue.js";
import type { Storage } from "./storage.js";

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode = "validation",
  ) {
    super(message);
  }
}

export interface JsonStoreOptions<T> {
  storage: Storage;
  root: string;
  name: string;
  key: RegExp;
  file: string;
  migrations: Migrations<T>;
  unbacked?: (key: string) => Promise<boolean>;
  validate?: (value: T) => void;
}

export interface Inventory {
  recovered: string[];
  outdated: string[];
  failed: Array<{ key: string; error: string }>;
}

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export class JsonStore<T> {
  private writes = new ProjectQueue();

  constructor(readonly options: JsonStoreOptions<T>) {}

  dir(key: string): string {
    if (!this.options.key.test(key))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.posix.join(this.options.root, key);
  }

  private file(key: string): string {
    return path.posix.join(this.dir(key), this.options.file);
  }

  private backups(key: string): string {
    return path.posix.join("backups", this.dir(key));
  }

  private record(key: string): string {
    return path.posix.join(this.backups(key), "migrating.json");
  }

  async stored(key: string): Promise<unknown> {
    const file = this.file(key);
    let raw: string;
    try {
      raw = (await this.options.storage.read(file)).toString("utf8");
    } catch {
      throw new StoreError(
        `${this.options.name} ${key} not found`,
        "not_found",
      );
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new StoreError(
        `${this.options.name} ${key} is corrupted`,
        "internal",
      );
    }
  }

  async read(key: string): Promise<T> {
    return migrate(this.options.migrations, await this.stored(key));
  }

  exclusive<R>(key: string, operation: () => Promise<R>): Promise<R> {
    return this.writes.run(key, operation);
  }

  write(key: string, value: T): Promise<void> {
    return this.writes.run(key, async () => {
      this.options.validate?.(value);
      if (!(await this.options.unbacked?.(key))) await this.upgrade(key);
      await this.options.storage.writeAtomic(
        this.file(key),
        JSON.stringify(value, null, 1),
      );
    });
  }

  private async upgrade(key: string): Promise<void> {
    await this.recover(key);
    let value: unknown;
    try {
      value = await this.stored(key);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found") return;
      throw err;
    }
    const next = migrate(this.options.migrations, value);
    if (next === value) return;
    const staged = JSON.stringify(next, null, 1);
    this.options.validate?.(JSON.parse(staged));
    const from = (value as Record<string, unknown>)[
      this.options.migrations.field
    ];
    const backup = await this.backup(key, `v${String(from)}`);
    const { storage } = this.options;
    await storage.writeAtomic(this.record(key), JSON.stringify({ backup }));
    await storage.writeAtomic(this.file(key), staged);
    await storage.remove(this.record(key));
  }

  private async backup(key: string, version: string): Promise<string> {
    const { storage } = this.options;
    const dir = this.dir(key);
    const names = await storage.files(dir);
    names.sort();
    const sums = new Map<string, string>();
    for (const name of names)
      sums.set(name, sha256(await storage.read(path.posix.join(dir, name))));
    const manifest = names
      .map((name) => `${sums.get(name)}  ${name}\n`)
      .join("");
    const backup = `${version}-${sha256(manifest).slice(0, 16)}`;
    const target = path.posix.join(this.backups(key), backup);
    const existing = await storage
      .read(path.posix.join(target, "SHA256SUMS"))
      .catch(() => undefined);
    if (existing?.toString("utf8") === manifest) return backup;
    if (existing)
      throw new StoreError(
        `${this.options.name} ${key} backup ${backup} differs`,
        "internal",
      );
    for (const name of names) {
      const data = await storage.read(path.posix.join(dir, name));
      if (sha256(data) !== sums.get(name))
        throw new StoreError(
          `${this.options.name} ${key} changed during backup`,
          "internal",
        );
      await storage.writeAtomic(path.posix.join(target, "files", name), data);
    }
    await storage.writeAtomic(path.posix.join(target, "SHA256SUMS"), manifest);
    return backup;
  }

  private async recover(key: string): Promise<boolean> {
    const { storage } = this.options;
    const record = await storage.read(this.record(key)).catch(() => undefined);
    if (!record) return false;
    const { backup } = JSON.parse(record.toString("utf8")) as {
      backup: string;
    };
    const source = path.posix.join(this.backups(key), backup);
    const manifest = (
      await storage.read(path.posix.join(source, "SHA256SUMS"))
    ).toString("utf8");
    for (const line of manifest.split("\n").filter(Boolean)) {
      const sum = line.slice(0, 64);
      const name = line.slice(66);
      const data = await storage.read(path.posix.join(source, "files", name));
      if (sha256(data) !== sum)
        throw new StoreError(
          `${this.options.name} ${key} backup ${backup} is damaged`,
          "internal",
        );
      await storage.writeAtomic(path.posix.join(this.dir(key), name), data);
    }
    await storage.remove(this.record(key));
    return true;
  }

  async inventory(): Promise<Inventory> {
    const out: Inventory = { recovered: [], outdated: [], failed: [] };
    for (const key of await this.keys()) {
      try {
        if (await this.writes.run(key, () => this.recover(key)))
          out.recovered.push(key);
        const value = await this.stored(key);
        if (migrate(this.options.migrations, value) !== value)
          out.outdated.push(key);
      } catch (err) {
        out.failed.push({ key, error: (err as Error).message });
      }
    }
    return out;
  }

  async remove(key: string): Promise<void> {
    await this.options.storage.remove(this.dir(key));
  }

  async keys(): Promise<string[]> {
    const names = await this.options.storage.list(this.options.root);
    return names.filter((name) => this.options.key.test(name));
  }
}
