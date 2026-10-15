import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

const N = 32768;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MAX_MEM = 64 * 1024 * 1024;
const MIN_LENGTH = 12;
const MAX_LENGTH = 256;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const INTEGER = /^[1-9][0-9]{0,9}$/;

export const DUMMY_HASH = format(
  N,
  R,
  P,
  Buffer.alloc(SALT_BYTES),
  Buffer.alloc(KEY_BYTES),
);

function format(
  n: number,
  r: number,
  p: number,
  salt: Buffer,
  key: Buffer,
): string {
  return `scrypt$${n}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function derive(
  plain: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      plain,
      salt,
      length,
      { ...options, maxmem: MAX_MEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plain, salt, KEY_BYTES, { N, r: R, p: P });
  return format(N, R, P, salt, key);
}

export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  const [scheme, n = "", r = "", p = "", salt = "", key = ""] = parts;
  if (parts.length !== 6 || scheme !== "scrypt") return false;
  if (![n, r, p].every((value) => INTEGER.test(value))) return false;
  if (!BASE64URL.test(salt) || !BASE64URL.test(key)) return false;
  const expected = Buffer.from(key, "base64url");
  if (expected.length === 0) return false;
  try {
    const actual = await derive(
      plain,
      Buffer.from(salt, "base64url"),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      },
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function checkPasswordPolicy(plain: string): boolean {
  const length = [...plain].length;
  return length >= MIN_LENGTH && length <= MAX_LENGTH;
}
