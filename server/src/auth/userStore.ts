import crypto from "node:crypto";
import { parse, user, ValidationError, type User } from "@rockett/shared";
import { JsonStore, StoreError } from "../store/jsonStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import type { Storage } from "../store/storage.js";

const USERS_VERSION = 1;
const KEY = "users";

export type UserRecord = User & { passwordHash: string };
export type NewUser = Pick<
  UserRecord,
  "username" | "displayName" | "role" | "passwordHash"
>;
export type UserPatch = Partial<
  Pick<UserRecord, "displayName" | "role" | "status" | "passwordHash">
>;

interface UsersFile {
  version: number;
  users: UserRecord[];
}

export function toPublicUser(record: UserRecord): User {
  const { passwordHash: _passwordHash, ...rest } = record;
  return rest;
}

function normalise(username: string): string {
  return username.normalize("NFKC").toLowerCase();
}

function check(record: UserRecord): UserRecord {
  parse(user, toPublicUser(record));
  if (!String(record.passwordHash).startsWith("scrypt$"))
    throw new ValidationError(
      "passwordHash is not a scrypt hash",
      "/passwordHash",
    );
  return record;
}

function validate(file: UsersFile): void {
  if (!Array.isArray(file.users))
    throw new ValidationError("users must be an array", "/users");
  file.users.forEach(check);
}

export class UserStore {
  private file: JsonStore<UsersFile>;
  private queue = new ProjectQueue();

  constructor(
    storage: Storage,
    private readonly now: () => number = Date.now,
  ) {
    this.file = new JsonStore({
      storage,
      root: "",
      name: "users",
      key: /^users$/,
      file: () => "users.json",
      migrations: {
        namespace: "users",
        current: USERS_VERSION,
        field: "version",
        steps: {},
      },
      validate,
    });
  }

  async list(): Promise<UserRecord[]> {
    return (await this.read()).users;
  }

  async get(id: string): Promise<UserRecord | undefined> {
    return (await this.list()).find((record) => record.id === id);
  }

  async findByUsername(username: string): Promise<UserRecord | undefined> {
    const wanted = normalise(username);
    return (await this.list()).find((record) => record.username === wanted);
  }

  create(input: NewUser): Promise<UserRecord> {
    return this.change((users, at) => this.insert(users, input, at));
  }

  createFirstAdmin(input: Omit<NewUser, "role">): Promise<UserRecord> {
    return this.change((users, at) => {
      if (users.length) throw new StoreError("setup is complete", "conflict");
      return this.insert(users, { ...input, role: "admin" }, at);
    });
  }

  private insert(users: UserRecord[], input: NewUser, at: string): UserRecord {
    const record = check({
      id: crypto.randomBytes(6).toString("hex"),
      username: normalise(input.username),
      displayName: input.displayName,
      role: input.role,
      status: "active",
      createdAt: at,
      modifiedAt: at,
      passwordHash: input.passwordHash,
    });
    if (users.some((other) => other.username === record.username))
      throw new StoreError(`username ${record.username} is taken`, "conflict");
    users.push(record);
    return record;
  }

  update(id: string, patch: UserPatch): Promise<UserRecord> {
    return this.change((users, at) => {
      const index = users.findIndex((record) => record.id === id);
      if (index < 0) throw new StoreError("user not found", "not_found");
      const record = check({ ...users[index]!, ...patch, modifiedAt: at });
      users[index] = record;
      return record;
    });
  }

  changePassword(
    id: string,
    expectedHash: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.queue.run(KEY, async () => {
      const file = await this.read();
      const index = file.users.findIndex((record) => record.id === id);
      const current = file.users[index];
      if (!current || current.passwordHash !== expectedHash) return false;
      file.users[index] = check({
        ...current,
        passwordHash,
        modifiedAt: new Date(this.now()).toISOString(),
      });
      await this.file.write(KEY, file);
      return true;
    });
  }

  private async read(): Promise<UsersFile> {
    let file: UsersFile;
    try {
      file = await this.file.read(KEY);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found")
        return { version: USERS_VERSION, users: [] };
      throw err;
    }
    try {
      validate(file);
    } catch {
      throw new StoreError("users.json is corrupted", "internal");
    }
    return file;
  }

  private change<R>(edit: (users: UserRecord[], at: string) => R): Promise<R> {
    return this.queue.run(KEY, async () => {
      const file = await this.read();
      const result = edit(file.users, new Date(this.now()).toISOString());
      await this.file.write(KEY, file);
      return result;
    });
  }
}
