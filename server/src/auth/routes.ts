import { Router, json, type Response } from "express";
import {
  AUTH_ROUTES,
  loginBody,
  parse,
  passwordChangeBody,
} from "@rockett/shared";
import { registerBootstrapRoutes } from "./bootstrap.js";
import {
  cookieConfig,
  readSessionCookie,
  sessionCookie,
  type CookieConfig,
} from "./cookie.js";
import {
  checkPasswordPolicy,
  DUMMY_HASH,
  hashPassword,
  PASSWORD_POLICY_MESSAGE,
  verifyPassword,
} from "./password.js";
import { AuthRateLimiter, HashCapacityError, refused } from "./rateLimit.js";
import type { SessionStore } from "./sessions.js";
import {
  registerTotpRoutes,
  signInScope,
  STEP_COOKIE_AGE,
} from "./totpRoutes.js";
import { toPublicUser, type UserStore } from "./userStore.js";
import { registerUserRoutes } from "./users.js";

type SignInResult =
  | "ok"
  | "needs-enrol"
  | "needs-code"
  | "bad-credentials"
  | "bad-code"
  | "rate-limited"
  | "rejected"
  | "error";

function signInResult(res: Response, code: boolean): SignInResult {
  const status = res.statusCode;
  if (res.locals.step) return `needs-${res.locals.step as "enrol" | "code"}`;
  if (status < 300) return "ok";
  if (status === 401 || status === 403)
    return code ? "bad-code" : "bad-credentials";
  if (status === 429) return "rate-limited";
  return status < 500 ? "rejected" : "error";
}

function logField(value: unknown): string {
  return JSON.stringify(
    typeof value === "string" ? value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, "") : "",
  );
}

function registerSignInLog(router: Router): void {
  for (const [event, route, code] of [
    ["login", AUTH_ROUTES.login, false],
    ["setup", AUTH_ROUTES.setup, false],
    ["password-change", AUTH_ROUTES.passwordChange, false],
    ["totp", AUTH_ROUTES.totp, true],
    ["totp-enrol", AUTH_ROUTES.totpConfirm, true],
    ["totp-off", AUTH_ROUTES.totpOff, true],
  ] as const)
    router.use(route.path, (req, res, next) => {
      if (req.method === route.method && req.path === "/")
        res.once("finish", () =>
          console.log(
            `[rockett] auth ${event} ${signInResult(res, code)} user=${logField(res.locals.user?.username ?? res.locals.account ?? req.body?.username)} ip=${logField(req.ip)} at ${new Date().toISOString()}`,
          ),
        );
      next();
    });
}

function registerSetupGuard(router: Router, limiter: AuthRateLimiter): void {
  router.use(
    AUTH_ROUTES.setup.path,
    json({ limit: "1kb" }),
    (req, res, next) => {
      if (req.method !== "POST") return next();
      const username = req.body?.username;
      const ip = req.ip ?? "";
      const wait = limiter.check(
        typeof username === "string" ? username : "",
        ip,
      );
      if (wait !== null) return refused(res, wait);
      if (typeof username !== "string" || username.length > 32) return next();
      res.once("finish", () => {
        if (res.statusCode === 201) limiter.success(username, ip);
        else if (res.statusCode === 403) limiter.failure(username, ip);
      });
      next();
    },
  );
}

