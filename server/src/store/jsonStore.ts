import crypto from "node:crypto";
import path from "node:path";
import type { ApiErrorCode } from "@rockett/shared";
import {
  migrate,
  NO_BLOBS,
  type MigrationContext,
  type Migrations,
} from "./migrations.js";
import { ProjectQueue } from "./projectQueue.js";
import { storagePath, type Storage } from "./storage.js";

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode = "validation",
  ) {
    super(message);
  }
}

export interface MigrationEffects<C extends MigrationContext> {
  context(key: string, stored: unknown): Promise<C>;
  commit(key: string, context: C): Promise<void>;
  retire(key: string, context: C): Promise<void>;
}

export interface JsonStoreOptions<T, C extends MigrationContext> {
  storage: Storage;
  root: string;
  name: string;
  key: RegExp;
  file: string;
  migrations: Migrations<T>;
  unbacked?: (key: string) => Promise<boolean>;
  validate?: (value: T) => void;
  effects?: MigrationEffects<C>;
}

export interface Inventory {
  recovered: string[];
  outdated: string[];
  failed: Array<{ key: string; error: string }>;
}

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export class NamespaceBackup {
  private readonly dir: string;
  private readonly root: string;
  private readonly record: string;

  constructor(
    private readonly storage: Storage,
    namespace: string,
  ) {
    this.dir = storagePath(namespace);
    this.root = path.posix.join("backups", this.dir);
    this.record = path.posix.join(this.root, "migrating.json");
  }

  async backup(version: string): Promise<string> {
    const name = await this.write(version);
    await this.verify(name);
    return name;
  }

  async migrate(version: string, apply: () => Promise<void>): Promise<void> {
    const backup = await this.backup(version);
    await this.storage.writeAtomic(this.record, JSON.stringify({ backup }));
    await apply();
    await this.storage.remove(this.record);
  }

  async recover(): Promise<boolean> {
    const raw = await this.storage.read(this.record).catch(() => undefined);
    if (!raw) return false;
    const { backup } = JSON.parse(raw.toString("utf8")) as { backup: string };
    await this.restore(backup);
    await this.storage.remove(this.record);
    return true;
  }

  async restore(backup: string): Promise<void> {
    for (const [name, sum] of await this.verify(backup))
      await this.storage.writeAtomic(
        path.posix.join(this.dir, name),
        await this.verified(backup, name, sum),
      );
  }

  private async verify(backup: string): Promise<Array<[string, string]>> {
    if (!/^[\w.]+-[0-9a-f]{16}$/.test(backup))
      throw new StoreError(`invalid backup name ${backup}`);
    const text = await this.storage.read(
      path.posix.join(this.root, backup, "SHA256SUMS"),
    );
    const entries = text
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): [string, string] => [line.slice(66), line.slice(0, 64)]);
    for (const [name, sum] of entries) await this.verified(backup, name, sum);
    return entries;
  }

  private async verified(
    backup: string,
    name: string,
    sum: string,
  ): Promise<Buffer> {
    const data = await this.storage.read(
      path.posix.join(this.root, backup, "files", name),
    );
    if (sha256(data) !== sum)
      throw new StoreError(
        `${this.dir} backup ${backup} is damaged`,
        "internal",
      );
    return data;
  }

  private async write(version: string): Promise<string> {
    const { storage, dir } = this;
    const names = await storage.files(dir);
    names.sort();
    const sums = new Map<string, string>();
    for (const name of names)
      sums.set(name, sha256(await storage.read(path.posix.join(dir, name))));
    const manifest = names
      .map((name) => `${sums.get(name)}  ${name}\n`)
      .join("");
    const backup = `${version}-${sha256(manifest).slice(0, 16)}`;
    const target = path.posix.join(this.root, backup);
    const existing = await storage
      .read(path.posix.join(target, "SHA256SUMS"))
      .catch(() => undefined);
    if (existing?.toString("utf8") === manifest) return backup;
    if (existing)
      throw new StoreError(`${dir} backup ${backup} differs`, "internal");
    for (const name of names) {
      const data = await storage.read(path.posix.join(dir, name));
      if (sha256(data) !== sums.get(name))
        throw new StoreError(`${dir} changed during backup`, "internal");
      await storage.writeAtomic(path.posix.join(target, "files", name), data);
    }
    await storage.writeAtomic(path.posix.join(target, "SHA256SUMS"), manifest);
    return backup;
  }
}

export function backupNamespace(
  storage: Storage,
  namespace: string,
): NamespaceBackup {
  return new NamespaceBackup(storage, namespace);
}

export class JsonStore<T, C extends MigrationContext = MigrationContext> {
  private writes = new ProjectQueue();

  constructor(readonly options: JsonStoreOptions<T, C>) {}

  dir(key: string): string {
    if (!this.options.key.test(key))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.posix.join(this.options.root, key);
  }

  private file(key: string): string {
    return path.posix.join(this.dir(key), this.options.file);
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

  private context(key: string, stored: unknown): Promise<C> | C {
    return this.options.effects?.context(key, stored) ?? (NO_BLOBS as C);
  }

  async migrated(key: string): Promise<{ value: T; context: C }> {
    const stored = await this.stored(key);
    const context = await this.context(key, stored);
    return {
      value: migrate(this.options.migrations, stored, context),
      context,
    };
  }

  async read(key: string): Promise<T> {
    return (await this.migrated(key)).value;
  }

  exclusive<R>(key: string, operation: () => Promise<R>): Promise<R> {
    return this.writes.run(key, operation);
  }

  write(key: string, value: T): Promise<void> {
    return this.update(key, () => value);
  }

  update(key: string, change: (previous: T | undefined) => T): Promise<void> {
    return this.writes.run(key, async () => {
      const value = change(await this.previous(key));
      this.options.validate?.(value);
      await this.upgrade(key, !(await this.options.unbacked?.(key)));
      await this.options.storage.writeAtomic(
        this.file(key),
        JSON.stringify(value, null, 1),
      );
    });
  }

  private async previous(key: string): Promise<T | undefined> {
    try {
      return await this.read(key);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found")
        return undefined;
      throw err;
    }
  }

  private async upgrade(key: string, backed: boolean): Promise<void> {
    if (backed) await this.recover(key);
    let value: unknown;
    try {
      value = await this.stored(key);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found") return;
      throw err;
    }
    const context = await this.context(key, value);
    const next = migrate(this.options.migrations, value, context);
    if (next === value) return;
    const staged = JSON.stringify(next, null, 1);
    if (backed) this.options.validate?.(JSON.parse(staged));
    await this.options.effects?.commit(key, context);
    if (!backed) return;
    const from = (value as Record<string, unknown>)[
      this.options.migrations.field
    ];
    await backupNamespace(this.options.storage, this.dir(key)).migrate(
      `v${String(from)}`,
      async () => {
        await this.options.storage.writeAtomic(this.file(key), staged);
        await this.options.effects?.retire(key, context);
      },
    );
  }

  private async recover(key: string): Promise<boolean> {
    return backupNamespace(this.options.storage, this.dir(key)).recover();
  }

  async inventory(): Promise<Inventory> {
    const out: Inventory = { recovered: [], outdated: [], failed: [] };
    for (const key of await this.keys()) {
      try {
        if (await this.writes.run(key, () => this.recover(key)))
          out.recovered.push(key);
        const value = await this.stored(key);
        const context = await this.context(key, value);
        if (migrate(this.options.migrations, value, context) !== value)
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
