import { createHmac, timingSafeEqual } from "node:crypto";

const PERIOD_MS = 30_000;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function totpStep(now: number): number {
  return Math.floor(now / PERIOD_MS);
}

export function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const value = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function matchTotp(
  key: Buffer,
  code: string,
  now: number,
  after = -1,
): number | null {
  const supplied = Buffer.from(code);
  let found: number | null = null;
  for (const step of [-1, 0, 1].map((offset) => totpStep(now) + offset)) {
    const expected = Buffer.from(hotp(key, step));
    if (
      step > after &&
      found === null &&
      expected.length === supplied.length &&
      timingSafeEqual(expected, supplied)
    )
      found = step;
  }
  return found;
}

export function base32(bytes: Buffer): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5)
    out += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

export function otpauthUri(username: string, secret: string): string {
  const issuer = encodeURIComponent("Rockett CAD");
  return `otpauth://totp/${issuer}:${encodeURIComponent(username)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_MS / 1000}`;
}
