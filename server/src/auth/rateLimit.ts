import type { Response } from "express";
import { TIMING_MS } from "../tunables.js";

const USER_LIMIT = 5;
const IP_LIMIT = 20;
const KEY_LIMIT = 1000;
const HASH_LIMIT = 4;

type Counter = { count: number; since: number; limit: number };

export class HashCapacityError extends Error {}

export function refused(res: Response, seconds: number) {
  return res
    .set("Retry-After", String(seconds))
    .status(429)
    .json({ error: "rate limited" });
}

export class AuthRateLimiter {
  private readonly counters = new Map<string, Counter>();
  private activeHashes = 0;

  constructor(private readonly now: () => number = Date.now) {}

  private userKey(username: string): string {
    return `user:${username.normalize("NFKC").toLowerCase()}`;
  }

  private ipKey(ip: string): string {
    return `ip:${ip}`;
  }

  private expire(): void {
    const now = this.now();
    for (const [key, value] of this.counters)
      if (now - value.since >= TIMING_MS.authFailureWindow)
        this.counters.delete(key);
  }

  private wait(counter: Counter): number {
    return Math.max(
      1,
      Math.ceil(
        (counter.since + TIMING_MS.authFailureWindow - this.now()) / 1000,
      ),
    );
  }

  private capacity(keys: readonly string[]): number | null {
    let missing = keys.filter((key) => !this.counters.has(key)).length;
    if (this.counters.size + missing <= KEY_LIMIT) return null;
    for (const counter of this.counters.values())
      if (
        counter.count < counter.limit &&
        --missing + this.counters.size <= KEY_LIMIT
      )
        return null;
    return Math.min(
      ...[...this.counters.values()].map((counter) => this.wait(counter)),
    );
  }

  check(username: string, ip: string): number | null {
    this.expire();
    const keys = [this.userKey(username), this.ipKey(ip)];
    let wait = 0;
    for (const key of keys) {
      const counter = this.counters.get(key);
      if (counter && counter.count >= counter.limit)
        wait = Math.max(wait, this.wait(counter));
    }
    if (wait) return wait;
    return this.capacity(keys);
  }

  private add(key: string, limit: number): void {
    const existing = this.counters.get(key);
    if (existing) {
      existing.count++;
      return;
    }
    if (this.counters.size >= KEY_LIMIT) {
      for (const [oldKey, counter] of this.counters)
        if (counter.count < counter.limit) {
          this.counters.delete(oldKey);
          break;
        }
    }
    if (this.counters.size < KEY_LIMIT)
      this.counters.set(key, { count: 1, since: this.now(), limit });
  }

  failure(username: string, ip: string): void {
    this.expire();
    this.add(this.userKey(username), USER_LIMIT);
    this.add(this.ipKey(ip), IP_LIMIT);
  }

  success(username: string): void {
    this.counters.delete(this.userKey(username));
  }

  private acquireHash(): (() => void) | null {
    if (this.activeHashes >= HASH_LIMIT) return null;
    this.activeHashes++;
    return () => {
      this.activeHashes--;
    };
  }

  async hash<T>(run: () => Promise<T>): Promise<T> {
    const release = this.acquireHash();
    if (!release) throw new HashCapacityError();
    try {
      return await run();
    } finally {
      release();
    }
  }
}
