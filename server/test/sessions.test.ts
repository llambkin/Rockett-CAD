import { describe, expect, it } from "vitest";
import { SessionStore } from "../src/auth/sessions.js";

const DAY = 24 * 60 * 60 * 1000;

function fakeClock() {
  const clock = { now: 0 };
  return { clock, store: new SessionStore(() => clock.now) };
}

describe("session store", () => {
  it("issues a 32-byte base64url token that resolves to its user", () => {
    const { store } = fakeClock();
    const token = store.create("u1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(store.resolve(token)).toBe("u1");
    expect(store.resolve("not-a-token")).toBeUndefined();
  });

  it("expires a session idle for 7 days and slides on resolve", () => {
    const { clock, store } = fakeClock();
    const active = store.create("u1");
    const idle = store.create("u1");
    clock.now = 6 * DAY;
    expect(store.resolve(active)).toBe("u1");
    clock.now = 7 * DAY - 1;
    expect(store.resolve(idle)).toBe("u1");
    clock.now = 14 * DAY - 1;
    expect(store.resolve(idle)).toBeUndefined();
    expect(store.resolve(active)).toBeUndefined();
  });

  it("expires a session 30 days after creation however often it is used", () => {
    const { clock, store } = fakeClock();
    const token = store.create("u1");
    for (let day = 1; day < 30; day++) {
      clock.now = day * DAY;
      expect(store.resolve(token)).toBe("u1");
    }
    clock.now = 30 * DAY;
    expect(store.resolve(token)).toBeUndefined();
  });

  it("revokes one token", () => {
    const { store } = fakeClock();
    const a = store.create("u1");
    const b = store.create("u1");
    store.revoke(a);
    expect(store.resolve(a)).toBeUndefined();
    expect(store.resolve(b)).toBe("u1");
  });

  it("revokes every session of a user except a kept token", () => {
    const { store } = fakeClock();
    const keep = store.create("u1");
    const drop = store.create("u1");
    const other = store.create("u2");
    store.revokeUser("u1", keep);
    expect(store.resolve(keep)).toBe("u1");
    expect(store.resolve(drop)).toBeUndefined();
    expect(store.resolve(other)).toBe("u2");
    store.revokeUser("u1");
    expect(store.resolve(keep)).toBeUndefined();
    expect(store.resolve(other)).toBe("u2");
  });

  it("keeps at most 20 sessions per user and evicts the oldest", () => {
    const { clock, store } = fakeClock();
    const tokens: string[] = [];
    for (let i = 0; i < 21; i++) {
      clock.now = i;
      tokens.push(store.create("u1"));
    }
    const other = store.create("u2");
    expect(store.resolve(tokens[0]!)).toBeUndefined();
    for (const token of tokens.slice(1)) {
      expect(store.resolve(token)).toBe("u1");
    }
    expect(store.resolve(other)).toBe("u2");
  });

  it("prunes expired sessions on create before applying the cap", () => {
    const { clock, store } = fakeClock();
    const survivor = store.create("u1");
    for (let i = 0; i < 19; i++) store.create("u1");
    clock.now = 6 * DAY;
    expect(store.resolve(survivor)).toBe("u1");
    clock.now = 8 * DAY;
    const fresh = store.create("u1");
    expect(store.resolve(survivor)).toBe("u1");
    expect(store.resolve(fresh)).toBe("u1");
  });

  it("never issues the same token twice over 10,000 creates", () => {
    const { store } = fakeClock();
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(store.create("u1"));
    expect(seen.size).toBe(10_000);
  });
});
