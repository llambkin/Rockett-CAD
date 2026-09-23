import {
  documentSchema,
  FEATURE_SCHEMAS,
  parse,
  ValidationError,
  type CadDocument,
  type Feature,
  type FeatureType,
  type SketchFeature,
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

const MIN_OFFSET_MM = 1e-7;

function sketchReferences(f: SketchFeature): void {
  const offsetIds = new Set<string>();
  const outputs = new Set<string>();
  for (const offset of f.offsets ?? []) {
    if (offsetIds.has(offset.id))
      throw new ValidationError("duplicate offset id");
    offsetIds.add(offset.id);
    if (Math.abs(offset.distance) < MIN_OFFSET_MM)
      throw new ValidationError("offset distance must be non-zero");
    for (const id of offset.entityIds) {
      if (outputs.has(id) || offset.sourceIds.includes(id))
        throw new ValidationError(
          "offset outputs must be distinct from sources and other offsets",
        );
      outputs.add(id);
    }
  }
  const entityIds = new Set(f.entities.map((e) => e.id));
  if (entityIds.size !== f.entities.length)
    throw new ValidationError("duplicate sketch entity ID");
  const pointIds = new Set(
    f.entities.filter((e) => e.kind === "point").map((e) => e.id),
  );
  for (const e of f.entities) {
    const pointRefs =
      e.kind === "line"
        ? [e.p1, e.p2]
        : e.kind === "circle"
          ? [e.center]
          : e.kind === "arc"
            ? [e.center, e.start, e.end]
            : [];
    if (pointRefs.some((id) => !pointIds.has(id)))
      throw new ValidationError(`Missing endpoint on sketch entity ${e.id}`);
    if (e.kind !== "point" && e.projection && !e.external)
      throw new ValidationError("projected curves must be external");
  }
}

export function validateFeature(f: Feature): void {
  record(f, "feature");
  parse(schemaFor(f.type), f);
  if (f.type === "sketch") sketchReferences(f);
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
