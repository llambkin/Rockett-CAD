import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { TIMING_MS } from "../tunables.js";

type AccessClaims = {
  iss: string;
  aud: string | string[];
  email: string;
  exp: number;
  nbf: number;
};

type AccessOptions = { team: string; aud: string; now: number };

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TEAM = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decode(value: string): unknown {
  if (!BASE64URL.test(value)) throw new Error("invalid JWT encoding");
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

export function verifyAccessJwt(
  jwt: string,
  keys: ReadonlyMap<string, KeyObject>,
  { team, aud, now }: AccessOptions,
): AccessClaims | null {
  if (jwt.length > 16_384) return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const [head, body, signature] = parts;
  if (!head || !body || !signature || !BASE64URL.test(signature)) return null;
  try {
    const header = decode(head);
    const claims = decode(body);
    if (
      !object(header) ||
      header.alg !== "RS256" ||
      typeof header.kid !== "string"
    )
      return null;
    const key = keys.get(header.kid);
    if (!key || !object(claims)) return null;
    if (
      claims.iss !== `https://${team}.cloudflareaccess.com` ||
      !(
        claims.aud === aud ||
        (Array.isArray(claims.aud) && claims.aud.includes(aud))
      ) ||
      typeof claims.email !== "string" ||
      !claims.email ||
      !Number.isInteger(claims.exp) ||
      !Number.isInteger(claims.nbf) ||
      (claims.exp as number) * 1000 < now - TIMING_MS.accessJwtSkew ||
      (claims.nbf as number) * 1000 > now + TIMING_MS.accessJwtSkew
    )
      return null;
    const valid = verify(
      "RSA-SHA256",
      Buffer.from(`${head}.${body}`),
      key,
      Buffer.from(signature, "base64url"),
    );
    return valid ? (claims as AccessClaims) : null;
  } catch {
    return null;
  }
}

export class AccessKeyStore {
  private cached?: { keys: ReadonlyMap<string, KeyObject>; until: number };
  private inFlight: Promise<ReadonlyMap<string, KeyObject>> | undefined;

  constructor(
    private readonly team: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    if (!TEAM.test(team)) throw new Error("Invalid Cloudflare Access team");
  }

  async keys(): Promise<ReadonlyMap<string, KeyObject>> {
    const now = this.now();
    if (this.cached && now < this.cached.until) return this.cached.keys;
    if (this.inFlight) return this.inFlight;
    const load = this.fetchKeys();
    this.inFlight = load;
    try {
      return await load;
    } finally {
      if (this.inFlight === load) this.inFlight = undefined;
    }
  }

  private async fetchKeys(): Promise<ReadonlyMap<string, KeyObject>> {
    const now = this.now();
    const url = `https://${this.team}.cloudflareaccess.com/cdn-cgi/access/certs`;
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.fetcher(url, {
          signal: AbortSignal.timeout(TIMING_MS.accessKeyFetch),
        });
        if (!response.ok)
          throw new Error("Cloudflare Access cert fetch failed");
        const data: unknown = await response.json();
        if (
          !object(data) ||
          !Array.isArray(data.keys) ||
          data.keys.length === 0
        )
          throw new Error("Invalid Cloudflare Access certs");
        const keys = new Map<string, KeyObject>();
        for (const item of data.keys) {
          if (
            !object(item) ||
            item.kty !== "RSA" ||
            typeof item.kid !== "string"
          )
            throw new Error("Invalid Cloudflare Access key");
          keys.set(item.kid, createPublicKey({ key: item, format: "jwk" }));
        }
        this.cached = { keys, until: now + TIMING_MS.accessKeyCache };
        return keys;
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }
}
