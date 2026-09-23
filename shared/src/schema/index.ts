import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export class ValidationError extends Error {
  readonly code = "validation";
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export function parse<S extends TSchema>(schema: S, value: unknown): Static<S> {
  if (Value.Check(schema, value)) return value;
  const errors = Value.Errors(schema, value);
  const error =
    errors.find((e) => !e.schemaPath.includes("/anyOf/")) ?? errors[0];
  const path = error?.instancePath ?? "";
  const field = path.slice(1).replaceAll("/", ".") || "request";
  throw new ValidationError(`${field} ${error?.message ?? "is invalid"}`, path);
}
