import path from "node:path";
import { StoreError } from "@rockett/shared";
import {
  migrate,
  NO_BLOBS,
  type MigrationContext,
  type Migrations,
} from "./migrations.js";
import { BACKUP_LIMITS, TIMING_MS } from "../tunables.js";
import { ProjectQueue } from "./projectQueue.js";
import { sha256 } from "./storeTags.js";
export { sha256, newId, etag, sameTag } from "./storeTags.js";
import { readFirst, storagePath, type Storage } from "./storage.js";

export const BACKUP_RECORD = "migrating.json";
export const BACKUP_DELETED = "deleted.json";

export { StoreError };

export type Files = ReadonlyMap<string, string | Uint8Array>;
export type Write<T> = (file: string, text: string, value: T) => Promise<void>;

interface MigrationEffects<C extends MigrationContext> {
  context(key: string, stored: unknown): Promise<C>;
  created(key: string, context: C): Promise<Files>;
  retire(key: string, context: C): Promise<void>;
}

interface JsonStoreOptions<T, C extends MigrationContext> {
  storage: Storage;
  root: string;
  name: string;
  key: RegExp;
  file: (item: string) => string;
  legacy?: string;
  migrations: Migrations<T>;
  unbacked?: (key: string) => Promise<boolean>;
  validate?: (value: T) => void;
  effects?: MigrationEffects<C>;
  remember?: (value: T) => Partial<T>;
}

export interface Inventory {
  recovered: string[];
  outdated: string[];
  failed: Array<{ key: string; error: string }>;
}

class NamespaceBackup {
  private readonly dir: string;
  private readonly root: string;
  private readonly record: string;

  constructor(
    private readonly storage: Storage,
    namespace: string,
  ) {
    this.dir = storagePath(namespace);
    this.root = path.posix.join("backups", this.dir);
    this.record = path.posix.join(this.root, BACKUP_RECORD);
  }

  async backup(version: string, names?: string[]): Promise<string> {
    const name = await this.write(version, names);
    await this.verify(name);
    return name;
  }

  names(): Promise<string[]> {
    return this.storage.list(this.root);
  }

  async deleted(now: number): Promise<void> {
    if (!(await this.names()).length) return;
    await this.storage.writeAtomic(
      path.posix.join(this.root, BACKUP_DELETED),
      JSON.stringify(now),
    );
  }

  async prune(live: boolean, now: number): Promise<void> {
    const names = await this.names();
    if (!names.length) return;
    if (!live) {
      if (names.includes(BACKUP_RECORD)) return;
      if (!names.includes(BACKUP_DELETED)) return this.deleted(now);
      const raw = await this.storage.read(
        path.posix.join(this.root, BACKUP_DELETED),
      );
      const deletedAt: unknown = JSON.parse(raw.toString("utf8"));
      if (typeof deletedAt !== "number" || !Number.isFinite(deletedAt))
        throw new StoreError("invalid backup deletion timestamp");
      if (now - deletedAt >= TIMING_MS.deletedProjectBackupAge)
        await this.storage.remove(this.root);
      return;
    }
    let pending: unknown;
    if (names.includes(BACKUP_RECORD)) {
      pending = JSON.parse(
        (await this.storage.read(this.record)).toString("utf8"),
      ).backup;
      if (typeof pending !== "string" || !names.includes(pending))
        throw new StoreError("invalid pending backup");
    }
    const backups = [];
    for (const name of names.filter(
      (candidate) =>
        candidate !== BACKUP_RECORD && candidate !== BACKUP_DELETED,
    ))
      backups.push({
        name,
        modified: await this.storage.modified(
          path.posix.join(this.root, name, "SHA256SUMS"),
        ),
      });
    backups.sort(
      (a, b) => b.modified - a.modified || a.name.localeCompare(b.name),
    );
    for (const { name } of backups.slice(BACKUP_LIMITS.live))
      if (name !== pending)
        await this.storage.remove(path.posix.join(this.root, name));
    if (names.includes(BACKUP_DELETED))
      await this.storage.remove(path.posix.join(this.root, BACKUP_DELETED));
  }

