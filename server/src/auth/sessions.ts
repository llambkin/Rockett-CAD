import crypto from "node:crypto";
import {
  resolveSettings,
  SESSION_DAY_RANGE,
  SESSION_DAYS,
  SESSION_MAX_DAYS,
} from "@rockett/shared";
import { JsonStore, sha256, StoreError } from "../store/jsonStore.js";
import { SettingsStore } from "../store/settingsStore.js";
import type { Storage } from "../store/storage.js";
import { TIMING_MS } from "../tunables.js";

const MAX_PER_USER = 20;
const KEY = "sessions";
const SCOPES = ["full", "enrol", "code"] as const;

export type SessionScope = (typeof SCOPES)[number];

interface Session {
  userId: string;
  scope: SessionScope;
  createdAt: number;
  lastSeenAt: number;
}

interface SessionsFile {
  version: 1;
  sessions: Array<Session & { hash: string }>;
}

function validate(file: SessionsFile): void {
  if (
    file.version !== 1 ||
    !Array.isArray(file.sessions) ||
    !file.sessions.every(
      (session) =>
        /^[0-9a-f]{64}$/.test(String(session.hash)) &&
        typeof session.userId === "string" &&
        SCOPES.includes(session.scope) &&
        Number.isSafeInteger(session.createdAt) &&
        Number.isSafeInteger(session.lastSeenAt),
    )
  )
    throw new StoreError("sessions are corrupted", "internal");
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly enrolments = new Map<string, string>();
  private savedAt: number;
  private saving: Promise<void> | undefined;

  private constructor(
    private readonly file: JsonStore<SessionsFile>,
    private readonly settings: SettingsStore,
    private readonly now: () => number,
  ) {
    this.savedAt = now();
  }

  static async open(
    storage: Storage,
    now: () => number = Date.now,
  ): Promise<SessionStore> {
    const store = new SessionStore(
      new JsonStore({
        storage,
        root: "",
        name: "sessions",
        key: /^sessions$/,
        file: () => "sessions.json",
        migrations: {
          namespace: "sessions",
          current: 1,
          field: "version",
          steps: {},
        },
        validate,
      }),
      new SettingsStore(storage),
      now,
    );
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    let stored: SessionsFile;
    try {
      stored = await this.file.read(KEY);
    } catch (error) {
      if (error instanceof StoreError && error.code === "not_found") return;
      throw error;
    }
    validate(stored);
    const now = this.now();
    for (const { hash, ...session } of stored.sessions)
      if (!this.expired(session, now)) this.sessions.set(hash, session);
    if (this.sessions.size < stored.sessions.length) await this.save();
  }

  async create(userId: string, scope: SessionScope = "full"): Promise<string> {
    const now = this.now();
    const own: string[] = [];
    for (const [hash, session] of this.sessions) {
      if (this.expired(session, now)) this.drop(hash);
      else if (session.userId === userId) own.push(hash);
    }
    const excess = Math.max(0, own.length - MAX_PER_USER + 1);
    for (const hash of own.slice(0, excess)) this.drop(hash);
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(sha256(token), {
      userId,
      scope,
      createdAt: now,
      lastSeenAt: now,
    });
    await this.save();
    return token;
  }

  async resolve(
    token: string,
  ): Promise<{ userId: string; scope: SessionScope } | undefined> {
    const hash = sha256(token);
    const session = this.live(hash);
    if (!session) return undefined;
    const now = this.now();
    if (session.scope === "full" && (await this.outlived(session, now))) {
      if (this.drop(hash)) await this.save();
      return undefined;
    }
    session.lastSeenAt = now;
    if (session.lastSeenAt - this.savedAt >= TIMING_MS.sessionSave)
      await this.save();
    return { userId: session.userId, scope: session.scope };
  }

  startEnrolment(token: string, secret: string): void {
    const hash = sha256(token);
    if (this.live(hash)) this.enrolments.set(hash, secret);
  }

  enrolment(token: string): string | undefined {
    const hash = sha256(token);
    return this.live(hash) && this.enrolments.get(hash);
  }

  private live(hash: string): Session | undefined {
    const session = this.sessions.get(hash);
    if (session && this.expired(session, this.now())) {
      this.drop(hash);
      return undefined;
    }
    return session;
  }

  async revoke(token: string): Promise<void> {
    if (this.drop(sha256(token))) await this.save();
  }

  async revokeUser(userId: string, keepToken?: string): Promise<void> {
    const keep = keepToken === undefined ? undefined : sha256(keepToken);
    let dropped = false;
    for (const [hash, session] of this.sessions)
      if (session.userId === userId && hash !== keep)
        dropped = this.drop(hash) || dropped;
    if (dropped) await this.save();
  }

  private drop(hash: string): boolean {
    this.enrolments.delete(hash);
    return this.sessions.delete(hash);
  }

  private save(): Promise<void> {
    this.savedAt = this.now();
    if (this.saving) return this.saving;
    const saving = this.file.update(KEY, () => {
      this.saving = undefined;
      return {
        version: 1,
        sessions: [...this.sessions].map(([hash, session]) => ({
          hash,
          ...session,
        })),
      };
    });
    this.saving = saving;
    saving.catch(() => {
      if (this.saving === saving) this.saving = undefined;
    });
    return saving;
  }

  private async outlived(session: Session, now: number): Promise<boolean> {
    const idle = now - session.lastSeenAt;
    const day = TIMING_MS.sessionDay;
    if (idle < SESSION_DAY_RANGE.minimum * day) return false;
    const { values } = resolveSettings({
      app: await this.settings.read({ scope: "app" }),
      user: await this.settings.read({ scope: "user", id: session.userId }),
    });
    const days = Math.min(
      values[SESSION_DAYS.key]?.value as number,
      values[SESSION_MAX_DAYS.key]?.value as number,
    );
    return idle >= days * day;
  }

  private expired(session: Session, now: number): boolean {
    return session.scope === "full"
      ? now - session.lastSeenAt >= TIMING_MS.sessionLongest
      : now - session.createdAt >= TIMING_MS.signInStep;
  }
}
