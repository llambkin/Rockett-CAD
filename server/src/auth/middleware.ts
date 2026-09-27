import type { RequestHandler } from "express";
import { AUTH_ROUTES } from "@rockett/shared";
import { readSessionCookie, SESSION_COOKIE_NAME } from "./cookie.js";
import { verifyAccessJwt, type AccessKeyStore } from "./cfAccess.js";
import type { SessionStore } from "./sessions.js";
import { toPublicUser, type UserStore } from "./userStore.js";

export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/health",
  `${AUTH_ROUTES.login.method} /api${AUTH_ROUTES.login.path}`,
  `${AUTH_ROUTES.status.method} /api${AUTH_ROUTES.status.path}`,
  `${AUTH_ROUTES.setup.method} /api${AUTH_ROUTES.setup.path}`,
]);

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
    if (PUBLIC_ROUTES.has(`${req.method} ${req.baseUrl}${req.path}`))
      return next();
    const token = readSessionCookie(req.headers.cookie, cookieName);
    try {
      const userId = token && sessions.resolve(token);
      let record = userId ? await users.get(userId) : undefined;
      if (record?.status !== "active" && token) sessions.revoke(token);
      if (record?.status !== "active" && access) {
        const jwt = req.get("Cf-Access-Jwt-Assertion");
        if (jwt) {
          try {
            const claims = verifyAccessJwt(jwt, await access.keys.keys(), {
              team: access.team,
              aud: access.aud,
              now: access.now(),
            });
            record = claims ? await users.findByEmail(claims.email) : undefined;
          } catch {
            record = undefined;
          }
        }
      }
      if (record?.status !== "active") {
        return res.status(401).json({ error: "unauthenticated" });
      }
      res.locals.user = toPublicUser(record);
      next();
    } catch (err) {
      next(err);
    }
  };
}
