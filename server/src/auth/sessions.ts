import crypto from "node:crypto";
import { TIMING_MS } from "../tunables.js";

const MAX_PER_USER = 20;

export type SessionScope = "full" | "enrol" | "code";

interface Session {
  userId: string;
  scope: SessionScope;
  createdAt: number;
  lastSeenAt: number;
  enrolment?: string;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => number = Date.now) {}

  create(userId: string, scope: SessionScope = "full"): string {
    const now = this.now();
    const own: string[] = [];
    for (const [token, session] of this.sessions) {
      if (this.expired(session, now)) this.sessions.delete(token);
      else if (session.userId === userId) own.push(token);
    }
    const excess = Math.max(0, own.length - MAX_PER_USER + 1);
    for (const token of own.slice(0, excess)) this.sessions.delete(token);
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, {
      userId,
      scope,
      createdAt: now,
      lastSeenAt: now,
    });
    return token;
  }

  resolve(token: string): { userId: string; scope: SessionScope } | undefined {
    const session = this.live(token);
    if (!session) return undefined;
    session.lastSeenAt = this.now();
    return { userId: session.userId, scope: session.scope };
  }

  startEnrolment(token: string, secret: string): void {
    const session = this.live(token);
    if (session) session.enrolment = secret;
  }

  enrolment(token: string): string | undefined {
    return this.live(token)?.enrolment;
  }

  private live(token: string): Session | undefined {
    const session = this.sessions.get(token);
    if (session && this.expired(session, this.now())) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }

  revoke(token: string): void {
    this.sessions.delete(token);
  }

  revokeUser(userId: string, keepToken?: string): void {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId && token !== keepToken) {
        this.sessions.delete(token);
      }
    }
  }

  private expired(session: Session, now: number): boolean {
    if (session.scope !== "full")
      return now - session.createdAt >= TIMING_MS.signInStep;
    return (
      now - session.lastSeenAt >= TIMING_MS.sessionIdle ||
      now - session.createdAt >= TIMING_MS.sessionAbsolute
    );
  }
}
