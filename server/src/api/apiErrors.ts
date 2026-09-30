import type { Request, RequestHandler } from "express";
import {
  parse,
  ValidationError,
  type ApiErrorBody,
  type ApiErrorCode,
  type Route,
} from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";
import { ifMatchRevision, RevisionConflict } from "./revision.js";

const STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  too_large: 413,
  conflict: 409,
  precondition_required: 428,
  unprocessable: 422,
  kernel: 503,
  internal: 500,
};

export function sendError(res: any, body: ApiErrorBody) {
  res.status(STATUS[body.code]).json(body);
}

export function fail(req: Request, res: any, err: any) {
  const code: ApiErrorCode =
    err instanceof StoreError || err instanceof ValidationError
      ? err.code
      : "internal";
  if (code !== "internal")
    return sendError(res, {
      error: err.message,
      code,
      ...(err.detail !== undefined && { detail: err.detail }),
      ...(err instanceof RevisionConflict && {
        revision: err.revision,
        ...(err.draft && { draft: err.draft }),
      }),
    });
  console.error(`[rockett] 500 ${req.route?.path}: Internal server error`);
  sendError(res, { error: "Internal server error", code });
}

export function check(test: (req: any, res: any) => void): RequestHandler {
  return (req, res, next) => {
    try {
      test(req, res);
    } catch (err) {
      return fail(req, res, err);
    }
    next();
  };
}

export const parseBody = (schema: NonNullable<Route["body"]>) =>
  check((req) => (req.body = parse(schema, req.body ?? {})));

export const requireRevision = check((req, res) => {
  res.locals.revision = ifMatchRevision(req.get("If-Match"));
});
