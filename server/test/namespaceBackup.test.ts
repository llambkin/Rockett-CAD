import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupNamespace, JsonStore } from "../src/store/jsonStore.js";
import { LocalStorage } from "../src/store/storage.js";

interface Users {
  version: number;
  users: Array<{ name: string; email?: string | null }>;
}

const original = Buffer.from(
  '{ "version": 1,\n  "users": [ { "name": "ann" } ] }\n',
  "utf8",
);

async function tempStorage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-namespace-"));
  return { root, storage: new LocalStorage(root, fs) };
}

function usersStore(storage: LocalStorage) {
  return new JsonStore<Users>({
    storage,
    root: "",
    name: "users",
    key: /^users$/,
    file: "users.json",
    migrations: {
      namespace: "users",
      current: 2,
      field: "version",
      steps: {
        1: (value) => ({
          ...value,
          version: 2,
          users: (value.users as Users["users"]).map((u) => ({
            ...u,
            email: null,
          })),
        }),
      },
    },
  });
}

describe("backupNamespace", () => {
  it("backs up a users-namespace file byte-identically before a migration and restores the original bytes", async () => {
    const { root, storage } = await tempStorage();
    await storage.writeAtomic("users/users.json", original);
    const store = usersStore(storage);

    await store.update("users", (users) => ({
      ...users!,
      users: [...users!.users, { name: "bob", email: null }],
    }));

    const backups = await fs.readdir(path.join(root, "backups", "users"));
    expect(backups).toHaveLength(1);
    const [name] = backups;
    expect(name).toMatch(/^v1-[0-9a-f]{16}$/);
    expect(
      await fs.readFile(
        path.join(root, "backups", "users", name!, "files", "users.json"),
      ),
    ).toEqual(original);
    const migrated = JSON.parse(
      await fs.readFile(path.join(root, "users", "users.json"), "utf8"),
    );
    expect(migrated).toEqual({
      version: 2,
      users: [
        { name: "ann", email: null },
        { name: "bob", email: null },
      ],
    });

    await backupNamespace(storage, "users").restore(name!);
    expect(await fs.readFile(path.join(root, "users", "users.json"))).toEqual(
      original,
    );
  });

  it("restores a module namespace from its recovery record after a crash mid-migration", async () => {
    const { storage } = await tempStorage();
    const files = new Map([
      ["modules/demo/settings.json", Buffer.from('{"version":1}')],
      ["modules/demo/data/parts.bin", Buffer.from([0, 1, 2, 255])],
    ]);
    for (const [file, data] of files) await storage.writeAtomic(file, data);
    const backup = backupNamespace(storage, "modules/demo");

    await expect(
      backup.migrate("v1", async () => {
        await storage.writeAtomic("modules/demo/settings.json", "{}");
        throw new Error("crash");
      }),
    ).rejects.toThrow("crash");

    expect(await backup.recover()).toBe(true);
    for (const [file, data] of files)
      expect(await storage.read(file)).toEqual(data);
    expect(await backup.recover()).toBe(false);
  });

  it("refuses a damaged backup before it overwrites any live file", async () => {
    const { root, storage } = await tempStorage();
    await storage.writeAtomic("settings/a.json", original);
    await storage.writeAtomic("settings/settings.json", original);
    const backup = backupNamespace(storage, "settings");
    const name = await backup.backup("v1");
    await storage.writeAtomic("settings/a.json", "{}");
    await storage.writeAtomic("settings/settings.json", "{}");
    await fs.appendFile(
      path.join(root, "backups", "settings", name, "files", "settings.json"),
      "x",
    );
    await expect(backup.restore(name)).rejects.toThrow(/damaged/);
    expect(await storage.read("settings/a.json")).toEqual(Buffer.from("{}"));
    expect(await storage.read("settings/settings.json")).toEqual(
      Buffer.from("{}"),
    );
  });

  it("refuses a namespace or backup name outside its directory", async () => {
    const storage = new LocalStorage(os.tmpdir(), fs);
    expect(() => backupNamespace(storage, "../users")).toThrow(/invalid/);
    expect(() => backupNamespace(storage, "")).toThrow(/invalid/);
    await expect(
      backupNamespace(storage, "users").restore("../../v1-0123456789abcdef"),
    ).rejects.toThrow(/invalid/);
  });
});
