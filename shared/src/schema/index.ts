import type { Static, TSchema } from "typebox";
import { Compile, type Validator } from "typebox/compile";
import { Value } from "typebox/value";
import { documentSchema, FEATURE_SCHEMAS } from "./features.js";

export class ValidationError extends Error {
  readonly code = "validation";
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

const compiled = new WeakMap<TSchema, Validator>();

function validator(schema: TSchema): Validator {
  let found = compiled.get(schema);
  if (!found) compiled.set(schema, (found = Compile(schema)));
  return found;
}

export function parse<S extends TSchema>(
  schema: S,
  value: unknown,
  root?: string,
): Static<S> {
  if (validator(schema).Check(value)) return value as Static<S>;
  const errors = Value.Errors(schema, value);
  const error =
    errors.find((e) => !e.schemaPath.includes("/anyOf/")) ?? errors[0];
  const path = error?.instancePath ?? "";
  const field =
    [root, path.slice(1).replaceAll("/", ".")].filter(Boolean).join(".") ||
    "request";
  throw new ValidationError(`${field} ${error?.message ?? "is invalid"}`, path);
}

export function compileSchemas(): void {
  for (const schema of [documentSchema, ...Object.values(FEATURE_SCHEMAS)])
    validator(schema);
}
