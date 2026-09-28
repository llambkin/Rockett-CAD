import { TIMING_MS } from "../tunables.js";

export interface CookieConfig {
  name: string;
  secure: boolean;
}

export function cookieConfig(value: string | undefined): CookieConfig {
  if (value === undefined || value === "" || value === "true")
    return { name: "__Host-rockett_session", secure: true };
  if (value === "false") return { name: "rockett_session", secure: false };
  throw new Error("ROCKETT_COOKIE_SECURE must be true or false");
}

export const SESSION_COOKIE_NAME = cookieConfig(undefined).name;

export function readSessionCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const cookie = part.trim();
    if (cookie.startsWith(`${name}=`))
      return cookie.slice(name.length + 1) || undefined;
  }
  return undefined;
}

export function sessionCookie(
  config: CookieConfig,
  token: string,
  maxAge = TIMING_MS.sessionLongest / 1000,
): string {
  return `${config.name}=${token}; ${config.secure ? "Secure; " : ""}HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
