import {
  documentSchema,
  featureSpec,
  opaqueFeature,
  parse,
  unloadedFeatureSchema,
  ValidationError,
  type CadDocument,
  type Feature,
} from "@rockett/shared";
import { MODULE_DATA_MAX_BYTES } from "../store/moduleData.js";

export function record(v: unknown, label: string): void {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ValidationError(`${label} must be an object`);
  }
}

function specFor(type: unknown) {
  const spec = typeof type === "string" ? featureSpec(type) : undefined;
  if (!spec) throw new ValidationError(`unknown feature type ${String(type)}`);
  return spec;
}

export function knownKeys(v: object, type: unknown): void {
  const known = specFor(type).paramsSchema.properties;
  const unknown = Object.keys(v).filter((key) => !Object.hasOwn(known, key));
  if (unknown.length)
    throw new ValidationError(
      `unknown ${String(type)} key ${unknown.join(", ")}`,
    );
}

export function validateFeature(f: Feature): void {
  record(f, "feature");
  specFor(f.type).validate(f);
}

export function validateBuilt(f: Feature): void {
  try {
    validateFeature(f);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    console.error(
      `[rockett] server-built ${f.type} fails the schema at ${err.detail ?? "an unnamed path"}`,
    );
    throw new Error("server-built feature fails the schema", { cause: err });
  }
}

function validateStored(f: Feature): void {
  record(f, "feature");
  if (typeof f.type !== "string" || !opaqueFeature(f))
    return validateFeature(f);
  const { params } = parse(unloadedFeatureSchema, f, "feature");
  if (Buffer.byteLength(JSON.stringify(params)) > MODULE_DATA_MAX_BYTES)
    throw new ValidationError(
      `${f.type} params are over ${MODULE_DATA_MAX_BYTES / 1024 / 1024} MiB`,
    );
}

export function validateDocument(doc: CadDocument): void {
  parse(documentSchema, doc);
  const ids = new Set<string>();
  for (const f of doc.features) {
    validateStored(f);
    if (ids.has(f.id))
      throw new ValidationError(`duplicate feature id ${f.id}`);
    ids.add(f.id);
  }
}
