import { createHash, timingSafeEqual } from "node:crypto";
import { json, type Router } from "express";
import {
  AUTH_ROUTES,
  parse,
  setupBody,
  ValidationError,
} from "@rockett/shared";
import { StoreError } from "../store/jsonStore.js";
import {
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_POLICY_MESSAGE,
} from "./password.js";
import { AuthRateLimiter } from "./rateLimit.js";
import { toPublicUser, type UserStore } from "./userStore.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

function setupTokenMatches(
  configured: string | undefined,
  supplied: string,
): boolean {
  if (!configured) return false;
  return timingSafeEqual(digest(configured), digest(supplied));
}

export async function createFirstAdmin(
  users: UserStore,
  input: { username: string; displayName: string; password: string },
  limiter: AuthRateLimiter,
) {
  if (!checkPasswordPolicy(input.password))
    throw new Error(PASSWORD_POLICY_MESSAGE);
  return users.createFirstAdmin({
    username: input.username,
    displayName: input.displayName,
    passwordHash: await limiter.hash(() => hashPassword(input.password)),
  });
}

export function registerBootstrapRoutes(
  router: Router,
  users: UserStore,
  setupToken: string | undefined,
  limiter: AuthRateLimiter,
): void {
  router.get(AUTH_ROUTES.status.path, async (_req, res, next) => {
    try {
      const usersExist = (await users.list()).length > 0;
      res.json({
        setup: usersExist ? "done" : setupToken ? "ready" : "needs-token",
      });
    } catch (err) {
      next(err);
    }
  });
  router.post(
    AUTH_ROUTES.setup.path,
    json({ limit: "1kb" }),
    async (req, res, next) => {
      try {
        if ((await users.list()).length)
          return res.status(409).json({ error: "setup is complete" });
        const { token } = req.body ?? {};
        if (typeof token !== "string" || !setupTokenMatches(setupToken, token))
          return res.status(403).json({ error: "invalid setup token" });
        const { username, displayName, password } = parse(setupBody, req.body);
        const record = await createFirstAdmin(
          users,
          { username, displayName, password },
          limiter,
        );
        res.status(201).json(toPublicUser(record));
      } catch (err) {
        if (err instanceof ValidationError)
          return res.status(400).json({ error: "invalid setup input" });
        if (err instanceof StoreError && err.code === "conflict")
          return res.status(409).json({ error: "setup is complete" });
        if (err instanceof Error && err.message === PASSWORD_POLICY_MESSAGE)
          return res.status(400).json({ error: err.message });
        next(err);
      }
    },
  );
}