  migrate(
    version: string,
    created: Files,
    apply: () => Promise<void>,
    names?: string[],
  ): Promise<void> {
    return this.journal(
      version,
      created,
      async () => {
        await writeAll(this.storage, created);
        await apply();
      },
      names,
    );
  }

  private async journal(
    version: string,
    created: Files,
    apply: () => Promise<void>,
    names?: string[],
  ): Promise<void> {
    const backup = await this.backup(version, names);
    await this.storage.writeAtomic(
      this.record,
      JSON.stringify({
        backup,
        created: [...created].map(([file, data]) => [file, sha256(data)]),
      }),
    );
    await apply();
    await this.storage.remove(this.record);
  }

  async recover(): Promise<boolean> {
    const raw = await this.storage.read(this.record).catch(() => undefined);
    if (!raw) return false;
    const { backup, created = [] } = JSON.parse(raw.toString("utf8")) as {
      backup: string;
      created?: Array<[string, string]>;
    };
    for (const [file, sum] of created) {
      const data = await this.storage.read(file).catch(() => undefined);
      if (data && sha256(data) === sum) await this.storage.remove(file);
    }
    await this.restore(backup);
    await this.storage.remove(this.record);
    if (backup.startsWith("tx-"))
      await this.storage.remove(path.posix.join(this.root, backup));
    return true;
  }

  async restore(backup: string): Promise<void> {
    for (const [name, sum] of await this.verify(backup))
      await this.storage.writeAtomic(
        path.posix.join(this.dir, name),
        await this.verified(backup, name, sum),
      );
  }

