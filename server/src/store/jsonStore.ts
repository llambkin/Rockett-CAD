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
  validate?: (value: T) => void;
}

export class JsonStore<T> {
  private writes = new ProjectQueue();

  constructor(readonly options: JsonStoreOptions<T>) {}

  dir(key: string): string {
    if (!this.options.key.test(key))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.posix.join(this.options.root, key);
  }

  async read(key: string): Promise<T> {
    const file = path.posix.join(this.dir(key), this.options.file);
    let raw: string;
    try {
      raw = (await this.options.storage.read(file)).toString("utf8");
    } catch {
      throw new StoreError(
        `${this.options.name} ${key} not found`,
        "not_found",
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new StoreError(
        `${this.options.name} ${key} is corrupted`,
        "internal",
      );
    }
    return migrate(this.options.migrations, value);
  }

  write(key: string, value: T): Promise<void> {
    return this.writes.run(key, async () => {
      this.options.validate?.(value);
      await this.options.storage.writeAtomic(
        path.posix.join(this.dir(key), this.options.file),
        JSON.stringify(value, null, 1),
      );
    });
  }

  async remove(key: string): Promise<void> {
    await this.options.storage.remove(this.dir(key));
  }

  async keys(): Promise<string[]> {
    const names = await this.options.storage.list(this.options.root);
    return names.filter((name) => this.options.key.test(name));
  }
}
