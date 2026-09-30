import { evalExtrude } from "./extrude.js";
import {
  resolvePlaneFrame,
  resolveAxis,
  resolvePoint,
  registerBodySolids,
  type EvalState,
  type FeatureOutcome,
} from "./featureState.js";
import { fuseNamed } from "./boolean.js";
import { finishJoin, warned } from "./booleanNaming.js";
/**
 * Feature evaluators — each timeline feature type maps to a function that
 * transforms the evaluation state using the OCCT kernel.
 */

import {
  detectProfiles,
  solveSketch,
  settledEntities,
  projectEdge,
  bodyMadeBy,
  derivedBodyId,
  featureRefs,
  ANGULAR_TOL_DEG,
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type ConstructionPlaneFeature,
  type EmbossFeature,
  type ExtrudeFeature,
  type Feature,
  type ImportMeshFeature,
  type ImportStepFeature,
  type LinearPatternFeature,
  type MirrorFeature,
  type MoveFeature,
  type ReferenceImageFeature,
  type CircularPatternFeature,
  type PlaneFrame,
  type SketchEntity,
  type SketchFeature,
  type Vec3,
  Placement,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  dir,
  getKernel,
  kernelCall,
  placementToTrsf,
  pnt,
  transformOp,
  type Shape,
} from "./kernel.js";
import {
  computeEdgeNames,
  finalizeNames,
  namingVersion,
  transformNames,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";

import { V, frameFromPlane, offsetFrame } from "./frames.js";
import { geometryNames } from "./signature.js";
import { curveInfo } from "./tessellate.js";
import { readImport, readMesh } from "./importers.js";
import { type EvalContext } from "./featureKinds.js";

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

export function evalSketch(state: EvalState, f: SketchFeature): void {
  const frame = resolvePlaneFrame(state, f.plane);
  let entities = f.entities.map((e) => ({ ...e }));
  const place = (e: SketchEntity) =>
    JSON.stringify(
      e.kind === "point" ? [e.x, e.y] : e.kind === "circle" ? e.radius : e.kind,
    );
  const stored = new Map(f.entities.map((e) => [e.id, place(e)]));
  let moved = false;
  for (const entity of f.entities) {
    if (entity.kind === "point" || !entity.projection) continue;
    const ref = entity.projection;
    const body = state.bodies.get(ref.bodyId);
    const edge = body && computeEdgeNames(body).byName.get(ref.edgeName);
    if (!edge)
      throw new Error(
        `Projected edge ${ref.edgeName} is missing. Restore its source or delete and re-project the reference.`,
      );
    const projected = projectEdge(
      curveInfo(edge),
      frame,
      entity.id,
      ref,
      entity.construction,
    );
    if (projected.at(-1)!.kind !== entity.kind)
      throw new Error(
        `Projected edge ${ref.edgeName} changed curve type. Re-project this reference.`,
      );
    moved ||= projected.some((e) => stored.get(e.id) !== place(e));
    const replacements = new Map(projected.map((e) => [e.id, e]));
    entities = entities.map((e) => replacements.get(e.id) ?? e);
    for (const e of projected)
      if (!entities.some((old) => old.id === e.id)) entities.push(e);
  }
  const solved = solveSketch({ entities, constraints: f.constraints });
  const placed = moved ? settledEntities(solved, entities) : entities;
  state.sketches.set(f.id, {
    featureId: f.id,
    frame,
    entities: placed,
    solveStatus: solved.status,
    dof: solved.dof,
    profiles: detectProfiles(placed),
  });
}

/** Build prism tool(s) for extrude-like features. */
function mirrorTrsfFor(frame: PlaneFrame): any {
  const k = getKernel();
  const trsf = acquire(new k.gp_Trsf_1());
  const ax2 = acquire(
    new k.gp_Ax2_2(
      pnt(frame.origin[0], frame.origin[1], frame.origin[2]),
      dir(frame.normal[0], frame.normal[1], frame.normal[2]),
      dir(frame.xAxis[0], frame.xAxis[1], frame.xAxis[2]),
    ),
  );
  trsf.SetMirror_3(ax2);
  return trsf;
}

export function evalMirror(state: EvalState, f: MirrorFeature) {
  const frame = resolvePlaneFrame(state, f.plane);
  return kernelCall("mirror", () => {
    const trsf = mirrorTrsfFor(frame);
    const warnings: (string | undefined)[] = [];
    for (const [j, bodyId] of f.bodies.entries()) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      const tr = transformOp(body.shape, trsf);
      const mirrored = acquire(tr.Shape());
      const mirroredNames = transformNames(tr, body, `m:${f.id}`);
      if (f.combine) {
        const fused = fuseNamed(
          body,
          { shape: mirrored, names: mirroredNames },
          f.id,
          "mirror join failed",
        );
        const joined = finishJoin(fused, f.id, [body, { shape: mirrored }]);
        warnings.push(joined.warning);
        registerBodySolids(state, bodyId, joined.shape, joined.names);
      } else {
        const newId = derivedBodyId(f.id, j + 1);
        const finalNames = finalizeNames(mirrored, mirroredNames, f.id);
        registerBodySolids(state, newId, mirrored, finalNames);
      }
    }
    return warned(warnings);
  });
}

