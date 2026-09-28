import { refAt, registerCoreSpec } from "../featureSpec.js";
import type { SketchFeature } from "../model.js";
import { ValidationError } from "../schema/index.js";

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

registerCoreSpec(
  "sketch",
  "Sketch",
  (f) => [
    refAt("plane", "/plane", f.plane),
    ...f.entities.flatMap((e, i) =>
      e.kind !== "point" && e.projection
        ? [refAt("edge", `/entities/${i}/projection`, e.projection)]
        : [],
    ),
  ],
  { producesGeometry: false, check: sketchReferences },
);
