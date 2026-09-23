import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ApiErrorCode } from "@rockett/shared";
import { ProjectQueue } from "./projectQueue.js";

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode = "validation",
  ) {
    super(message);
  }
}

export interface JsonStoreOptions<T> {
  root: string;
  name: string;
  key: RegExp;
  file: string;
  migrate: (raw: unknown) => T;
  validate?: (value: T) => void;
}

export class JsonStore<T> {
  private writes = new ProjectQueue();

  constructor(readonly options: JsonStoreOptions<T>) {}

  dir(key: string): string {
    if (!this.options.key.test(key))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.join(this.options.root, key);
  }

  async read(key: string): Promise<T> {
    const file = path.join(this.dir(key), this.options.file);
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
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
    return this.options.migrate(value);
  }

  write(key: string, value: T): Promise<void> {
    return this.writes.run(key, async () => {
      this.options.validate?.(value);
      const dir = this.dir(key);
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, this.options.file);
      const tmp = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
        await fs.rename(tmp, file);
      } finally {
        await fs.rm(tmp, { force: true });
      }
    });
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.dir(key), { recursive: true, force: true });
  }

  async keys(): Promise<string[]> {
    await fs.mkdir(this.options.root, { recursive: true });
    const entries = await fs.readdir(this.options.root, {
      withFileTypes: true,
    });
    return entries
      .filter((e) => e.isDirectory() && this.options.key.test(e.name))
      .map((e) => e.name);
  }
}
