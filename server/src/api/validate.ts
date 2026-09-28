import {
  documentSchema,
  featureSpec,
  parse,
  ValidationError,
  type CadDocument,
  type Feature,
} from "@rockett/shared";

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
