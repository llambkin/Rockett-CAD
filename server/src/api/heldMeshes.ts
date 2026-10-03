import type { Request, Response } from "express";
import {
  ValidationError,
  type EvaluateResult,
  type WireEvaluateResult,
} from "@rockett/shared";

function heldKeys(body: unknown): ReadonlySet<string> | undefined {
  const held = (body as { held?: unknown } | undefined)?.held;
  if (held === undefined) return undefined;
  if (!Array.isArray(held))
    throw new ValidationError("held must be an array", "/held");
  const bad = held.findIndex((key) => typeof key !== "string");
  if (bad >= 0)
    throw new ValidationError("held must hold mesh keys", `/held/${bad}`);
  return new Set(held);
}

function withoutHeld(
  evaluation: EvaluateResult,
  held: ReadonlySet<string>,
): WireEvaluateResult {
  return {
    ...evaluation,
    bodies: evaluation.bodies.map((body) =>
      held.has(body.meshKey)
        ? {
            bodyId: body.bodyId,
            name: body.name,
            meshKey: body.meshKey,
          }
        : body,
    ),
  };
}

export function omitHeldMeshes(req: Request, res: Response): void {
  const held = heldKeys(req.body);
  if (!held) return;
  const json = res.json.bind(res);
  res.json = (body?: EvaluateResult | { evaluation?: EvaluateResult }) =>
    json(
      body && "bodies" in body
        ? withoutHeld(body, held)
        : body?.evaluation
          ? { ...body, evaluation: withoutHeld(body.evaluation, held) }
          : body,
    );
}
