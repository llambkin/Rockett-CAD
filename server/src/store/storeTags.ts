import crypto from "node:crypto";

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export const newId = () => crypto.randomBytes(6).toString("hex");

export function etag(value: unknown): string {
  return `"${sha256(JSON.stringify(value))}"`;
}

export function sameTag(header: string, value: unknown): boolean {
  return header.replace(/^W\//, "") === etag(value);
}
