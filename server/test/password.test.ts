import { randomBytes, scrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkPasswordPolicy,
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
} from "../src/auth/password.js";

const PLAIN = "correct horse battery";

function flipFirst(segment: string): string {
  return (segment[0] === "A" ? "B" : "A") + segment.slice(1);
}

function withSegment(stored: string, index: number, value: string): string {
  const parts = stored.split("$");
  parts[index] = value;
  return parts.join("$");
}

describe("hashPassword", () => {
  it("writes scrypt parameters, a 16-byte salt and a 64-byte key", async () => {
    const stored = await hashPassword(PLAIN);
    const [scheme, n, r, p, salt, key, ...rest] = stored.split("$");
    expect([scheme, n, r, p, rest.length]).toEqual([
      "scrypt",
      "32768",
      "8",
      "1",
      0,
    ]);
    expect(salt).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(salt!, "base64url")).toHaveLength(16);
    expect(Buffer.from(key!, "base64url")).toHaveLength(64);
  });

  it("uses a fresh salt each time", async () => {
    expect(await hashPassword(PLAIN)).not.toBe(await hashPassword(PLAIN));
  });
});

describe("verifyPassword", () => {
  it("accepts the password it hashed and rejects a wrong one", async () => {
    const stored = await hashPassword(PLAIN);
    expect(await verifyPassword(PLAIN, stored)).toBe(true);
    expect(await verifyPassword(`${PLAIN}!`, stored)).toBe(false);
  });

  it("rejects a tampered salt or key", async () => {
    const stored = await hashPassword(PLAIN);
    const [, , , , salt, key] = stored.split("$");
    expect(
      await verifyPassword(PLAIN, withSegment(stored, 4, flipFirst(salt!))),
    ).toBe(false);
    expect(
      await verifyPassword(PLAIN, withSegment(stored, 5, flipFirst(key!))),
    ).toBe(false);
  });

  it("verifies a hash made with N 16384 from its stored parameters", async () => {
    const salt = randomBytes(16);
    const key = await new Promise<Buffer>((resolve, reject) =>
      scrypt(PLAIN, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) =>
        error ? reject(error) : resolve(derived),
      ),
    );
    const stored = `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
    expect(await verifyPassword(PLAIN, stored)).toBe(true);
    expect(await verifyPassword(`${PLAIN}!`, stored)).toBe(false);
  });

  it("returns false for malformed strings without throwing", async () => {
    const stored = await hashPassword(PLAIN);
    const malformed = [
      "",
      "scrypt",
      stored.replace(/^scrypt/, "bcrypt"),
      `${stored}$extra`,
      withSegment(stored, 1, "abc"),
      withSegment(stored, 1, "1000"),
      withSegment(stored, 1, "1048576"),
      withSegment(stored, 2, "0"),
      withSegment(stored, 3, "-1"),
      withSegment(stored, 4, ""),
      withSegment(stored, 5, ""),
      withSegment(stored, 5, "A"),
      withSegment(stored, 5, "not+base64/url="),
    ];
    for (const bad of malformed) {
      await expect(verifyPassword(PLAIN, bad)).resolves.toBe(false);
    }
  });

  it("offers DUMMY_HASH as a well-formed hash no password matches", async () => {
    const [scheme, n, r, p] = DUMMY_HASH.split("$");
    expect([scheme, n, r, p]).toEqual(["scrypt", "32768", "8", "1"]);
    expect(await verifyPassword(PLAIN, DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  });
});

describe("checkPasswordPolicy", () => {
  it("accepts 12 to 256 characters", () => {
    expect(checkPasswordPolicy("a".repeat(11))).toBe(false);
    expect(checkPasswordPolicy("a".repeat(12))).toBe(true);
    expect(checkPasswordPolicy("a".repeat(256))).toBe(true);
    expect(checkPasswordPolicy("a".repeat(257))).toBe(false);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(checkPasswordPolicy("\u{1F511}".repeat(12))).toBe(true);
    expect(checkPasswordPolicy("\u{1F511}".repeat(11))).toBe(false);
  });
});