  async verify(backup: string): Promise<Array<[string, string]>> {
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

  async verified(backup: string, name: string, sum: string): Promise<Buffer> {
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

  private async write(version: string, only?: string[]): Promise<string> {
    const { storage, dir } = this;
    const names = (only ?? (await storage.files(dir))).toSorted();
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
    const copy = async (name: string) => {
      const data = await storage.read(path.posix.join(dir, name));
      if (sha256(data) !== sums.get(name))
        throw new StoreError(`${dir} changed during backup`, "internal");
      await storage.writeAtomic(path.posix.join(target, "files", name), data);
    };
    if (only) await settled(names.map(copy));
    else for (const name of names) await copy(name);
    await storage.writeAtomic(path.posix.join(target, "SHA256SUMS"), manifest);
    return backup;
  }
}

async function settled(work: Array<Promise<void>>): Promise<void> {
  const failed = (await Promise.allSettled(work)).find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}

function writeAll(storage: Storage, files: Files): Promise<void> {
  return settled(
    [...files].map(([file, data]) => storage.writeAtomic(file, data)),
  );
}

export function backupNamespace(
  storage: Storage,
  namespace: string,
): NamespaceBackup {
  return new NamespaceBackup(storage, namespace);
}

export class JsonStore<T, C extends MigrationContext = MigrationContext> {
  private writes = new ProjectQueue();
  private known = new Map<string, { stamp: string; value: Partial<T> }>();

  constructor(readonly options: JsonStoreOptions<T, C>) {}

  dir(key: string): string {
    if (!this.options.key.test(key))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.posix.join(this.options.root, key);
  }

  private file(key: string, item = key): string {
    if (!this.options.key.test(item))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.posix.join(this.dir(key), this.options.file(item));
  }

  encode(key: string, value: T): [string, string] {
    this.options.validate?.(value);
    return [this.file(key), JSON.stringify(value, null, 1)];
  }

  async stored(key: string, item = key): Promise<unknown> {
    return (await this.found(key, item)).value;
  }

  async source(key: string, item = key) {
    const { storage, legacy, name } = this.options;
    const files = [this.file(key, item)];
    if (legacy && item === key)
      files.push(path.posix.join(this.dir(key), legacy));
    const source = await readFirst(storage, files);
    if (!source) throw new StoreError(`${name} ${key} not found`, "not_found");
    return source;
  }

  private async found(
    key: string,
    item = key,
  ): Promise<{ file: string; value: unknown }> {
    const { file, data } = await this.source(key, item);
    try {
      return { file, value: JSON.parse(data.toString("utf8")) };
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

  async migrated(key: string, item = key): Promise<{ value: T; context: C }> {
    const stamp = item === key ? await this.stamp(key) : undefined;
    const { file, value: stored } = await this.found(key, item);
    const context = await this.context(key, stored);
    const value = migrate(this.options.migrations, stored, context);
    if (item === key)
      this.remember(
        key,
        value === stored && file === this.file(key) ? stamp : undefined,
        value,
      );
    return { value, context };
  }

  async read(key: string, item = key): Promise<T> {
    return (await this.migrated(key, item)).value;
  }

  exclusive<R>(key: string, operation: () => Promise<R>): Promise<R> {
    return this.writes.run(key, operation);
  }

  write(key: string, value: T): Promise<void> {
    return this.writes.run(key, () => this.put(key, value));
  }

  update(
    key: string,
    change: (previous: Partial<T> | undefined) => T,
    write?: Write<T>,
  ): Promise<void> {
    return this.writes.run(key, async () => {
      await this.put(key, change(await this.recall(key)), write);
    });
  }

  private async recall(key: string): Promise<Partial<T> | undefined> {
    const known = await this.current(key);
    if (known) return known;
    const previous = await this.previous(key);
    return previous && this.remembered(previous);
  }

  private remembered(value: T): Partial<T> {
    return this.options.remember?.(value) ?? {};
  }

  private async put(
    key: string,
    value: T,
    write: Write<T> = (file, text) =>
      this.options.storage.writeAtomic(file, text),
  ): Promise<void> {
    const [file, text] = this.encode(key, value);
    await this.upgrade(key);
    this.known.delete(key);
    await write(file, text, value);
    this.remember(key, await this.stamp(key), value);
  }

  private stamp(key: string): Promise<string | undefined> {
    return this.options.storage.stamp(this.file(key));
  }

  private remember(key: string, stamp: string | undefined, value: T): void {
    if (stamp === undefined) this.known.delete(key);
    else this.known.set(key, { stamp, value: this.remembered(value) });
  }

  private async current(key: string): Promise<Partial<T> | undefined> {
    const known = this.known.get(key);
    if (known && known.stamp === (await this.stamp(key))) return known.value;
    this.known.delete(key);
    return undefined;
  }

  settle(key: string): Promise<void> {
    return this.writes.run(key, () => this.upgrade(key));
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

  private async upgrade(key: string): Promise<void> {
    const backed = !(await this.options.unbacked?.(key));
    if (backed) await this.recover(key);
    if (await this.current(key)) return;
    let found: { file: string; value: unknown };
    try {
      found = await this.found(key);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found") return;
      throw err;
    }
    const { storage } = this.options;
    const { file, value } = found;
    const moved = file !== this.file(key);
    const context = await this.context(key, value);
    const next = migrate(this.options.migrations, value, context);
    if (next === value && !moved) return;
    const staged = JSON.stringify(next, null, 1);
    if (backed) this.options.validate?.(JSON.parse(staged));
    const created = new Map<string, string | Uint8Array>(
      (await this.options.effects?.created(key, context)) ?? [],
    );
    if (moved) created.set(this.file(key), staged);
    const place = () =>
      moved ? storage.remove(file) : storage.writeAtomic(file, staged);
    if (!backed) {
      await writeAll(storage, created);
      return place();
    }
    const from = (value as Record<string, unknown>)[
      this.options.migrations.field
    ];
    await backupNamespace(storage, this.dir(key)).migrate(
      `v${String(from)}`,
      created,
      async () => {
        await place();
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
        const { file, value } = await this.found(key);
        const context = await this.context(key, value);
        if (
          file !== this.file(key) ||
          migrate(this.options.migrations, value, context) !== value
        )
          out.outdated.push(key);
      } catch (err) {
        out.failed.push({ key, error: (err as Error).message });
      }
    }
    return out;
  }

  async remove(key: string, now = Date.now()): Promise<void> {
    await this.exclusive(key, async () => {
      if (this.options.root === "projects")
        await backupNamespace(this.options.storage, this.dir(key)).deleted(now);
      this.known.delete(key);
      await this.options.storage.remove(this.dir(key));
    });
  }

  async keys(): Promise<string[]> {
    const names = await this.options.storage.list(this.options.root);
    return names.filter((name) => this.options.key.test(name));
  }
}
