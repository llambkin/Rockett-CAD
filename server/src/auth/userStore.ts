import { parse, user, ValidationError, type User } from "@rockett/shared";
import { JsonStore, newId, StoreError } from "../store/jsonStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import type { Storage } from "../store/storage.js";
import { matchTotp } from "./totp.js";

const USERS_VERSION = 3;
const KEY = "users";

interface TotpState {
  secret: string;
  step: number;
}

export type UserRecord = Omit<User, "totp"> & {
  passwordHash: string;
  totp?: TotpState;
};
export type NewUser = Pick<
  UserRecord,
  "username" | "displayName" | "role" | "passwordHash" | "email"
>;
export type UserPatch = Partial<
  Pick<UserRecord, "displayName" | "role" | "status" | "passwordHash">
> & { email?: string | null; totp?: null };

interface UsersFile {
  version: number;
  users: UserRecord[];
}

export function toPublicUser(record: UserRecord): User {
  const { passwordHash: _passwordHash, totp, ...rest } = record;
  return totp ? { ...rest, totp: true } : rest;
}

function normalise(username: string): string {
  return username.normalize("NFKC").toLowerCase();
}

function email(value: string): string {
  return value.trim().toLowerCase();
}

function check(record: UserRecord): UserRecord {
  parse(user, toPublicUser(record));
  if (!String(record.passwordHash).startsWith("scrypt$"))
    throw new ValidationError(
      "passwordHash is not a scrypt hash",
      "/passwordHash",
    );
  if (
    record.totp !== undefined &&
    (!/^[0-9a-f]{40}$/.test(String(record.totp.secret)) ||
      !Number.isSafeInteger(record.totp.step) ||
      record.totp.step < 0)
  )
    throw new ValidationError("totp is not a secret and step", "/totp");
  return record;
}

function validate(file: UsersFile): void {
  if (!Array.isArray(file.users))
    throw new ValidationError("users must be an array", "/users");
  file.users.forEach(check);
  const emails = file.users
    .map((record) => record.email)
    .filter((value) => value !== undefined);
  if (new Set(emails).size !== emails.length)
    throw new ValidationError("duplicate email", "/users");
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
        steps: { 1: (file) => file, 2: (file) => file },
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

  async findByEmail(address: string): Promise<UserRecord | undefined> {
    const wanted = email(address);
    return (await this.list()).find((record) => record.email === wanted);
  }

  withActiveHash<R>(
    id: string,
    expectedHash: string,
    use: (record: UserRecord) => R,
  ): Promise<R | undefined> {
    return this.queue.run(KEY, async () => {
      const record = (await this.read()).users.find((entry) => entry.id === id);
      if (record?.status !== "active" || record.passwordHash !== expectedHash)
        return undefined;
      return use(record);
    });
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
      id: newId(),
      username: normalise(input.username),
      displayName: input.displayName,
      role: input.role,
      status: "active",
      createdAt: at,
      modifiedAt: at,
      passwordHash: input.passwordHash,
      ...(input.email !== undefined && { email: email(input.email) }),
    });
    if (users.some((other) => other.username === record.username))
      throw new StoreError(`username ${record.username} is taken`, "conflict");
    if (record.email && users.some((other) => other.email === record.email))
      throw new StoreError("email is taken", "conflict");
    users.push(record);
    return record;
  }

  update(id: string, patch: UserPatch): Promise<UserRecord> {
    return this.change((users, at) => {
      const index = users.findIndex((record) => record.id === id);
      if (index < 0) throw new StoreError("user not found", "not_found");
      const { email: address, totp: clear, ...rest } = patch;
      const { email: _oldEmail, totp: oldTotp, ...current } = users[index]!;
      const record = check({
        ...current,
        ...rest,
        ...(clear === undefined && oldTotp !== undefined && { totp: oldTotp }),
        ...(address === undefined &&
          _oldEmail !== undefined && { email: _oldEmail }),
        ...(typeof address === "string" && { email: email(address) }),
        modifiedAt: at,
      });
      if (
        record.email &&
        users.some((other) => other.id !== id && other.email === record.email)
      )
        throw new StoreError("email is taken", "conflict");
      if (
        users[index]!.role === "admin" &&
        users[index]!.status === "active" &&
        (record.role !== "admin" || record.status !== "active") &&
        !users.some(
          (other) =>
            other.id !== id &&
            other.role === "admin" &&
            other.status === "active",
        )
      )
        throw new StoreError("last active admin cannot be changed", "conflict");
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

  enableTotp(
    id: string,
    secret: string,
    code: string,
  ): Promise<UserRecord | undefined> {
    return this.totpChange(id, (record) => {
      if (record.totp) throw new StoreError("totp is on", "conflict");
      const step = matchTotp(Buffer.from(secret, "hex"), code, this.now());
      return step === null ? undefined : { secret, step };
    });
  }

  acceptTotp(id: string, code: string): Promise<UserRecord | undefined> {
    return this.totpChange(id, ({ totp }) => {
      if (!totp) return undefined;
      const step = matchTotp(
        Buffer.from(totp.secret, "hex"),
        code,
        this.now(),
        totp.step,
      );
      return step === null ? undefined : { secret: totp.secret, step };
    });
  }

  private totpChange(
    id: string,
    next: (record: UserRecord) => TotpState | undefined,
  ): Promise<UserRecord | undefined> {
    return this.queue.run(KEY, async () => {
      const file = await this.read();
      const index = file.users.findIndex((record) => record.id === id);
      const current = file.users[index];
      if (current?.status !== "active") return undefined;
      const totp = next(current);
      if (!totp) return undefined;
      const record = check({ ...current, totp });
      file.users[index] = record;
      await this.file.write(KEY, file);
      return record;
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