/** Rigid body translation: transform in place, preserving all face names so
 * downstream feature references survive. The sketches belonging to a moved
 * body (drawn on its faces, or consumed by the feature that created it) have
 * their frames translated too, so they stay attached visually and any later
 * features built from them land at the moved position. */
export function evalMove(
  { state, earlier }: EvalContext,
  f: MoveFeature,
): void {
  if (f.bodies.length === 0)
    throw new Error("select at least one body to move");
  const placement = Placement.fromTranslation(f.translation);
  kernelCall("move", () => {
    for (const bodyId of f.bodies) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      const trsf = placementToTrsf(placement);
      const tr = transformOp(body.shape, trsf);
      const moved = acquire(tr.Shape());
      // empty prefix: keep the original persistent names
      const names = transformNames(tr, body, "");
      registerBodySolids(state, bodyId, moved, names);
    }
  });

  // carry the bodies' sketches along
  const movedIds = new Set(f.bodies);
  const createdBy = (g: Feature) =>
    [...movedIds].some((id) => bodyMadeBy(g.id, id));
  for (const [skId, sk] of state.sketches) {
    const feat = earlier.find((g) => g.id === skId && g.type === "sketch") as
      SketchFeature | undefined;
    if (!feat) continue;
    const follows =
      (feat.plane.kind === "face" && movedIds.has(feat.plane.face.bodyId)) ||
      earlier.some(
        (g) =>
          createdBy(g) &&
          featureRefs(g).some(
            (ref) =>
              (ref.kind === "profile" && ref.profile.sketchId === skId) ||
              (ref.kind === "sketch" && ref.sketch === skId),
          ),
      );
    if (follows) {
      state.sketches.set(skId, {
        ...sk,
        frame: Placement.applyToFrame(placement, sk.frame),
      });
    }
  }
}

const patternCopyId = (id: string, sources: number, i: number, j: number) =>
  derivedBodyId(id, (i - 1) * sources + j + 1);

export function evalLinearPattern(state: EvalState, f: LinearPatternFeature) {
  if (f.count < 2) throw new Error("pattern count must be ≥ 2");
  let direction: Vec3;
  if (f.direction.kind === "axis") {
    const dirs: Record<"X" | "Y" | "Z", Vec3> = {
      X: [1, 0, 0],
      Y: [0, 1, 0],
      Z: [0, 0, 1],
    };
    direction = dirs[f.direction.axis];
  } else {
    const axis = resolveAxis(state, { kind: "edge", edge: f.direction.edge });
    direction = axis.direction;
  }
  return kernelCall("linearPattern", () => {
    const warnings: (string | undefined)[] = [];
    for (const [j, bodyId] of f.bodies.entries()) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      let combined: NamedBody = body;
      const copies: { shape: Shape }[] = [body];
      for (let i = 1; i < f.count; i++) {
        const offset = V.scale(V.scale(direction, f.spacing), i);
        const prefix = `p${i}:${f.id}`;
        const trsf = placementToTrsf(Placement.fromTranslation(offset));
        const tr = transformOp(body.shape, trsf);
        const instance = acquire(tr.Shape());
        const instNames = transformNames(tr, body, prefix);
        if (f.combine) {
          copies.push({ shape: instance });
          combined = {
            bodyId,
            ...fuseNamed(
              combined,
              { shape: instance, names: instNames },
              f.id,
              "pattern join failed",
            ),
          };
        } else {
          const newId = patternCopyId(f.id, f.bodies.length, i, j);
          registerBodySolids(
            state,
            newId,
            instance,
            finalizeNames(instance, instNames, f.id),
          );
          const copy = state.bodies.get(newId);
          if (copy && !state.bodies.has(`${newId}:2`))
            copy.copyOf = { source: body, offset, prefix };
        }
      }
      if (f.combine) {
        const joined = finishJoin(combined, f.id, copies);
        warnings.push(joined.warning);
        registerBodySolids(state, bodyId, joined.shape, joined.names);
      }
    }
    return warned(warnings);
  });
}