function registerPasswordChange(
  router: Router,
  users: UserStore,
  sessions: SessionStore,
  cookie: CookieConfig,
  limiter: AuthRateLimiter,
  verify: typeof verifyPassword,
): void {
  router.post(
    AUTH_ROUTES.passwordChange.path,
    json({ limit: "2kb" }),
    async (req, res, next) => {
      try {
        const { current, next: nextPassword } = parse(
          passwordChangeBody,
          req.body ?? {},
        );
        const { id, username } = res.locals.user;
        const ip = req.ip ?? "";
        const wait = limiter.check(username, ip);
        if (wait !== null) return refused(res, wait);
        const record = await users.get(id);
        if (
          !record ||
          !(await limiter.hash(() => verify(current, record.passwordHash)))
        ) {
          limiter.failure(username, ip);
          return res.status(403).json({ error: "Incorrect current password." });
        }
        if (!checkPasswordPolicy(nextPassword))
          return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
        const passwordHash = await limiter.hash(() =>
          hashPassword(nextPassword),
        );
        if (
          !(await users.changePassword(id, record.passwordHash, passwordHash))
        )
          return res.status(403).json({ error: "Incorrect current password." });
        limiter.success(username, ip);
        await sessions.revokeUser(id);
        const token = await sessions.create(id);
        res.set("Set-Cookie", sessionCookie(cookie, token));
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  );
}

function registerLogin(
  router: Router,
  users: UserStore,
  sessions: SessionStore,
  cookie: CookieConfig,
  limiter: AuthRateLimiter,
  verify: typeof verifyPassword,
): void {
  router.post(
    AUTH_ROUTES.login.path,
    json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        const { username: name, password } = parse(loginBody, req.body ?? {});
        const record = await (name.includes("@")
          ? users.findByEmail(name)
          : users.findByUsername(name));
        res.locals.account = record?.username;
        const username = record?.username ?? name;
        const ip = req.ip ?? "";
        const wait = limiter.check(username, ip);
        if (wait !== null) return refused(res, wait);
        const matches = await limiter.hash(() =>
          verify(password, record?.passwordHash ?? DUMMY_HASH),
        );
        const login =
          record && matches
            ? await users.withActiveHash(
                record.id,
                record.passwordHash,
                async (current) => {
                  const oldToken = readSessionCookie(
                    req.headers.cookie,
                    cookie.name,
                  );
                  if (oldToken) await sessions.revoke(oldToken);
                  const scope = signInScope(current);
                  return {
                    current,
                    scope,
                    token: await sessions.create(current.id, scope),
                  };
                },
              )
            : undefined;
        if (!login) {
          limiter.failure(username, ip);
          return res.status(401).json({ error: "unauthenticated" });
        }
        if (login.scope !== "full") {
          res.locals.step = login.scope;
          res.set(
            "Set-Cookie",
            sessionCookie(cookie, login.token, STEP_COOKIE_AGE),
          );
          return res.json({ step: login.scope });
        }
        limiter.success(username, ip);
        res.set("Set-Cookie", sessionCookie(cookie, login.token));
        res.json(toPublicUser(login.current));
      } catch (err) {
        next(err);
      }
    },
  );
}

export function createAuthRouter(
  users: UserStore,
  sessions: SessionStore,
  cookie: CookieConfig = cookieConfig(process.env.ROCKETT_COOKIE_SECURE),
  setupToken: string | undefined = process.env.ROCKETT_SETUP_TOKEN,
  limiter = new AuthRateLimiter(),
  verify: typeof verifyPassword = verifyPassword,
): Router {
  const router = Router();
  registerSignInLog(router);
  registerSetupGuard(router, limiter);
  registerBootstrapRoutes(router, users, setupToken, limiter);
  registerLogin(router, users, sessions, cookie, limiter, verify);
  router.post(AUTH_ROUTES.logout.path, async (req, res, next) => {
    try {
      const token = readSessionCookie(req.headers.cookie, cookie.name);
      if (token) await sessions.revoke(token);
      res.set("Set-Cookie", sessionCookie(cookie, "", 0));
      res.set("Clear-Site-Data", '"cache"');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
  router.get(AUTH_ROUTES.me.path, (_req, res) => res.json(res.locals.user));
  registerPasswordChange(router, users, sessions, cookie, limiter, verify);
  registerTotpRoutes(router, users, sessions, cookie, limiter);
  registerUserRoutes(router, users, sessions, limiter);
  router.use(
    (
      err: unknown,
      _req: unknown,
      res: Response,
      next: (err: unknown) => void,
    ) => {
      if (err instanceof HashCapacityError) return refused(res, 1);
      next(err);
    },
  );
  return router;
}
