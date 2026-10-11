import path from "node:path";
import type { UserData, UserDataEntry } from "@rockett/plugin-api";
import { MODULE_DATA_MAX_BYTES, type User } from "@rockett/shared";
import { etag, StoreError } from "./jsonStore.js";
import { ID_RE } from "./manifestStore.js";
import { ProjectQueue } from "./projectQueue.js";
import { readFirst, type Storage } from "./storage.js";

export { MODULE_DATA_MAX_BYTES };

type Stored = { version: number; data: unknown };

const isVersion = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 1;

const isStored = (value: unknown): value is Stored =>
  typeof value === "object" &&
  value !== null &&
  "data" in value &&
  "version" in value &&
  isVersion(value.version);

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function moduleUserData(storage: Storage, moduleId: string) {
  const writes = new ProjectQueue();
  return (name: string, version: number): UserData => {
    if (!ID_RE.test(name))
      throw new Error(`user data name ${JSON.stringify(name)} is invalid`);
    if (!isVersion(version))
      throw new Error(`user data ${name} needs a whole version from 1`);
    const label = `${moduleId} ${name}`;
    const file = (user: User) => {
      if (!ID_RE.test(user.id)) throw new StoreError("invalid user id");
      return path.posix.join(
        "users",
        user.id,
        "modules",
        moduleId,
        `${name}.json`,
      );
    };
    const entry = (stored: Stored): UserDataEntry => ({
      version: stored.version,
      data: stored.data,
      etag: etag(stored),
      readOnly: stored.version > version,
    });
    const load = async (at: string) => {
      const found = await readFirst(storage, [at]);
      if (!found) return null;
      const stored = parsed(found.data.toString("utf8"));
      if (!isStored(stored))
        throw new StoreError(`${label} data is corrupted`, "internal");
      return entry(stored);
    };
    return {
      read: (user) => load(file(user)),
      write: (user, data, expected) => {
        const at = file(user);
        return writes.run(at, async () => {
          const current = await load(at);
          if (current?.readOnly)
            throw new StoreError(
              `${label} was saved by a newer version and is read only.`,
              "conflict",
            );
          if ((current?.etag ?? null) !== expected)
            throw new StoreError(
              `${label} changed in another session.`,
              "conflict",
            );
          const text = JSON.stringify({ version, data }, null, 1);
          const stored = parsed(text);
          if (!isStored(stored))
            throw new StoreError(`${label} data must be JSON`);
          if (Buffer.byteLength(text) > MODULE_DATA_MAX_BYTES)
            throw new StoreError(
              `${label} is over ${MODULE_DATA_MAX_BYTES / 1024 / 1024} MiB.`,
              "too_large",
            );
          await storage.writeAtomic(at, text);
          return entry(stored);
        });
      },
    };
  };
}