export function evalCircularPattern(
  state: EvalState,
  f: CircularPatternFeature,
) {
  if (f.count < 2) throw new Error("pattern count must be ≥ 2");
  const axis = resolveAxis(state, f.axis);
  const total = ((f.totalAngle || 360) * Math.PI) / 180;
  const fullCircle = Math.abs((f.totalAngle || 360) - 360) < ANGULAR_TOL_DEG;
  const step = fullCircle ? total / f.count : total / (f.count - 1);
  return kernelCall("circularPattern", () => {
    const warnings: (string | undefined)[] = [];
    for (const [j, bodyId] of f.bodies.entries()) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      let combined: NamedBody = body;
      const copies: { shape: Shape }[] = [body];
      for (let i = 1; i < f.count; i++) {
        const trsf = placementToTrsf(
          Placement.fromAxisAngle(axis.direction, step * i, axis.origin),
        );
        const tr = transformOp(body.shape, trsf);
        const instance = acquire(tr.Shape());
        const instNames = transformNames(tr, body, `p${i}:${f.id}`);
        if (f.combine) {
          copies.push({ shape: instance });
          combined = {
            bodyId,
            ...fuseNamed(
              combined,
              { shape: instance, names: instNames },
              f.id,
              "pattern join failed",
            ),
          };
        } else {
          const newId = patternCopyId(f.id, f.bodies.length, i, j);
          registerBodySolids(
            state,
            newId,
            instance,
            finalizeNames(instance, instNames, f.id),
          );
        }
      }
      if (f.combine) {
        const joined = finishJoin(combined, f.id, copies);
        warnings.push(joined.warning);
        registerBodySolids(state, bodyId, joined.shape, joined.names);
      }
    }
    return warned(warnings);
  });
}

function flipped(frame: PlaneFrame, flip: boolean | undefined): PlaneFrame {
  return flip ? frameFromPlane(frame.origin, V.scale(frame.normal, -1)) : frame;
}

function midplaneFrame(a: PlaneFrame, b: PlaneFrame): PlaneFrame {
  if (V.norm(V.cross(a.normal, b.normal)) < UNIT_DOT_TOL)
    return frameFromPlane(V.scale(V.add(a.origin, b.origin), 0.5), a.normal);
  const between = V.sub(a.normal, b.normal);
  const width = V.norm(between);
  const level =
    (V.dot(a.normal, a.origin) - V.dot(b.normal, b.origin)) / (width * width);
  return frameFromPlane(V.scale(between, level), between);
}

function angledFrame(
  axis: { origin: Vec3; direction: Vec3 },
  base: PlaneFrame,
  degrees: number,
): PlaneFrame {
  if (Math.abs(V.dot(axis.direction, base.normal)) > UNIT_DOT_TOL)
    throw new Error("the axis must be parallel to the reference plane");
  const turn = (degrees * Math.PI) / 180;
  const normal = V.add(
    V.scale(base.normal, Math.cos(turn)),
    V.scale(V.cross(axis.direction, base.normal), Math.sin(turn)),
  );
  return frameFromPlane(axis.origin, normal);
}

function pointsFrame([a, b, c]: Vec3[]): PlaneFrame {
  const ab = V.sub(b!, a!);
  const ac = V.sub(c!, a!);
  const normal = V.cross(ab, ac);
  if (V.norm(normal) <= UNIT_DOT_TOL * V.norm(ab) * V.norm(ac))
    throw new Error("the three points lie on one line");
  return frameFromPlane(a!, normal);
}

