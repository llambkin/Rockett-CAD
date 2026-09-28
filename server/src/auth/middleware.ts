import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { AUTH_ROUTES } from "@rockett/shared";
import { readSessionCookie, SESSION_COOKIE_NAME } from "./cookie.js";
import { verifyAccessJwt, type AccessKeyStore } from "./cfAccess.js";
import type { SessionScope, SessionStore } from "./sessions.js";
import { toPublicUser, type UserStore } from "./userStore.js";

function routeKeys(
  ...routes: Array<{ method: string; path: string }>
): ReadonlySet<string> {
  return new Set(routes.map((route) => `${route.method} /api${route.path}`));
}

export const PUBLIC_ROUTES = routeKeys(
  { method: "GET", path: "/health" },
  AUTH_ROUTES.login,
  AUTH_ROUTES.status,
  AUTH_ROUTES.setup,
);

const STEP_ROUTES: Record<
  Exclude<SessionScope, "full">,
  ReadonlySet<string>
> = {
  code: routeKeys(AUTH_ROUTES.totp, AUTH_ROUTES.logout),
  enrol: routeKeys(
    AUTH_ROUTES.totpEnrol,
    AUTH_ROUTES.totpConfirm,
    AUTH_ROUTES.logout,
  ),
};

export interface AccessIdentity {
  team: string;
  aud: string;
  keys: AccessKeyStore;
  now: () => number;
}

export function requireSession(
  sessions: SessionStore,
  users: UserStore,
  cookieName = SESSION_COOKIE_NAME,
  access?: AccessIdentity,
): RequestHandler {
  return async (req, res, next) => {
    const key = `${req.method} ${req.baseUrl}${req.path}`;
    if (PUBLIC_ROUTES.has(key)) return next();
    const token = readSessionCookie(req.headers.cookie, cookieName);
    let credential = token;
    try {
      const session = token ? await sessions.resolve(token) : undefined;
      let record = session ? await users.get(session.userId) : undefined;
      let scope: SessionScope = session?.scope ?? "full";
      if (record?.status !== "active" && token) await sessions.revoke(token);
      if (record?.status !== "active" && access) {
        const jwt = req.get("Cf-Access-Jwt-Assertion");
        if (jwt) {
          credential = jwt;
          try {
            const claims = verifyAccessJwt(jwt, await access.keys.keys(), {
              team: access.team,
              aud: access.aud,
              now: access.now(),
            });
            record = claims ? await users.findByEmail(claims.email) : undefined;
            scope = "full";
          } catch {
            record = undefined;
          }
        }
      }
      if (
        record?.status !== "active" ||
        (scope !== "full" && !STEP_ROUTES[scope].has(key))
      )
        return res.status(401).json({ error: "unauthenticated" });
      res.locals.user = toPublicUser(record);
      res.locals.scope = scope;
      res.locals.session = createHash("sha256")
        .update(credential ?? "")
        .digest("base64url");
      next();
    } catch (err) {
      next(err);
    }
  };
}
