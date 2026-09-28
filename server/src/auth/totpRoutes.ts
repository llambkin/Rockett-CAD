import { randomBytes } from "node:crypto";
import { json, type Request, type Response, type Router } from "express";
import { AUTH_ROUTES, parse, totpCodeBody } from "@rockett/shared";
import { StoreError } from "../store/jsonStore.js";
import { TIMING_MS } from "../tunables.js";
import {
  readSessionCookie,
  sessionCookie,
  type CookieConfig,
} from "./cookie.js";
import { refused, type AuthRateLimiter } from "./rateLimit.js";
import type { SessionScope, SessionStore } from "./sessions.js";
import { base32, otpauthUri } from "./totp.js";
import { toPublicUser, type UserRecord, type UserStore } from "./userStore.js";

export const STEP_COOKIE_AGE = TIMING_MS.signInStep / 1000;

export function signInScope(record: UserRecord): SessionScope {
  if (record.totp) return "code";
  return record.role === "admin" ? "enrol" : "full";
}

type CodeCheck = (code: string) => Promise<UserRecord | undefined>;

interface TotpDeps {
  users: UserStore;
  sessions: SessionStore;
  cookie: CookieConfig;
  limiter: AuthRateLimiter;
}

const token = ({ cookie }: TotpDeps, req: Request) =>
  readSessionCookie(req.headers.cookie, cookie.name);

async function withCode(
  { limiter }: TotpDeps,
  req: Request,
  res: Response,
  check: CodeCheck,
): Promise<UserRecord | undefined> {
  const { code } = parse(totpCodeBody, req.body ?? {});
  const { username } = res.locals.user;
  const ip = req.ip ?? "";
  const wait = limiter.check(username, ip);
  if (wait !== null) {
    refused(res, wait);
    return undefined;
  }
  const record = await check(code);
  if (!record) {
    limiter.failure(username, ip);
    res.status(403).json({ error: "Incorrect code." });
  }
  return record;
}

async function signIn(
  { limiter, cookie, sessions }: TotpDeps,
  res: Response,
  record: UserRecord,
): Promise<void> {
  limiter.success(record.username);
  res.set(
    "Set-Cookie",
    sessionCookie(cookie, await sessions.create(record.id)),
  );
  res.json(toPublicUser(record));
}

export function registerTotpRoutes(
  router: Router,
  users: UserStore,
  sessions: SessionStore,
  cookie: CookieConfig,
  limiter: AuthRateLimiter,
): void {
  const deps = { users, sessions, cookie, limiter };
  registerCodeStep(router, deps);
  registerEnrolRoutes(router, deps);
  registerTotpOff(router, deps);
}

function registerCodeStep(router: Router, deps: TotpDeps): void {
  const { users, sessions } = deps;
  router.post(
    AUTH_ROUTES.totp.path,
    json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        if (res.locals.scope !== "code")
          return res.status(409).json({ error: "No code is due." });
        const record = await withCode(deps, req, res, (code) =>
          users.acceptTotp(res.locals.user.id, code),
        );
        if (!record) return;
        await sessions.revoke(token(deps, req)!);
        await signIn(deps, res, record);
      } catch (err) {
        next(err);
      }
    },
  );
}

function registerEnrolRoutes(router: Router, deps: TotpDeps): void {
  const { users, sessions } = deps;
  router.post(AUTH_ROUTES.totpEnrol.path, async (req, res, next) => {
    try {
      const current = token(deps, req);
      const record = await users.get(res.locals.user.id);
      if (!record || record.totp)
        return res.status(409).json({ error: "TOTP is already on." });
      if (!current)
        return res
          .status(409)
          .json({ error: "Sign in with a password to enrol." });
      const secret = randomBytes(20);
      sessions.startEnrolment(current, secret.toString("hex"));
      res.set("Cache-Control", "no-store");
      res.json({
        secret: base32(secret),
        uri: otpauthUri(record.username, base32(secret)),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    AUTH_ROUTES.totpConfirm.path,
    json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        const current = token(deps, req);
        const secret = current && sessions.enrolment(current);
        if (!secret)
          return res.status(409).json({ error: "Start enrolment first." });
        const record = await withCode(deps, req, res, (code) =>
          users.enableTotp(res.locals.user.id, secret, code),
        );
        if (!record) return;
        await sessions.revokeUser(record.id);
        await signIn(deps, res, record);
      } catch (err) {
        if (err instanceof StoreError && err.code === "conflict")
          return res.status(409).json({ error: "TOTP is already on." });
        next(err);
      }
    },
  );
}

function registerTotpOff(router: Router, deps: TotpDeps): void {
  const { users } = deps;
  router.delete(
    AUTH_ROUTES.totpOff.path,
    json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        parse(totpCodeBody, req.body ?? {});
        if (res.locals.user.role === "admin")
          return res.status(409).json({ error: "Admins must keep TOTP." });
        if (!res.locals.user.totp)
          return res.status(409).json({ error: "TOTP is off." });
        const accepted = await withCode(deps, req, res, (code) =>
          users.acceptTotp(res.locals.user.id, code),
        );
        if (accepted)
          res.json(
            toPublicUser(await users.update(accepted.id, { totp: null })),
          );
      } catch (err) {
        next(err);
      }
    },
  );
}
