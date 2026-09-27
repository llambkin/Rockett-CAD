import { json, type RequestHandler, type Router } from "express";
import {
  AUTH_ROUTES,
  parse,
  userCreateBody,
  userPatchBody,
  ValidationError,
} from "@rockett/shared";
import { StoreError } from "../store/jsonStore.js";
import { checkPasswordPolicy, hashPassword } from "./password.js";
import { AuthRateLimiter } from "./rateLimit.js";
import type { SessionStore } from "./sessions.js";
import { toPublicUser, type UserStore } from "./userStore.js";

export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (res.locals.user?.role !== "admin")
    return res.status(403).json({ error: "forbidden" });
  next();
};

export function registerUserRoutes(
  router: Router,
  users: UserStore,
  sessions: SessionStore,
  limiter: AuthRateLimiter,
): void {
  router.get(AUTH_ROUTES.users.path, requireAdmin, async (_req, res, next) => {
    try {
      res.json((await users.list()).map(toPublicUser));
    } catch (err) {
      next(err);
    }
  });
  router.post(
    AUTH_ROUTES.userCreate.path,
    requireAdmin,
    json({ limit: "2kb" }),
    async (req, res, next) => {
      try {
        const { username, displayName, role, password, email } = parse(
          userCreateBody,
          req.body ?? {},
        );
        if (!checkPasswordPolicy(password))
          return res
            .status(400)
            .json({ error: "Password must be 12 to 256 characters." });
        const passwordHash = await limiter.hash(() => hashPassword(password));
        const record = await users.create({
          username,
          displayName,
          role,
          passwordHash,
          ...(email !== undefined && { email }),
        });
        res.status(201).json(toPublicUser(record));
      } catch (err) {
        userError(err, res, next);
      }
    },
  );
  router.patch(
    AUTH_ROUTES.userPatch.path,
    requireAdmin,
    json({ limit: "2kb" }),
    async (req, res, next) => {
      try {
        const { password, ...patch } = parse(userPatchBody, req.body ?? {});
        const id = req.params.id;
        if (typeof id !== "string")
          return res.status(404).json({ error: "user not found" });
        if (password !== undefined && !checkPasswordPolicy(password))
          return res
            .status(400)
            .json({ error: "Password must be 12 to 256 characters." });
        const passwordHash =
          password === undefined
            ? undefined
            : await limiter.hash(() => hashPassword(password));
        const record = await users.update(id, {
          ...patch,
          ...(passwordHash !== undefined && { passwordHash }),
        });
        if (record.status === "disabled" || passwordHash !== undefined)
          sessions.revokeUser(record.id);
        res.json(toPublicUser(record));
      } catch (err) {
        userError(err, res, next);
      }
    },
  );
}

function userError(
  err: unknown,
  res: Parameters<RequestHandler>[1],
  next: Parameters<RequestHandler>[2],
): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: "invalid user input" });
    return;
  }
  if (err instanceof StoreError && err.code === "conflict") {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof StoreError && err.code === "not_found") {
    res.status(404).json({ error: "user not found" });
    return;
  }
  next(err);
}
