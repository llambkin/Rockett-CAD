import { refAt, registerCoreSpec } from "../featureSpec.js";
import type { SketchFeature } from "../model.js";
import { ValidationError } from "../schema/index.js";
import {
  axisCosine,
  ELLIPSE_AXIS_TOL,
  ellipseAxes,
  entityPointIds,
} from "../sketchCurves.js";
import { constraintEntityRefs } from "../sketchModify.js";
import { LINEAR_TOL } from "../tolerance.js";

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
  const points = new Map(
    f.entities.flatMap((e) => (e.kind === "point" ? [[e.id, e] as const] : [])),
  );
  for (const e of f.entities) {
    const refs = entityPointIds(e);
    if (refs.some((id) => !points.has(id)))
      throw new ValidationError(`Missing endpoint on sketch entity ${e.id}`);
    if (e.kind !== "point" && e.projection && !e.external)
      throw new ValidationError("projected curves must be external");
    if (e.kind !== "ellipse") continue;
    const [c, m, n] = refs.map((id) => points.get(id)!);
    const { a, b } = ellipseAxes(c!, m!, n!);
    if (!(b > LINEAR_TOL) || !Number.isFinite(a))
      throw new ValidationError(`Ellipse ${e.id} needs two non-zero axes`);
    if (Math.abs(axisCosine(c!, m!, n!)) > ELLIPSE_AXIS_TOL)
      throw new ValidationError(`Ellipse ${e.id} axes must be perpendicular`);
  }
  const ellipses = new Set(
    f.entities.filter((e) => e.kind === "ellipse").map((e) => e.id),
  );
  for (const c of f.constraints)
    for (const id of constraintEntityRefs(c))
      if (ellipses.has(id))
        throw new ValidationError(
          `Constraints cannot reference ellipse ${id} yet`,
        );
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
