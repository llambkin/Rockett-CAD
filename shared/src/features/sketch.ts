import { splineProblem } from "../bspline.js";
import { refAt, registerCoreSpec } from "../featureSpec.js";
import type { SketchConstraint, SketchFeature } from "../model.js";
import { ValidationError } from "../schema/index.js";
import {
  axisCosine,
  ELLIPSE_AXIS_TOL,
  ellipseAxes,
  entityPointIds,
} from "../sketchCurves.js";
import { constraintEntityRefs } from "../sketchTransform.js";
import { SYMMETRIC_NEEDS, symmetricKind } from "../solverRelations.js";
import { SMOOTH_NEEDS, splineLike, splineTangent } from "../splineJoints.js";
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
    const problem = splineLike(e) && splineProblem(e, points);
    if (problem)
      throw new ValidationError(
        `${e.kind === "spline" ? "Spline" : "Fit spline"} ${e.id}: ${problem}`,
      );
    if (e.kind !== "ellipse") continue;
    const [c, m, n] = refs.map((id) => points.get(id)!);
    const { a, b } = ellipseAxes(c!, m!, n!);
    if (!(b > LINEAR_TOL) || !Number.isFinite(a))
      throw new ValidationError(`Ellipse ${e.id} needs two non-zero axes`);
    if (Math.abs(axisCosine(c!, m!, n!)) > ELLIPSE_AXIS_TOL)
      throw new ValidationError(`Ellipse ${e.id} axes must be perpendicular`);
    if (!e.start !== !e.end)
      throw new ValidationError(
        `Elliptical arc ${e.id} needs a start and an end`,
      );
    const [s, end] = refs.slice(3).map((id) => points.get(id)!);
    if (s && end && Math.hypot(s.x - end.x, s.y - end.y) <= LINEAR_TOL)
      throw new ValidationError(
        `Elliptical arc ${e.id} needs two different ends`,
      );
  }
  const kinds = new Map(f.entities.map((e) => [e.id, e.kind]));
  const held = (c: SketchConstraint) =>
    (c.type === "pointOnCircle" && kinds.get(c.point) === "point") ||
    (c.type === "tangent" && [c.a, c.b].some((id) => kinds.get(id) === "line"));
  for (const c of f.constraints) {
    const joint =
      (c.type === "tangent" || c.type === "smooth") &&
      splineTangent(f.entities, f.constraints, c);
    if (typeof joint === "string") throw new ValidationError(joint);
    if (c.type === "smooth" && !joint) throw new ValidationError(SMOOTH_NEEDS);
    if (c.type === "symmetric" && !symmetricKind((id) => kinds.get(id), c))
      throw new ValidationError(SYMMETRIC_NEEDS);
    for (const id of constraintEntityRefs(c))
      if (
        (["spline", "fitSpline"].includes(kinds.get(id)!) && !joint) ||
        (kinds.get(id) === "ellipse" && !held(c))
      )
        throw new ValidationError(
          `${c.type} constraints cannot reference ${kinds.get(id)} ${id} yet`,
        );
  }
}

registerCoreSpec(
  "sketch",
  "Sketch",
  (f) => [
    refAt("plane", "/plane", f.plane),
    ...f.entities.flatMap((e, i) => {
      if (e.kind === "point" || !e.projection) return [];
      const outer = e.projection;
      const ref = outer.kind === "section" ? outer.of : outer;
      const path = `/entities/${i}/projection${ref === outer ? "" : "/of"}`;
      if (ref.kind === "body")
        return [refAt("body", `${path}/bodyId`, ref.bodyId)];
      if (ref.kind === "face") return [refAt("face", path, ref)];
      return ref.kind === "edge"
        ? [refAt("edge", path, ref)]
        : [refAt("sketchEntity", path, ref)];
    }),
  ],
  { producesGeometry: false, check: sketchReferences },
);