function edgesFrame(
  a: { origin: Vec3; direction: Vec3 },
  b: { origin: Vec3; direction: Vec3 },
): PlaneFrame {
  const across = V.sub(b.origin, a.origin);
  const turn = V.cross(a.direction, b.direction);
  const normal =
    V.norm(turn) < UNIT_DOT_TOL ? V.cross(a.direction, across) : turn;
  if (V.norm(normal) < LINEAR_TOL)
    throw new Error("the two edges lie on one line");
  if (Math.abs(V.dot(V.normalize(normal), across)) > LINEAR_TOL)
    throw new Error("the two edges are not in one plane");
  return frameFromPlane(a.origin, normal);
}

function constructionFrame(
  state: EvalState,
  method: ConstructionPlaneFeature["method"],
): PlaneFrame {
  switch (method.kind) {
    case "offset":
      return offsetFrame(
        flipped(resolvePlaneFrame(state, method.base), method.flip),
        method.distance,
      );
    case "midplane":
      return offsetFrame(
        flipped(
          midplaneFrame(
            resolvePlaneFrame(state, method.a),
            resolvePlaneFrame(state, method.b),
          ),
          method.flip,
        ),
        method.offset ?? 0,
      );
    case "angle":
      return angledFrame(
        resolveAxis(state, method.axis),
        resolvePlaneFrame(state, method.base),
        method.angle,
      );
    case "threePoints":
      return pointsFrame(method.points.map((p) => resolvePoint(state, p)));
    case "twoEdges":
      return edgesFrame(
        resolveAxis(state, method.a),
        resolveAxis(state, method.b),
      );
  }
}

export function evalConstructionPlane(
  state: EvalState,
  f: ConstructionPlaneFeature,
): void {
  const frame = constructionFrame(state, f.method);
  // display size heuristic: cover existing model bbox
  let size = 40;
  for (const body of state.bodies.values()) {
    const bb = bboxOf(body.shape);
    size = Math.max(
      size,
      Math.hypot(
        bb.max[0] - bb.min[0],
        bb.max[1] - bb.min[1],
        bb.max[2] - bb.min[2],
      ) * 0.75,
    );
  }
  state.planes.set(f.id, { frame, size });
}

export function evalImportStep(
  { state, sources }: EvalContext,
  f: ImportStepFeature,
): void {
  const shape = readImport(f, sources);
  registerBodySolids(
    state,
    `b:${f.id}`,
    shape,
    namingVersion() === 1
      ? finalizeNames(shape, new ShapeMap(), f.id)
      : geometryNames(shape, f.id),
  );
}

export function evalReferenceImage(
  state: EvalState,
  f: ReferenceImageFeature,
): void {
  const frame = resolvePlaneFrame(state, f.plane);
  state.planes.set(f.id, { frame, size: 0 });
}

export function evalEmboss(state: EvalState, f: EmbossFeature) {
  // Emboss = extrude the sketch profiles by `depth` and join (emboss) or
  // cut (deboss) into the underlying body.
  const pseudo: ExtrudeFeature = {
    id: f.id,
    name: f.name,
    suppressed: false,
    type: "extrude",
    profiles: f.profiles,
    distance: Math.abs(f.depth),
    direction: f.mode === "emboss" ? "normal" : "reverse",
    operation: f.mode === "emboss" ? "join" : "cut",
    ...(f.targets && { targets: f.targets }),
  };
  return evalExtrude(state, pseudo);
}

export function evalImportMesh(
  state: EvalState,
  feature: ImportMeshFeature,
): FeatureOutcome | void {
  const { shape, warning } = readMesh(feature),
    bodyId = `b:${feature.id}`,
    names = finalizeNames(shape, new ShapeMap(), feature.id);
  if (!warning) return registerBodySolids(state, bodyId, shape, names);
  state.bodies.set(bodyId, { bodyId, shape, names });
  return { warning };
}

export { evaluateFeature } from "./featureKinds.js";

export {
  cloneState,
  emptyState,
  resolvePlaneFrame,
  vertexPoint,
  registerBodySolids,
  NoCorner,
  rejectInvalid,
  invalidPart,
} from "./featureState.js";
export type {
  EvaluatedSketch,
  StateBody,
  EvalState,
  ToolResult,
  FeatureOutcome,
} from "./featureState.js";
export {
  unifyTool,
  fuseNamed,
  evalCombine,
  evalOffsetFace,
  evalSplitBody,
} from "./boolean.js";
