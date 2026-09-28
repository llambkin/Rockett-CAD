import {
  documentSchema,
  FEATURE_SCHEMAS,
  featureSpec,
  parse,
  ValidationError,
  type CadDocument,
  type Feature,
  type FeatureType,
} from "@rockett/shared";

export function record(v: unknown, label: string): void {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ValidationError(`${label} must be an object`);
  }
}

function schemaFor(type: unknown) {
  if (typeof type !== "string" || !Object.hasOwn(FEATURE_SCHEMAS, type))
    throw new ValidationError(`unknown feature type ${String(type)}`);
  return FEATURE_SCHEMAS[type as FeatureType];
}

export function knownKeys(v: object, type: unknown): void {
  const known = schemaFor(type).properties;
  const unknown = Object.keys(v).filter((key) => !Object.hasOwn(known, key));
  if (unknown.length)
    throw new ValidationError(
      `unknown ${String(type)} key ${unknown.join(", ")}`,
    );
}

export function validateFeature(f: Feature): void {
  record(f, "feature");
  const spec = featureSpec(f.type);
  if (spec) return spec.validate(f);
  parse(schemaFor(f.type), f);
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

export function validateDocument(doc: CadDocument): void {
  parse(documentSchema, doc);
  const ids = new Set<string>();
  for (const f of doc.features) {
    validateFeature(f);
    if (ids.has(f.id))
      throw new ValidationError(`duplicate feature id ${f.id}`);
    ids.add(f.id);
  }
}
