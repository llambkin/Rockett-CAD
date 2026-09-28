/**
 * Feature evaluators — each timeline feature type maps to a function that
 * transforms the evaluation state using the OCCT kernel.
 */

import {
  detectProfiles,
  findProfile,
  solveSketch,
  projectEdge,
  bodyMadeBy,
  featureRefs,
  compareNames,
  ANGULAR_TOL_DEG,
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type AxisRef,
  type ChamferFeature,
  type CombineFeature,
  type ConstructionPlaneFeature,
  type EdgeRef,
  type EmbossFeature,
  type ExtrudeFeature,
  type FaceRef,
  type Feature,
  type FeatureStatus,
  type FilletFeature,
  type ImportStepFeature,
  type LinearPatternFeature,
  type LoftFeature,
  type MirrorFeature,
  type MoveFeature,
  type ReferenceImageFeature,
  type CircularPatternFeature,
  type OffsetFaceFeature,
  type PlaneFrame,
  type PlaneRef,
  type PointRef,
  type Profile,
  type ProfileRef,
  type RevolveFeature,
  type SketchEntity,
  type SketchFeature,
  type SketchSolveStatus,
  type SplitBodyFeature,
  type SweepFeature,
  type Vec3,
  Placement,
} from "@rockett/shared";
import {
  bboxOf,
  dir,
  edgeCentroid,
  edges as edgesOf,
  faceCentroid,
  faces as facesOf,
  getKernel,
  kernelCall,
  lengthOf,
  listToArray,
  placementToTrsf,
  planarFacePlane,
  pnt,
  progress,
  release,
  scoped,
  shapeHash,
  shapeList,
  solids,
  transformOp,
  vec,
  vertices as verticesOf,
  volumeOf,
  wires as wiresOf,
  type Shape,
} from "./kernel.js";
import {
  assignBodyIds,
  computeEdgeNames,
  computeVertexNames,
  finalizeNames,
  findFace,
  historyNames,
  namingVersion,
  propagateNames,
  sweptNames,
  transformNames,
  type BodyPiece,
  type NameMap,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { checkedCut, cutsThrough, looseBlend } from "./cutCheck.js";
import { zeroThicknessRefusal } from "./joinCheck.js";
import {
  ORIGIN_FRAMES,
  V,
  frameFromPlane,
  offsetFrame,
  uvTo3d,
} from "./frames.js";
import { geometryNames } from "./signature.js";
import { curveInfo } from "./tessellate.js";
import { tangentEdges } from "./tangentEdges.js";
import { readImport, readMesh, type Sources } from "./importers.js";
import { featureKind, type EvalContext } from "./featureKinds.js";
import {
  arcEdge,
  buildProfileFace,
  snapper,
  subtractSketchRegionsFromFace,
  type ProfileFace,
} from "./sketchGeom.js";

export interface EvaluatedSketch {
  featureId: string;
  frame: PlaneFrame;
  entities: SketchEntity[];
  solveStatus: SketchSolveStatus;
  dof: number;
  profiles: Profile[];
}

export interface StateBody extends NamedBody {
  copyOf?: { source: NamedBody; offset: Vec3; prefix: string };
}

export interface EvalState {
  bodies: Map<string, StateBody>;
  sketches: Map<string, EvaluatedSketch>;
  planes: Map<string, { frame: PlaneFrame; size: number }>;
  blocked: ReadonlySet<string>;
  hidden?: ReadonlySet<string>;
}

export function cloneState(state: EvalState): EvalState {
  return {
    bodies: new Map(state.bodies),
    sketches: new Map(state.sketches),
    planes: new Map(state.planes),
    blocked: state.blocked,
  };
}

export function emptyState(): EvalState {
  return {
    bodies: new Map(),
    sketches: new Map(),
    planes: new Map(),
    blocked: new Set(),
  };
}

export class NoCorner extends Error {}

export class FeatureError extends Error {
  constructor(
    public featureId: string,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

export function resolvePlaneFrame(state: EvalState, ref: PlaneRef): PlaneFrame {
  if (ref.kind === "origin") {
    return ORIGIN_FRAMES[ref.plane];
  }
  if (ref.kind === "construction") {
    const p = state.planes.get(ref.featureId);
    if (!p) throw new Error(`construction plane ${ref.featureId} not found`);
    return p.frame;
  }
  // face
  const body = state.bodies.get(ref.face.bodyId);
  if (!body) throw new Error(`body ${ref.face.bodyId} no longer exists`);
  const face = findFace(body, ref.face.faceName);
  if (!face) {
    throw new Error(
      `face ${ref.face.faceName} no longer exists on ${ref.face.bodyId}`,
    );
  }
  const plane = planarFacePlane(face);
  face.delete();
  if (!plane) throw new Error(`face ${ref.face.faceName} is not planar`);
  return frameFromPlane(plane.origin, plane.normal);
}

function vertexPoint(vertex: Shape): Vec3 {
  const p = getKernel().BRep_Tool.Pnt(vertex);
  const out: Vec3 = [p.X(), p.Y(), p.Z()];
  p.delete();
  return out;
}

function sketchPoint(state: EvalState, sketchId: string, pointId: string) {
  const sketch = state.sketches.get(sketchId);
  if (!sketch) throw new Error(`sketch ${sketchId} not found`);
  const point = sketch.entities.find((e) => e.id === pointId);
  if (point?.kind !== "point") throw new Error(`point ${pointId} not found`);
  return uvTo3d(sketch.frame, point.x, point.y);
}

function resolvePoint(state: EvalState, ref: PointRef): Vec3 {
  if (ref.kind === "sketchPoint")
    return sketchPoint(state, ref.sketchId, ref.entityId);
  const body = state.bodies.get(ref.bodyId);
  if (!body) throw new Error(`body ${ref.bodyId} no longer exists`);
  const vertex = computeVertexNames(body).byName.get(ref.vertexName);
  if (!vertex) throw new Error(`vertex ${ref.vertexName} no longer exists`);
  return vertexPoint(vertex);
}

function resolveAxis(
  state: EvalState,
  ref: AxisRef,
): { origin: Vec3; direction: Vec3 } {
  if (ref.kind === "originAxis") {
    const dirs: Record<"X" | "Y" | "Z", Vec3> = {
      X: [1, 0, 0],
      Y: [0, 1, 0],
      Z: [0, 0, 1],
    };
    return { origin: [0, 0, 0], direction: dirs[ref.axis] };
  }
  if (ref.kind === "sketchLine") {
    const line = state.sketches
      .get(ref.sketchId)
      ?.entities.find((e) => e.id === ref.entityId && e.kind === "line");
    if (line?.kind !== "line")
      throw new Error(`axis line ${ref.entityId} not found`);
    const a = sketchPoint(state, ref.sketchId, line.p1);
    const b = sketchPoint(state, ref.sketchId, line.p2);
    return { origin: a, direction: V.normalize(V.sub(b, a)) };
  }
  // model edge
  const body = state.bodies.get(ref.edge.bodyId);
  if (!body) throw new Error(`body ${ref.edge.bodyId} not found`);
  const edgeNames = computeEdgeNames(body);
  const edge = edgeNames.byName.get(ref.edge.edgeName);
  if (!edge) throw new Error(`edge ${ref.edge.edgeName} no longer exists`);
  const k = getKernel();
  const curve = new k.BRepAdaptor_Curve_2(edge);
  if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Line) {
    curve.delete();
    throw new Error(`edge ${ref.edge.edgeName} is not linear`);
  }
  const pA = curve.Value(curve.FirstParameter());
  const pB = curve.Value(curve.LastParameter());
  const origin: Vec3 = [pA.X(), pA.Y(), pA.Z()];
  const target: Vec3 = [pB.X(), pB.Y(), pB.Z()];
  pA.delete();
  pB.delete();
  curve.delete();
  return { origin, direction: V.normalize(V.sub(target, origin)) };
}

function resolveProfiles(
  state: EvalState,
  refs: ProfileRef[],
): { faces: ProfileFace[]; sketch: EvaluatedSketch } {
  if (refs.length === 0) throw new Error("no profiles selected");
  const sketch = state.sketches.get(refs[0]!.sketchId);
  if (!sketch) throw new Error(`sketch ${refs[0]!.sketchId} not found`);
  const out: ProfileFace[] = [];
  for (const ref of refs) {
    const s = state.sketches.get(ref.sketchId);
    if (!s) throw new Error(`sketch ${ref.sketchId} not found`);
    const profile = findProfile(s, ref.profileId);
    if (!profile) {
      throw new Error(
        `profile ${ref.profileId} no longer exists in ${ref.sketchId}: the sketch region may have changed`,
      );
    }
    out.push(buildProfileFace(profile, s.entities, s.frame));
  }
  return { faces: out, sketch };
}

// ---------------------------------------------------------------------------
// Body bookkeeping
// ---------------------------------------------------------------------------

function bboxOverlap(a: Shape, b: Shape): boolean {
  const ba = bboxOf(a);
  const bb = bboxOf(b);
  const margin = LINEAR_TOL;
  for (let i = 0; i < 3; i++) {
    if (ba.max[i]! < bb.min[i]! - margin || bb.max[i]! < ba.min[i]! + -margin) {
      return false;
    }
  }
  return true;
}

export function registerBodySolids(
  state: EvalState,
  bodyId: string,
  shape: Shape,
  names: NameMap,
): void {
  registerSolids(state, bodyId, solids(shape), names);
}

function registerSolids(
  state: EvalState,
  bodyId: string,
  sols: Shape[],
  names: NameMap,
): void {
  if (sols.length === 0) {
    state.bodies.delete(bodyId);
    return;
  }
  if (sols.length === 1) {
    state.bodies.set(bodyId, { bodyId, shape: sols[0], names });
    return;
  }
  if (names.version === 2) {
    registerPieces(
      state,
      bodyId,
      sols.map((shape) => ({ shape, names })),
    );
    return;
  }
  const sorted = sols
    .map((s) => ({ s, v: volumeOf(s) }))
    .sort((a, b) => b.v - a.v);
  sorted.forEach((item, i) => {
    const id = i === 0 ? bodyId : `${bodyId}:${i + 1}`;
    state.bodies.set(id, { bodyId: id, shape: item.s, names });
  });
}

function registerPieces(
  state: EvalState,
  bodyId: string,
  pieces: BodyPiece[],
): void {
  let named: [string, BodyPiece][];
  try {
    named = assignBodyIds(bodyId, pieces);
  } catch (err) {
    release(pieces.map((p) => p.shape));
    throw err;
  }
  for (const [id, { shape, names }] of named)
    state.bodies.set(id, { bodyId: id, shape, names });
}

function registerNewBodies(
  state: EvalState,
  featureId: string,
  tools: ToolResult[],
  regions: ProfileFace[],
): void {
  const unified = tools.map((t) => unifyTool(t, featureId));
  try {
    if (unified[0]?.names.version === 2) {
      registerPieces(
        state,
        `b:${featureId}`,
        unified.flatMap((u, i) =>
          solids(u.shape).map((shape) => ({
            shape,
            names: u.names,
            region: regions[i]!.profileId,
          })),
        ),
      );
      return;
    }
    unified.forEach((u, i) =>
      registerBodySolids(
        state,
        i === 0 ? `b:${featureId}` : `b:${featureId}:${i + 1}`,
        u.shape,
        u.names,
      ),
    );
  } finally {
    release(new Set([...tools, ...unified].map((t) => t.shape)));
  }
}

// ---------------------------------------------------------------------------
// Tool-solid creation (extrude / revolve / sweep / loft share this plumbing)
// ---------------------------------------------------------------------------

export interface ToolResult {
  shape: Shape;
  names: NameMap;
}

function cylinderAxes(face: Shape): Vec3[] | null {
  const k = getKernel();
  return scoped((own) => {
    const surf = own(
      new k.BRepAdaptor_Surface_2(own(k.TopoDS.Face_1(face)), false),
    );
    if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Cylinder) return null;
    const frame = own(own(surf.Cylinder()).Position());
    return [own(frame.XDirection()), own(frame.YDirection())].map((d): Vec3 => [
      d.X(),
      d.Y(),
      d.Z(),
    ]);
  });
}

function reparametrisedCylinderEdges(shape: Shape): Shape[] {
  const k = getKernel();
  const map = new k.TopTools_IndexedDataMapOfShapeListOfShape_1();
  k.TopExp.MapShapesAndAncestors(
    shape,
    k.TopAbs_ShapeEnum.TopAbs_EDGE,
    k.TopAbs_ShapeEnum.TopAbs_FACE,
    map,
  );
  const keep: Shape[] = [];
  for (let i = 1; i <= map.Extent(); i++) {
    const adjacent = listToArray(map.FindFromIndex_2(i));
    const [a, b] = adjacent.map(cylinderAxes);
    release(adjacent);
    if (a && b && a.some((d, j) => V.dot(d, b[j]!) < 1 - UNIT_DOT_TOL))
      keep.push(map.FindKey_2(i));
  }
  map.delete();
  return keep;
}

/**
 * Merge coplanar faces and collinear edges of a tool solid, so a body made
 * from several adjacent sketch regions reads as one solid instead of showing
 * the sketch's internal boundaries as edges. On any kernel failure the
 * unmerged tool is kept.
 */
function unifyTool(tool: ToolResult, featureId: string): ToolResult {
  const k = getKernel();
  try {
    const uni = new k.ShapeUpgrade_UnifySameDomain_2(
      tool.shape,
      true,
      true,
      false,
    );
    if (tool.names.version === 2) {
      const { min, max } = bboxOf(tool.shape);
      uni.SetLinearTolerance(LINEAR_TOL);
      uni.SetAngularTolerance(
        LINEAR_TOL / Math.max(1, V.norm(V.sub(max, min))),
      );
    }
    const seams = reparametrisedCylinderEdges(tool.shape);
    for (const edge of seams) uni.KeepShape(edge);
    release(seams);
    uni.Build();
    const merged = uni.Shape();
    const mergedFaces = facesOf(merged);
    release(mergedFaces);
    if (mergedFaces.length === 0) {
      release([merged, uni]);
      return tool;
    }
    const history = uni.History_1();
    const names = historyNames(history.get(), tool, merged, featureId);
    history.delete?.();
    uni.delete();
    return { shape: merged, names };
  } catch {
    return tool;
  }
}

function finishJoin(
  fused: ToolResult,
  featureId: string,
  parts: { shape: Shape }[],
  unify = fused.names.version === 2,
): ToolResult {
  const joined = unify ? unifyTool(fused, featureId) : fused;
  const refusal = zeroThicknessRefusal(
    joined.shape,
    parts.map((p) => p.shape),
  );
  if (!refusal) return joined;
  joined.shape.delete();
  throw refusal;
}

export function fuseNamed(
  a: ToolResult,
  b: ToolResult,
  featureId: string,
  failure: string,
): ToolResult {
  const k = getKernel();
  const op = new k.BRepAlgoAPI_Fuse_3(a.shape, b.shape, progress());
  op.Build(progress());
  if (!op.IsDone()) {
    op.delete();
    throw new Error(failure);
  }
  const shape = op.Shape();
  const names = propagateNames(op, [a, b], shape, featureId);
  op.delete();
  return { shape, names };
}

function touches(a: Shape, b: Shape): boolean {
  if (!bboxOverlap(a, b)) return false;
  const k = getKernel();
  const dist = new k.BRepExtrema_DistShapeShape_2(
    a,
    b,
    k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
    k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
    progress(),
  );
  const done = dist.IsDone();
  const value = done ? dist.Value() : 0;
  dist.delete();
  if (!done) throw new Error("join contact check failed");
  if (value > LINEAR_TOL) return false;
  return scoped((own) => {
    const op = own(new k.BRepAlgoAPI_Fuse_3(a, b, progress()));
    op.Build(progress());
    if (!op.IsDone()) throw new Error("join contact check failed");
    const pieces = solids(own(op.Shape()));
    release(pieces);
    return pieces.length === 1;
  });
}

export type FeatureOutcome = Pick<FeatureStatus, "warning" | "targets">;

function targetBody(
  state: EvalState,
  operation: string,
  id: string,
  tool: Shape,
): StateBody {
  const body = state.bodies.get(id);
  if (!body) throw new Error(`${operation} target ${id} no longer exists`);
  if (!bboxOverlap(body.shape, tool)) throw missedTarget(operation, id);
  return body;
}

function missedTarget(operation: string, id: string): Error {
  return new Error(`${operation} target ${id} does not overlap the tool`);
}

function overlapping(state: EvalState, tool: Shape): StateBody[] {
  return [...state.bodies.values()].filter(
    (b) => !state.hidden?.has(b.bodyId) && bboxOverlap(b.shape, tool),
  );
}

function joinEvery(
  state: EvalState,
  featureId: string,
  tool: ToolResult,
  targets?: string[],
): string[] {
  const bodies = targets
    ? targets.map((id) => targetBody(state, "join", id, tool.shape))
    : overlapping(state, tool.shape).sort((a, b) =>
        compareNames(a.bodyId, b.bodyId),
      );
  let groups: { bodies: StateBody[]; pieces: ToolResult[] }[] = [];
  const loose: Shape[] = [];
  for (const shape of solids(tool.shape)) {
    const hits = bodies.filter((b) => touches(b.shape, shape));
    if (hits.length === 0) {
      loose.push(shape);
      continue;
    }
    const bridged = groups.filter((g) =>
      g.bodies.some((b) => hits.includes(b)),
    );
    groups = [
      ...groups.filter((g) => !bridged.includes(g)),
      {
        bodies: bodies.filter(
          (b) => hits.includes(b) || bridged.some((g) => g.bodies.includes(b)),
        ),
        pieces: [...bridged.flatMap((g) => g.pieces), { ...tool, shape }],
      },
    ];
  }
  const touched = new Set(groups.flatMap((g) => g.bodies));
  const used = bodies.filter((b) => touched.has(b)).map((b) => b.bodyId);
  const missed = targets?.find((id) => !used.includes(id));
  if (missed) {
    release([...loose, ...groups.flatMap((g) => g.pieces.map((p) => p.shape))]);
    throw missedTarget("join", missed);
  }
  if (loose.length > 0)
    registerSolids(state, `b:${featureId}`, loose, tool.names);
  for (const {
    bodies: [first, ...rest],
    pieces,
  } of groups) {
    const fused = [...pieces, ...rest].reduce<ToolResult>(
      (acc, next) => fuseNamed(acc, next, featureId, "boolean join failed"),
      first!,
    );
    for (const b of rest) state.bodies.delete(b.bodyId);
    const joined = finishJoin(fused, featureId, [first!, ...rest, ...pieces]);
    registerBodySolids(state, first!.bodyId, joined.shape, joined.names);
  }
  return used;
}

function applyToolOperation(
  state: EvalState,
  featureId: string,
  tool: ToolResult,
  operation: "newBody" | "join" | "cut" | "intersect",
  targets?: string[],
): FeatureOutcome | void {
  const k = getKernel();
  if (operation === "newBody") {
    registerBodySolids(state, `b:${featureId}`, tool.shape, tool.names);
    return;
  }
  if (targets?.length === 0 || (!targets && state.bodies.size === 0)) {
    registerBodySolids(state, `b:${featureId}`, tool.shape, tool.names);
    return { targets: [] };
  }

  if (operation === "join" && tool.names.version === 2)
    return { targets: joinEvery(state, featureId, tool, targets) };

  if (operation === "cut") {
    const bodies = targets
      ? targets.map((id) => targetBody(state, "cut", id, tool.shape))
      : overlapping(state, tool.shape);
    if (bodies.length === 0)
      throw new Error("cut tool does not intersect any body");
    for (const body of bodies) {
      const op = checkedCut(body.shape, tool.shape, "boolean cut failed");
      if (!op) continue;
      const result = op.Shape();
      const names = propagateNames(
        op,
        [body, { shape: tool.shape, names: tool.names }],
        result,
        featureId,
      );
      op.delete();
      registerBodySolids(state, body.bodyId, result, names);
      result.delete();
    }
    return { targets: bodies.map((b) => b.bodyId) };
  }

  const target = targets
    ? targetBody(state, operation, targets[0]!, tool.shape)
    : overlapping(state, tool.shape)[0];

  if (operation === "join") {
    if (!target) {
      registerBodySolids(state, `b:${featureId}`, tool.shape, tool.names);
      return { targets: [] };
    }
    const fused = fuseNamed(target, tool, featureId, "boolean join failed");
    const joined = finishJoin(fused, featureId, [target, tool], true);
    registerBodySolids(state, target.bodyId, joined.shape, joined.names);
    return { targets: [target.bodyId] };
  }

  if (!target) throw new Error("intersect tool does not overlap any body");
  const op = new k.BRepAlgoAPI_Common_3(target.shape, tool.shape, progress());
  op.Build(progress());
  if (!op.IsDone()) {
    op.delete();
    throw new Error("boolean intersect failed");
  }
  const result = op.Shape();
  const names = propagateNames(
    op,
    [target, { shape: tool.shape, names: tool.names }],
    result,
    featureId,
  );
  op.delete();
  registerBodySolids(state, target.bodyId, result, names);
  return { targets: [target.bodyId] };
}

// ---------------------------------------------------------------------------
// Individual feature evaluators
// ---------------------------------------------------------------------------

export function evalSketch(state: EvalState, f: SketchFeature): void {
  const frame = resolvePlaneFrame(state, f.plane);
  let entities = f.entities.map((e) => ({ ...e }));
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
    const replacements = new Map(projected.map((e) => [e.id, e]));
    entities = entities.map((e) => replacements.get(e.id) ?? e);
    for (const e of projected)
      if (!entities.some((old) => old.id === e.id)) entities.push(e);
  }
  const solved = solveSketch({ entities, constraints: f.constraints });
  const profiles = detectProfiles(solved.entities);
  state.sketches.set(f.id, {
    featureId: f.id,
    frame,
    entities: solved.entities,
    solveStatus: solved.status,
    dof: solved.dof,
    profiles,
  });
}

/** Build prism tool(s) for extrude-like features. */
function buildPrism(
  featureId: string,
  profileFace: ProfileFace,
  direction: Vec3,
  distance: number,
  baseOffset: number,
  copyBase = false,
): ToolResult {
  const k = getKernel();
  return kernelCall("extrude", () => {
    let face = profileFace.face;
    let offsetEdgeEntity = profileFace.edgeEntity;
    if (baseOffset !== 0) {
      const trsf = new k.gp_Trsf_1();
      trsf.SetTranslation_1(
        vec(
          direction[0] * baseOffset,
          direction[1] * baseOffset,
          direction[2] * baseOffset,
        ),
      );
      const tr = transformOp(face, trsf);
      const moved = tr.Shape();
      // remap edge->entity through the transform
      const newMap = new Map<number, string>();
      for (const e of edgesOf(face)) {
        const id = profileFace.edgeEntity.get(shapeHash(e));
        if (!id) continue;
        try {
          const me = tr.ModifiedShape(e);
          newMap.set(shapeHash(me), id);
        } catch {
          // ignore
        }
      }
      offsetEdgeEntity = newMap;
      face = k.TopoDS.Face_1(moved);
      tr.delete();
      trsf.delete();
    }
    const v = vec(
      direction[0] * distance,
      direction[1] * distance,
      direction[2] * distance,
    );
    const prism = new k.BRepPrimAPI_MakePrism_1(face, v, copyBase, true);
    prism.Build(progress());
    if (!prism.IsDone()) {
      prism.delete();
      throw new Error("prism generation failed: is the profile closed?");
    }
    const shape = prism.Shape();

    const provisional = new ShapeMap<string>();
    // side faces from profile edges
    const faceEdges = edgesOf(face);
    for (const e of faceEdges) {
      const entityId = offsetEdgeEntity.get(shapeHash(e));
      if (!entityId) continue;
      const gen = listToArray(prism.Generated(e));
      for (const g of gen) {
        if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE) {
          provisional.set(g, `f:${featureId}:s:${entityId}`);
        }
      }
      release(gen);
    }
    release(faceEdges);
    // caps
    const firstShape = prism.FirstShape_1();
    const startCaps = facesOf(firstShape);
    for (const cap of startCaps) {
      provisional.set(cap, `f:${featureId}:cap:start`);
    }
    const lastShape = prism.LastShape_1();
    const endCaps = facesOf(lastShape);
    for (const cap of endCaps) {
      provisional.set(cap, `f:${featureId}:cap:end`);
    }
    release([firstShape, lastShape, ...startCaps, ...endCaps]);
    const names = finalizeNames(shape, provisional, featureId);
    prism.delete();
    v.delete();
    return { shape, names };
  });
}

function faceProfile(
  state: EvalState,
  ref: FaceRef,
): { pf: ProfileFace; n: Vec3 } {
  const body = state.bodies.get(ref.bodyId);
  if (!body) throw new Error(`body ${ref.bodyId} no longer exists`);
  const face = findFace(body, ref.faceName);
  if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
  const plane = planarFacePlane(face);
  if (!plane) throw new Error(`face ${ref.faceName} is not planar`);
  const cut = subtractSketchRegionsFromFace(face, state.sketches.values());
  return {
    pf: { face: cut.face, edgeEntity: cut.edgeEntity, profileId: ref.faceName },
    n: plane.normal,
  };
}

export function evalExtrude(state: EvalState, f: ExtrudeFeature) {
  const dist = Math.abs(f.distance);
  if (dist <= 0) throw new Error("extrude distance must be non-zero");
  const faceRefs = f.faces ?? [];
  if (f.profiles.length === 0 && faceRefs.length === 0) {
    throw new Error("select at least one profile or planar face");
  }

  // Each extrusion source: a face shape + the direction it extrudes along.
  const sources: { pf: ProfileFace; n: Vec3; copy: boolean }[] = [];

  if (f.profiles.length > 0) {
    const { faces: profileFaces, sketch } = resolveProfiles(state, f.profiles);
    for (const pf of profileFaces) {
      sources.push({ pf, n: sketch.frame.normal, copy: false });
    }
  }

  for (const ref of faceRefs)
    sources.push({ ...faceProfile(state, ref), copy: true });

  // A negative distance flips the side (typing -5 in the dialog extrudes
  // 5 mm the other way — the usual way to start a cut into a body).
  const flip = f.distance < 0 ? -1 : 1;
  // "Start → Offset": the extrusion begins on a plane `startOffset` along the
  // profile's own normal (independent of direction / sign of distance).
  const startOffset = f.startOffset ?? 0;
  const tools: ToolResult[] = [];
  for (const { pf, n: n0, copy } of sources) {
    const sgn = (f.direction === "reverse" ? -1 : 1) * flip;
    const n: Vec3 = [sgn * n0[0], sgn * n0[1], sgn * n0[2]];
    // buildPrism's base offset is measured along `n`, so convert the offset
    // along n0 into that frame
    const base = startOffset * sgn;
    if (f.direction === "normal" || f.direction === "reverse") {
      tools.push(buildPrism(f.id, pf, n, dist, base, copy));
    } else if (f.direction === "symmetric") {
      tools.push(buildPrism(f.id, pf, n, dist, base - dist / 2, copy));
    } else {
      // twoSided: `distance` on the (possibly flipped) primary side, distance2 behind
      const d2 = Math.abs(f.distance2 ?? 0);
      tools.push(buildPrism(f.id, pf, n, dist + d2, base - d2, copy));
    }
  }
  release(new Set(sources.map(({ pf }) => pf.face)));

  return applyProfileTools(
    state,
    f.id,
    tools,
    sources.map((s) => s.pf),
    f.operation,
    f.targets,
  );
}

function applyProfileTools(
  state: EvalState,
  featureId: string,
  tools: ToolResult[],
  regions: ProfileFace[],
  operation: "newBody" | "join" | "cut" | "intersect",
  targets?: string[],
): FeatureOutcome | void {
  if (operation === "newBody") {
    registerNewBodies(state, featureId, tools, regions);
    return;
  }
  const made = new Set(tools.map((t) => t.shape));
  try {
    const tool = tools.slice(1).reduce((acc, next) => {
      const fused = fuseNamed(
        acc,
        next,
        featureId,
        "failed to merge profile solids",
      );
      made.add(fused.shape);
      return fused;
    }, tools[0]!);
    const unified = unifyTool(tool, featureId);
    made.add(unified.shape);
    return applyToolOperation(state, featureId, unified, operation, targets);
  } finally {
    release(made);
  }
}

function sideEdgeNames(
  featureId: string,
  pf: ProfileFace,
  edges = edgesOf(pf.face),
): Array<[Shape, string]> {
  return edges.flatMap((e): Array<[Shape, string]> => {
    const entityId = pf.edgeEntity.get(shapeHash(e));
    if (entityId) return [[e, `f:${featureId}:s:${entityId}`]];
    e.delete();
    return [];
  });
}

function revolveSources(state: EvalState, f: RevolveFeature) {
  const faceRefs = f.faces ?? [];
  const profiles =
    f.profiles.length > 0 || faceRefs.length === 0
      ? resolveProfiles(state, f.profiles).faces
      : [];
  return [
    ...profiles.map((pf) => ({ pf, copy: false })),
    ...faceRefs.map((ref) => ({ pf: faceProfile(state, ref).pf, copy: true })),
  ];
}

const REVOLVE_CROSSES_AXIS =
  "revolve profile crosses the axis of revolution: keep the profile on one side of the axis; the previous state has been kept";

function crossesAxis(
  face: Shape,
  axis: { origin: Vec3; direction: Vec3 },
): boolean {
  const plane = planarFacePlane(face);
  if (!plane) return false;
  const d = axis.direction;
  const across = V.cross(d, plane.normal);
  if (V.norm(across) < UNIT_DOT_TOL) return false;
  const u = V.normalize(across);
  const w = V.cross(u, d);
  const o = axis.origin;
  const k = getKernel();
  return scoped((own) => {
    const trsf = own(new k.gp_Trsf_1());
    trsf.SetValues(...u, -V.dot(u, o), ...d, -V.dot(d, o), ...w, -V.dot(w, o));
    const box = own(new k.Bnd_Box_1());
    const moved = own(face.Moved(own(new k.TopLoc_Location_4(trsf)), false));
    k.BRepBndLib.AddOptimal(moved, box, false, false);
    const tolerance = Math.max(
      LINEAR_TOL,
      k.BRep_Tool.MaxTolerance(face, k.TopAbs_ShapeEnum.TopAbs_VERTEX),
    );
    return (
      own(box.CornerMin()).X() < -tolerance &&
      own(box.CornerMax()).X() > tolerance
    );
  });
}

export function evalRevolve(state: EvalState, f: RevolveFeature) {
  const sources = revolveSources(state, f);
  const profileFaces = sources.map((s) => s.pf);
  const axis = resolveAxis(state, f.axis);
  if (profileFaces.some((pf) => crossesAxis(pf.face, axis))) {
    release(profileFaces.map((pf) => pf.face));
    throw new Error(REVOLVE_CROSSES_AXIS);
  }
  const k = getKernel();
  const angleRad = (Math.min(Math.abs(f.angle), 360) * Math.PI) / 180;
  const full = Math.abs(f.angle) >= 360 - ANGULAR_TOL_DEG;
  const sign = f.angle >= 0 ? 1 : -1;

  const tools: ToolResult[] = [];
  for (const { pf, copy } of sources) {
    const tool = kernelCall("revolve", () => {
      const ax1 = scoped(
        (own) =>
          new k.gp_Ax1_2(
            own(pnt(axis.origin[0], axis.origin[1], axis.origin[2])),
            own(
              dir(
                sign * axis.direction[0],
                sign * axis.direction[1],
                sign * axis.direction[2],
              ),
            ),
          ),
      );
      const revol = full
        ? new k.BRepPrimAPI_MakeRevol_2(pf.face, ax1, copy)
        : new k.BRepPrimAPI_MakeRevol_1(pf.face, ax1, angleRad, copy);
      revol.Build(progress());
      if (!revol.IsDone()) {
        revol.delete();
        throw new Error("the kernel could not revolve the profile");
      }
      const shape = revol.Shape();
      const names = sweptNames(
        shape,
        f.id,
        sideEdgeNames(f.id, pf),
        (e) => revol.Generated(e),
        full ? [] : [revol.FirstShape_1(), revol.LastShape_1()],
      );
      revol.delete();
      ax1.delete();
      return { shape, names };
    });
    tools.push(tool);
  }
  release(profileFaces.map((pf) => pf.face));
  return applyProfileTools(
    state,
    f.id,
    tools,
    profileFaces,
    f.operation,
    f.targets,
  );
}

export function evalSweep(state: EvalState, f: SweepFeature) {
  const { faces: profileFaces } = resolveProfiles(state, f.profiles);
  const pathSketch = state.sketches.get(f.pathSketchId);
  if (!pathSketch) throw new Error(`path sketch ${f.pathSketchId} not found`);
  const k = getKernel();

  // Build the spine wire from all non-construction curves of the path sketch,
  // ordered into a connected chain.
  const points = new Map<string, { x: number; y: number }>();
  for (const e of pathSketch.entities) {
    if (e.kind === "point") points.set(e.id, { x: e.x, y: e.y });
  }
  const chain = orderOpenChain(pathSketch.entities, points);
  const wire = kernelCall("sweep path", () => {
    if (chain.length === 0)
      throw new Error("path sketch contains no usable curves");
    const wireMaker = new k.BRepBuilderAPI_MakeWire_1();
    for (const seg of chain) {
      const edge = sketchEntityToEdge(seg, pathSketch, points);
      if (edge) wireMaker.Add_1(edge);
      if (!wireMaker.IsDone()) {
        wireMaker.delete();
        throw new Error("sweep path is not a connected chain");
      }
    }
    const w = wireMaker.Wire();
    wireMaker.delete();
    return w;
  });

  const tools = profileFaces.map((pf) =>
    kernelCall("sweep", (): ToolResult => {
      const pipe = new k.BRepOffsetAPI_MakePipe_1(wire, pf.face);
      pipe.Build(progress());
      if (!pipe.IsDone()) {
        pipe.delete();
        throw new Error(
          "sweep failed: check that the profile lies on the path start",
        );
      }
      const shape = pipe.Shape();
      const names =
        namingVersion() === 1
          ? finalizeNames(shape, new ShapeMap(), f.id)
          : sweptNames(
              shape,
              f.id,
              sideEdgeNames(f.id, pf),
              (e) => pipe.Generated_1(e),
              [pipe.FirstShape(), pipe.LastShape()],
            );
      pipe.delete();
      return { shape, names };
    }),
  );
  release([wire, ...profileFaces.map((pf) => pf.face)]);
  return tools.length === 1
    ? applyToolOperation(state, f.id, tools[0]!, f.operation, f.targets)
    : applyProfileTools(
        state,
        f.id,
        tools,
        profileFaces,
        f.operation,
        f.targets,
      );
}

export function evalLoft(state: EvalState, f: LoftFeature) {
  const k = getKernel();
  if (f.sections.length < 2)
    throw new Error("loft requires at least two sections");
  const tool = kernelCall("loft", () =>
    scoped((own) => {
      const thru = own(
        new k.BRepOffsetAPI_ThruSections(true, false, LINEAR_TOL),
      );
      let first: { pf: ProfileFace; wire: Shape } | undefined;
      for (const ref of f.sections) {
        const sketch = state.sketches.get(ref.sketchId);
        if (!sketch) throw new Error(`sketch ${ref.sketchId} not found`);
        const profile = findProfile(sketch, ref.profileId);
        if (!profile) throw new Error(`profile ${ref.profileId} not found`);
        const pf = buildProfileFace(profile, sketch.entities, sketch.frame);
        own(pf.face);
        const outer = wiresOf(pf.face).map(own)[0];
        if (!outer) throw new Error("loft section has no wire");
        thru.AddWire(outer);
        first ??= { pf, wire: outer };
      }
      thru.Build(progress());
      if (!thru.IsDone())
        throw new Error("loft failed: sections may be incompatible");
      const shape = thru.Shape();
      const names =
        namingVersion() === 1
          ? finalizeNames(shape, new ShapeMap(), f.id)
          : sweptNames(
              shape,
              f.id,
              sideEdgeNames(f.id, first!.pf, edgesOf(first!.wire)),
              (e) => thru.Generated(e),
              [thru.FirstShape(), thru.LastShape()],
            );
      return { shape, names };
    }),
  );
  try {
    return applyToolOperation(state, f.id, tool, f.operation, f.targets);
  } finally {
    tool.shape.delete();
  }
}

function orderOpenChain(
  entities: SketchEntity[],
  points: Map<string, { x: number; y: number }>,
): SketchEntity[] {
  const snap = snapper();
  const ends = new Map<SketchEntity, [number, number][]>();
  const at = new Map<[number, number], SketchEntity[]>();
  for (const e of entities) {
    if ((e.kind !== "line" && e.kind !== "arc") || e.construction) continue;
    const ids = e.kind === "line" ? [e.p1, e.p2] : [e.start, e.end];
    const keys = ids.map((id) => {
      const p = points.get(id)!;
      return snap(p.x, p.y);
    });
    ends.set(e, keys);
    for (const key of keys) at.set(key, [...(at.get(key) ?? []), e]);
  }
  const notChain = new Error("sweep path is not a connected chain");
  if ([...at.values()].some((es) => es.length > 2)) throw notChain;
  const isEnd = (key: [number, number]) => at.get(key)!.length === 1;
  const curves = [...ends.keys()];
  const first = curves.find((e) => ends.get(e)!.some(isEnd)) ?? curves[0];
  if (!first) return [];
  const chain: SketchEntity[] = [];
  let cur: SketchEntity | undefined = first;
  let from = ends.get(first)!.find(isEnd) ?? ends.get(first)![0]!;
  while (cur) {
    chain.push(cur);
    const [a, b] = ends.get(cur)!;
    from = from === a ? b! : a!;
    cur = at.get(from)!.find((e) => !chain.includes(e));
  }
  if (chain.length !== curves.length) throw notChain;
  return chain;
}

function sketchEntityToEdge(
  e: SketchEntity,
  sketch: EvaluatedSketch,
  points: Map<string, { x: number; y: number }>,
): Shape | null {
  const k = getKernel();
  const to3d = (u: number, v: number): Vec3 => uvTo3d(sketch.frame, u, v);
  if (e.kind === "line") {
    const a = points.get(e.p1)!;
    const b = points.get(e.p2)!;
    const p1 = to3d(a.x, a.y);
    const p2 = to3d(b.x, b.y);
    const mk = new k.BRepBuilderAPI_MakeEdge_3(
      pnt(p1[0], p1[1], p1[2]),
      pnt(p2[0], p2[1], p2[2]),
    );
    const edge = mk.Edge();
    mk.delete();
    return edge;
  }
  if (e.kind === "arc") {
    const s = points.get(e.start)!;
    const en = points.get(e.end)!;
    return arcEdge(
      sketch.frame,
      points.get(e.center)!,
      [s.x, s.y],
      [en.x, en.y],
    );
  }
  return null;
}

function blendPerBody(
  state: EvalState,
  refs: EdgeRef[],
  blend: (body: NamedBody, refs: EdgeRef[]) => void,
): void {
  const groups = new Map<string, EdgeRef[]>();
  for (const ref of refs) {
    const group = groups.get(ref.bodyId);
    if (group) group.push(ref);
    else groups.set(ref.bodyId, [ref]);
  }
  const targets = [...groups].map(([bodyId, bodyRefs]) => {
    const body = state.bodies.get(bodyId);
    if (!body) throw new Error(`body ${bodyId} no longer exists`);
    return { body, bodyRefs };
  });
  for (const { body, bodyRefs } of targets) {
    try {
      blend(body, bodyRefs);
    } catch (error) {
      if (targets.length === 1) throw error;
      throw new Error(`${(error as Error).message} (body ${body.bodyId})`, {
        cause: error,
      });
    }
  }
}

function collectEdges(
  body: NamedBody,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  tangentChain: boolean | undefined,
): { edge: Shape; name: string }[] {
  const resolve = (ref: EdgeRef) => {
    const edge = byName.get(ref.edgeName);
    if (!edge) {
      throw new Error(`referenced edge no longer exists: ${ref.edgeName}`);
    }
    return { edge, name: ref.edgeName };
  };
  const seeds = refs.map(resolve);
  return tangentChain ? tangentEdges(body, refs).map(resolve) : seeds;
}

function blendNames(
  op: any,
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  featureId: string,
): NameMap {
  const k = getKernel();
  // Modified faces keep names; generated fillet faces are named per edge.
  const provisional = new ShapeMap<string>();
  const bodyFaces = facesOf(body.shape);
  try {
    for (const face of bodyFaces) {
      const name = body.names.get(face);
      if (!name || op.IsDeleted(face)) continue;
      const modified = listToArray(op.Modified(face));
      for (const mf of modified.length > 0 ? modified : [face]) {
        provisional.set(mf, name);
      }
      release(modified);
    }
  } finally {
    release(bodyFaces);
  }
  sourceEdges.forEach((se, i) => {
    const gen = listToArray(op.Generated(se.edge));
    gen.forEach((g, j) => {
      if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE) {
        provisional.set(
          g,
          `f:${featureId}:fe:${i + 1}${gen.length > 1 ? `:${j + 1}` : ""}`,
        );
      }
    });
    release(gen);
  });
  return finalizeNames(result, provisional, featureId);
}

export function evalFillet(state: EvalState, f: FilletFeature): void {
  if (f.edges.length === 0) throw new Error("no edges selected");
  if (f.radius <= 0) throw new Error("fillet radius must be positive");
  blendPerBody(state, f.edges, (body, refs) =>
    filletBody(state, f, body, refs),
  );
}

function filletBody(
  state: EvalState,
  f: FilletFeature,
  body: NamedBody,
  refs: EdgeRef[],
): void {
  const bodyId = body.bodyId;
  const k = getKernel();
  kernelCall("fillet", () => {
    const byName = computeEdgeNames(body).byName;
    const op = new k.BRepFilletAPI_MakeFillet(
      body.shape,
      k.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    let result: Shape | undefined;
    try {
      const sourceEdges = collectEdges(body, byName, refs, f.tangentChain);
      for (const { edge } of sourceEdges) {
        if (!op.Contour(edge)) op.Add_2(f.radius, edge);
      }
      if (op.NbContours() === 0) {
        throw new NoCorner(
          `no sharp corner to fillet on ${sourceEdges.map((s) => s.name).join(", ")}: the faces meet smoothly there`,
        );
      }
      op.Build(progress());
      const spilled = op.IsDone() ? spilledEnds(op) : new Set<number>();
      const ends =
        !op.IsDone() || spilled.size > 0
          ? openEnds(op, sourceEdges, spilled)
          : [];
      const clipped =
        ends.length > 0 && filletClipped(body, sourceEdges, ends, f);
      if (clipped) {
        result = clipped.shape;
        registerBodySolids(state, bodyId, result, clipped.names);
        return;
      }
      if (!op.IsDone()) {
        throw new Error(filletFailure(op, byName, refs, f.radius));
      }
      result = op.Shape();
      // IsDone only confirms that the algorithm completed. Some edge junctions
      // produce an invalid solid even when it reports success; never publish it.
      rejectBadBlend(
        op,
        sourceEdges,
        result,
        body.shape,
        "fillet",
        `radius ${f.radius}`,
        "try fewer edges or a different radius",
      );
      const names = blendNames(op, body, sourceEdges, result, f.id);
      registerBodySolids(state, bodyId, result, names);
    } finally {
      result?.delete();
      op.delete();
      release(byName.values());
    }
  });
}

interface OpenEnd {
  at: Vec3;
  out: Vec3;
}

function outward(edge: Shape, vertex: Shape): OpenEnd {
  const k = getKernel();
  const at = vertexPoint(vertex);
  const curve = new k.BRepAdaptor_Curve_2(edge);
  const p = pnt(0, 0, 0);
  const d = vec(0, 0, 0);
  const [start, end] = [curve.FirstParameter(), curve.LastParameter()];
  curve.D1(start, p, d);
  const atStart = V.norm(V.sub([p.X(), p.Y(), p.Z()], at)) < LINEAR_TOL;
  curve.D1(atStart ? start : end, p, d);
  const along = V.normalize([d.X(), d.Y(), d.Z()]);
  release([curve, p, d]);
  return { at, out: atStart ? V.scale(along, -1) : along };
}

function capsEnd(face: Shape, end: OpenEnd): boolean {
  const k = getKernel();
  return scoped((own) => {
    const typed = own(k.TopoDS.Face_1(face));
    const surface = own(new k.BRepAdaptor_Surface_2(typed, true));
    const [u0, u1] = [surface.FirstUParameter(), surface.LastUParameter()];
    const [v0, v1] = [surface.FirstVParameter(), surface.LastVParameter()];
    const onPlane = (at: Vec3) =>
      Math.abs(V.dot(V.sub(at, end.at), end.out)) <= LINEAR_TOL;
    const samples = [0, 0.5, 1].flatMap((s) =>
      [0, 0.5, 1].map((t) => {
        const p = own(surface.Value(u0 + s * (u1 - u0), v0 + t * (v1 - v0)));
        return [p.X(), p.Y(), p.Z()] as Vec3;
      }),
    );
    return [faceCentroid(typed), ...samples].every(onPlane);
  });
}

function openEnds(
  op: any,
  sourceEdges: { edge: Shape }[],
  spilled: Set<number>,
): OpenEnd[] {
  const chosen = new Set(sourceEdges.map(({ edge }) => shapeHash(edge)));
  const touches = new Map<number, { vertex: Shape; edge: Shape }[]>();
  for (const { edge } of sourceEdges) {
    for (const vertex of verticesOf(edge)) {
      const hash = shapeHash(vertex);
      touches.set(hash, [...(touches.get(hash) ?? []), { vertex, edge }]);
    }
  }
  const continued = new Set<number>();
  for (let c = 1; c <= op.NbContours(); c++) {
    for (let e = 1; e <= op.NbEdges(c); e++) {
      const edge = op.Edge(c, e);
      if (!chosen.has(shapeHash(edge))) {
        const vertices = verticesOf(edge);
        for (const vertex of vertices) continued.add(shapeHash(vertex));
        release(vertices);
      }
      edge.delete();
    }
  }
  const ends = [...touches]
    .filter(
      ([hash, list]) =>
        list.length === 1 && (continued.has(hash) || spilled.has(hash)),
    )
    .map(([, [only]]) => outward(only!.edge, only!.vertex));
  for (const list of touches.values())
    release(list.map(({ vertex }) => vertex));
  return ends;
}

function splitAtEnds(
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  ends: OpenEnd[],
  featureId: string,
  own: <H extends { delete(): void }>(handle: H) => H,
) {
  const k = getKernel();
  const { min, max } = bboxOf(body.shape);
  const reach = 2 * V.norm(V.sub(max, min)) + 1;
  const beyond = ends
    .map((end) => {
      const { xAxis, yAxis, normal } = frameFromPlane(end.at, end.out);
      const corner = V.sub(end.at, V.scale(V.add(xAxis, yAxis), reach));
      const axes = own(
        new k.gp_Ax2_2(
          own(pnt(...corner)),
          own(dir(...normal)),
          own(dir(...xAxis)),
        ),
      );
      const box = own(
        new k.BRepPrimAPI_MakeBox_5(axes, 2 * reach, 2 * reach, reach),
      );
      return own(box.Shape());
    })
    .reduce((a, b) =>
      own(own(new k.BRepAlgoAPI_Fuse_3(a, b, progress())).Shape()),
    );
  const cut = own(new k.BRepAlgoAPI_Cut_3(body.shape, beyond, progress()));
  const common = own(
    new k.BRepAlgoAPI_Common_3(body.shape, beyond, progress()),
  );
  if (!cut.IsDone() || !common.IsDone()) return null;
  const kept = sourceEdges.map(({ edge }) => {
    const split = cut.IsDeleted(edge) ? [] : listToArray(cut.Modified(edge));
    const image = split.length === 1 ? own(k.TopoDS.Edge_1(split[0])) : edge;
    release(split);
    const whole = !cut.IsDeleted(edge) && split.length <= 1;
    return whole && Math.abs(lengthOf(image) - lengthOf(edge)) < LINEAR_TOL
      ? { edge: image }
      : null;
  });
  if (kept.some((image) => !image)) return null;
  const blank = { shape: beyond, names: new ShapeMap<string>() };
  const [piece, rest] = [cut, common].map((op) => {
    const shape = own(op.Shape());
    return {
      bodyId: body.bodyId,
      shape,
      names: propagateNames(op, [body, blank], shape, featureId),
    };
  });
  return { piece: piece!, rest: rest!, kept: kept as { edge: Shape }[] };
}

function filletClipped(
  body: NamedBody,
  sourceEdges: { edge: Shape }[],
  ends: OpenEnd[],
  f: FilletFeature,
): ToolResult | null {
  const k = getKernel();
  const size = `radius ${f.radius}`;
  const advice = "try fewer edges or a different radius";
  return scoped((own) => {
    const split = splitAtEnds(body, sourceEdges, ends, f.id, own);
    if (!split) return null;
    const { piece, rest, kept } = split;
    const op = own(
      new k.BRepFilletAPI_MakeFillet(
        piece.shape,
        k.ChFi3d_FilletShape.ChFi3d_Rational,
      ),
    );
    for (const { edge } of kept)
      if (!op.Contour(edge)) op.Add_2(f.radius, edge);
    op.Build(progress());
    if (!op.IsDone()) return null;
    const filleted = own(op.Shape());
    rejectBadBlend(op, kept, filleted, piece.shape, "fillet", size, advice);
    const joined = fuseNamed(
      { shape: filleted, names: blendNames(op, piece, kept, filleted, f.id) },
      rest,
      f.id,
      `fillet of ${size} could not close its ends: ${advice}; the previous body has been kept`,
    );
    const merged = unifyTool(joined, f.id);
    if (merged !== joined) own(joined.shape);
    try {
      rejectBadBlend(
        null,
        [],
        merged.shape,
        body.shape,
        "fillet",
        size,
        advice,
      );
    } catch (error) {
      merged.shape.delete();
      throw error;
    }
    return merged;
  });
}

function filletFailure(
  op: any,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  radius: number,
): string {
  const chosen = new Set(refs.map((r) => shapeHash(byName.get(r.edgeName)!)));
  const names = new Map(
    [...byName].map(([name, edge]) => [shapeHash(edge), name]),
  );
  const added = new Set<string>();
  for (let i = 1; i <= op.NbFaultyContours(); i++) {
    const contour = op.FaultyContour(i);
    for (let j = 1; j <= op.NbEdges(contour); j++) {
      const edge = op.Edge(contour, j);
      const hash = shapeHash(edge);
      edge.delete();
      if (!chosen.has(hash)) added.add(names.get(hash) ?? "an unnamed edge");
    }
  }
  return added.size > 0
    ? `fillet of radius ${radius} failed on ${[...added].join(", ")}, a tangent continuation of the selected edges: try a smaller radius or fillet this edge before its neighbours`
    : `fillet of radius ${radius} failed: radius may be too large for the geometry`;
}

export function rejectInvalid(
  result: Shape,
  before: Shape,
  kind: string,
  size: string,
  advice: string,
): void {
  const broken = invalidPart(result);
  if (!broken) return;
  const earlier = invalidPart(before);
  throw new Error(
    earlier
      ? `${kind} of ${size} cannot be published: the body was already invalid before this ${kind} (the kernel check rejects a ${earlier}), so the fault comes from an earlier feature; the previous body has been kept`
      : `${kind} of ${size} left an invalid shape (the kernel check rejects a ${broken}): ${advice}; the previous body has been kept`,
  );
}

function rejectBadBlend(
  op: any,
  sourceEdges: { edge: Shape }[],
  result: Shape,
  before: Shape,
  kind: "fillet" | "chamfer",
  size: string,
  advice: string,
): void {
  rejectInvalid(result, before, kind, size, advice);
  if (op && looseBlend(op, sourceEdges, result))
    throw new Error(
      `${kind} could not be built cleanly at this ${kind === "fillet" ? "radius" : "distance"}; try a smaller one`,
    );
  if (op && spilledEnds(op).size > 0)
    throw new Error(
      `${kind} of ${size} runs past the end of its edges: ${advice}; the previous body has been kept`,
    );
  const cut = cutsThrough(op, sourceEdges, result, before);
  if (cut === false) return;
  throw new Error(
    cut
      ? `${kind} of ${size} cuts through the body: ${advice}; the previous body has been kept`
      : `${kind} of ${size} could not be checked for cutting through the body: ${advice}; the previous body has been kept`,
  );
}

function spilledEnds(op: any): Set<number> {
  const touches = new Map<number, number>();
  const ends: { vertex: Shape; edge: Shape }[] = [];
  for (let c = 1; c <= op.NbContours(); c++) {
    if (!op.Closed(c))
      ends.push(
        { vertex: op.FirstVertex(c), edge: op.Edge(c, 1) },
        { vertex: op.LastVertex(c), edge: op.Edge(c, op.NbEdges(c)) },
      );
    for (let e = 1; e <= op.NbEdges(c); e++) {
      const edge = op.Edge(c, e);
      const vertices = verticesOf(edge);
      for (const vertex of vertices) {
        const hash = shapeHash(vertex);
        touches.set(hash, (touches.get(hash) ?? 0) + 1);
      }
      release([edge, ...vertices]);
    }
  }
  const spilled = new Set<number>();
  for (const { vertex, edge } of ends) {
    const hash = shapeHash(vertex);
    if (touches.get(hash) !== 1) continue;
    const generated = listToArray(op.Generated(vertex));
    const end = generated.length > 0 ? outward(edge, vertex) : null;
    if (end && !generated.every((face) => capsEnd(face, end)))
      spilled.add(hash);
    release(generated);
  }
  release(ends.flatMap(({ vertex, edge }) => [vertex, edge]));
  return spilled;
}

export function invalidPart(shape: Shape): string | null {
  const check = new (getKernel().BRepCheck_Analyzer)(shape, true, false, false);
  try {
    if (check.IsValid_2()) return null;
    for (const [part, of] of [
      ["face", facesOf],
      ["edge", edgesOf],
      ["vertex", verticesOf],
    ] as const) {
      const shapes = of(shape);
      try {
        if (shapes.some((s) => !check.IsValid_1(s))) return part;
      } finally {
        release(shapes);
      }
    }
    return "solid";
  } finally {
    check.delete();
  }
}

/**
 * Chamfer fallback for what ChFi3d can't do: when the selected edges are the
 * complete outline of a planar cap ringed by perpendicular planar walls, the
 * chamfer equals intersecting the body with an envelope — the cap outline
 * offset inward by `distance`, lofted to the full outline `distance` deeper,
 * plus everything beyond. A boolean has no trouble with a wall the chamfer
 * consumes entirely (3.5 + 3.5 on a 7 mm plate), which is exactly where
 * ChFi3d gives up. Returns null when the selection doesn't fit this shape.
 */
function chamferByEnvelope(
  body: NamedBody,
  selected: { edge: Shape; name: string }[],
  distance: number,
  featureId: string,
): ToolResult | null {
  const k = getKernel();
  const selHashes = new Set(selected.map((s) => shapeHash(s.edge)));
  const bodyFaces = facesOf(body.shape);
  const edgeFaces = new Map<number, Shape[]>();
  for (const face of bodyFaces) {
    for (const e of edgesOf(face)) {
      const h = shapeHash(e);
      edgeFaces.set(h, [...(edgeFaces.get(h) ?? []), face]);
    }
  }
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // caps: planar faces whose whole OUTER outline is selected, ringed by
  // perpendicular planar walls. Holes in the cap are left alone — the
  // envelope only shapes the outline, so a through-hole survives untouched
  // (its edges must not be part of the selection, though).
  const caps: {
    face: Shape;
    edges: Shape[];
    plane: { origin: Vec3; normal: Vec3 };
  }[] = [];
  const covered = new Set<number>();
  for (const face of bodyFaces) {
    const fe = edgesOf(k.BRepTools.OuterWire(face));
    if (fe.length === 0 || !fe.every((e) => selHashes.has(shapeHash(e))))
      continue;
    const plane = planarFacePlane(face);
    if (!plane) return null;
    for (const e of fe) {
      const h = shapeHash(e);
      const wall = (edgeFaces.get(h) ?? []).find(
        (w) => shapeHash(w) !== shapeHash(face),
      );
      const wp = wall ? planarFacePlane(wall) : null;
      if (!wall || !wp || Math.abs(dot(wp.normal, plane.normal)) > UNIT_DOT_TOL)
        return null;
      // the chamfer may use up the wall exactly, but not cut past it
      let wallDepth = 0;
      for (const v of verticesOf(wall)) {
        const p = k.BRep_Tool.Pnt(v);
        const rel: Vec3 = [
          p.X() - plane.origin[0],
          p.Y() - plane.origin[1],
          p.Z() - plane.origin[2],
        ];
        wallDepth = Math.max(wallDepth, -dot(rel, plane.normal));
        p.delete();
      }
      if (wallDepth < distance - LINEAR_TOL) return null;
      covered.add(h);
    }
    caps.push({ face, edges: fe, plane });
  }
  if (caps.length === 0 || covered.size !== selHashes.size) return null;

  const firstWire = (shape: Shape): Shape | null => {
    if (shape.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_WIRE)
      return k.TopoDS.Wire_1(shape);
    const ex = new k.TopExp_Explorer_2(
      shape,
      k.TopAbs_ShapeEnum.TopAbs_WIRE,
      k.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    const w = ex.More() ? k.TopoDS.Wire_1(ex.Current()) : null;
    ex.delete();
    return w;
  };
  /** Translate a shape `t` along the cap's inward direction. */
  const inward = (shape: Shape, n: Vec3, t: number): Shape => {
    const tr = new k.gp_Trsf_1();
    tr.SetTranslation_1(vec(-n[0] * t, -n[1] * t, -n[2] * t));
    const op = transformOp(shape, tr);
    const s = op.Shape();
    op.delete();
    tr.delete();
    return s;
  };
  const bb = bboxOf(body.shape);
  const diag = Math.hypot(
    bb.max[0] - bb.min[0],
    bb.max[1] - bb.min[1],
    bb.max[2] - bb.min[2],
  );

  let current: NamedBody = body;
  for (const cap of caps) {
    const n = cap.plane.normal;
    // offset the OUTER outline only — offsetting the cap face itself would
    // push any hole in it outward as well
    const outlineFaceMk = new k.BRepBuilderAPI_MakeFace_15(
      k.BRepTools.OuterWire(cap.face),
      true,
    );
    if (!outlineFaceMk.IsDone()) return null;
    const outlineFace = outlineFaceMk.Face();
    outlineFaceMk.delete();
    const offsetOutline = (d: number): Shape | null => {
      const mk = new k.BRepOffsetAPI_MakeOffset_2(
        outlineFace,
        k.GeomAbs_JoinType.GeomAbs_Intersection,
        false,
      );
      mk.Perform(d, 0);
      const w = mk.IsDone() ? firstWire(mk.Shape()) : null;
      mk.delete();
      return w;
    };
    // The chamfer band: for every outline edge, the planar quad between that
    // edge moved `distance` deeper and its counterpart on the inward-offset
    // outline. Built from exact planes — a ruled loft would give BSplines.
    const inner = offsetOutline(-distance);
    if (!inner) return null;
    const innerPts = verticesOf(inner).map(vertexPoint);
    const nearestInner = (q: Vec3): Vec3 | undefined => {
      let best = innerPts[0];
      let bestDist = Infinity;
      for (const c of innerPts) {
        const dist = Math.hypot(c[0] - q[0], c[1] - q[1], c[2] - q[2]);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      return best;
    };
    const deeper = (p: Vec3): Vec3 => [
      p[0] - n[0] * distance,
      p[1] - n[1] * distance,
      p[2] - n[2] * distance,
    ];
    const sewing = new k.BRepBuilderAPI_Sewing(
      LINEAR_TOL,
      true,
      true,
      true,
      false,
    );
    const addFace = (wire: Shape): boolean => {
      const mk = new k.BRepBuilderAPI_MakeFace_15(k.TopoDS.Wire_1(wire), true);
      const ok = mk.IsDone();
      if (ok) sewing.Add(mk.Face());
      mk.delete();
      return ok;
    };
    for (const e of cap.edges) {
      const ends = verticesOf(e).map(vertexPoint);
      if (ends.length !== 2) return null;
      const q1 = nearestInner(ends[0]!);
      const q2 = nearestInner(ends[1]!);
      if (!q1 || !q2 || q1 === q2) return null; // this edge collapses at that depth
      const poly = new k.BRepBuilderAPI_MakePolygon_1();
      for (const p of [deeper(ends[0]!), deeper(ends[1]!), q2, q1]) {
        poly.Add_1(pnt(p[0], p[1], p[2]));
      }
      poly.Close();
      const ok = poly.IsDone() && addFace(poly.Wire());
      poly.delete();
      if (!ok) return null;
    }
    if (!addFace(inner)) return null;
    if (!addFace(inward(k.BRepTools.OuterWire(cap.face), n, distance)))
      return null;
    sewing.Perform(progress());
    const shell = sewing.SewedShape();
    sewing.delete();
    if (shell.ShapeType() !== k.TopAbs_ShapeEnum.TopAbs_SHELL) return null;
    const solidMk = new k.BRepBuilderAPI_MakeSolid_3(k.TopoDS.Shell_1(shell));
    const band: Shape = solidMk.Solid();
    solidMk.delete();
    k.BRepLib.OrientClosedSolid(band);
    // everything deeper than the band: a prism flared well outside the body
    const bigWire = offsetOutline(diag);
    if (!bigWire) return null;
    const bigFace = new k.BRepBuilderAPI_MakeFace_15(
      k.TopoDS.Wire_1(inward(bigWire, n, distance)),
      true,
    );
    const far = diag + 1;
    const prism = new k.BRepPrimAPI_MakePrism_1(
      bigFace.Face(),
      vec(-n[0] * far, -n[1] * far, -n[2] * far),
      false,
      true,
    );
    prism.Build(progress());
    const fuse = new k.BRepAlgoAPI_Fuse_3(band, prism.Shape(), progress());
    fuse.Build(progress());
    prism.delete();
    bigFace.delete();
    if (!fuse.IsDone()) {
      fuse.delete();
      return null;
    }
    const envelope = fuse.Shape();
    fuse.delete();

    // Names: the band's slanted faces are the chamfer faces, named per source
    // edge like ChFi3d does; its face on the cap plane keeps the cap's name.
    const envNames = new ShapeMap<string>();
    const capName = current.names.get(cap.face);
    const mids = cap.edges.map((e) => ({ e, c: edgeCentroid(e) }));
    for (const face of facesOf(envelope)) {
      const c = faceCentroid(face);
      const depth = -dot(
        [
          c[0] - cap.plane.origin[0],
          c[1] - cap.plane.origin[1],
          c[2] - cap.plane.origin[2],
        ],
        n,
      );
      if (Math.abs(depth) < LINEAR_TOL) {
        if (capName) envNames.set(face, capName);
        continue;
      }
      // only the band's slanted faces sit strictly between the cap plane and
      // the band's deeper end; the far prism's faces all lie deeper
      if (depth < LINEAR_TOL || depth > distance - LINEAR_TOL) continue;
      let best = -1;
      let bestDist = Infinity;
      mids.forEach((m, i) => {
        const dist = Math.hypot(c[0] - m.c[0], c[1] - m.c[1], c[2] - m.c[2]);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
      if (best < 0) continue;
      const idx = selected.findIndex(
        (s) => shapeHash(s.edge) === shapeHash(mids[best]!.e),
      );
      envNames.set(face, `f:${featureId}:fe:${idx + 1}`);
    }

    const common = new k.BRepAlgoAPI_Common_3(
      current.shape,
      envelope,
      progress(),
    );
    common.Build(progress());
    if (!common.IsDone()) {
      common.delete();
      return null;
    }
    const result = common.Shape();
    if (solids(result).length === 0) {
      common.delete();
      return null;
    }
    const names = propagateNames(
      common,
      [current, { shape: envelope, names: envNames }],
      result,
      featureId,
    );
    common.delete();
    current = { bodyId: body.bodyId, shape: result, names };
  }
  return { shape: current.shape, names: current.names };
}

export function evalChamfer(state: EvalState, f: ChamferFeature): void {
  if (f.edges.length === 0) throw new Error("no edges selected");
  if (f.distance <= 0) throw new Error("chamfer distance must be positive");
  blendPerBody(state, f.edges, (body, refs) =>
    chamferBody(state, f, body, refs),
  );
}

function chamferBody(
  state: EvalState,
  f: ChamferFeature,
  body: NamedBody,
  refs: EdgeRef[],
): void {
  const bodyId = body.bodyId;
  const k = getKernel();
  kernelCall("chamfer", () => {
    const byName = computeEdgeNames(body).byName;
    const op = new k.BRepFilletAPI_MakeChamfer(body.shape);
    let result: Shape | undefined;
    try {
      const sourceEdges = collectEdges(body, byName, refs, f.tangentChain);
      for (const { edge } of sourceEdges) {
        if (!op.Contour(edge)) op.Add_2(f.distance, edge);
      }
      op.Build(progress());
      const size = `distance ${f.distance}`;
      const advice = "try fewer edges or a different distance";
      if (!op.IsDone()) {
        const viaEnvelope = chamferByEnvelope(
          body,
          sourceEdges,
          f.distance,
          f.id,
        );
        if (!viaEnvelope) {
          throw new Error(
            `could not build a ${f.distance} mm chamfer: check for missing connecting edges or try a smaller distance`,
          );
        }
        result = viaEnvelope.shape;
        rejectBadBlend(
          null,
          sourceEdges,
          result,
          body.shape,
          "chamfer",
          size,
          advice,
        );
        registerBodySolids(state, bodyId, result, viaEnvelope.names);
        return;
      }
      result = op.Shape();
      rejectBadBlend(
        op,
        sourceEdges,
        result,
        body.shape,
        "chamfer",
        size,
        advice,
      );
      const names = blendNames(op, body, sourceEdges, result, f.id);
      registerBodySolids(state, bodyId, result, names);
    } finally {
      result?.delete();
      op.delete();
      release(byName.values());
    }
  });
}

export function evalCombine(state: EvalState, f: CombineFeature): void {
  const target = state.bodies.get(f.targetBody);
  if (!target) throw new Error(`target body ${f.targetBody} not found`);
  const tools = f.toolBodies.map((id) => {
    const b = state.bodies.get(id);
    if (!b) throw new Error(`tool body ${id} not found`);
    return b;
  });
  if (tools.length === 0) throw new Error("no tool bodies selected");
  const k = getKernel();
  kernelCall("combine", () => {
    let current: NamedBody = target;
    for (const tool of tools) {
      let op: any;
      if (f.operation === "join") {
        op = new k.BRepAlgoAPI_Fuse_3(current.shape, tool.shape, progress());
      } else if (f.operation === "cut") {
        op = checkedCut(current.shape, tool.shape, "boolean cut failed");
      } else {
        op = new k.BRepAlgoAPI_Common_3(current.shape, tool.shape, progress());
      }
      if (!op) continue;
      if (!op.IsDone()) {
        op.delete();
        throw new Error(`boolean ${f.operation} failed`);
      }
      const result = op.Shape();
      const names = propagateNames(op, [current, tool], result, f.id);
      op.delete();
      current = { bodyId: target.bodyId, shape: result, names };
    }
    const joined =
      f.operation === "join"
        ? finishJoin(current, f.id, [target, ...tools])
        : current;
    registerBodySolids(state, target.bodyId, joined.shape, joined.names);
    if (!f.keepTools) {
      for (const tool of tools) state.bodies.delete(tool.bodyId);
    }
  });
}

export function evalOffsetFace(state: EvalState, f: OffsetFaceFeature): void {
  if (f.faces.length === 0) throw new Error("no faces selected");
  if (f.distance === 0) throw new Error("offset distance must be non-zero");
  const bodyId = f.faces[0]!.bodyId;
  const body = state.bodies.get(bodyId);
  if (!body) throw new Error(`body ${bodyId} not found`);
  const k = getKernel();
  kernelCall("offsetFace", () => {
    let current = body;
    for (const ref of f.faces) {
      const face = findFace(current, ref.faceName);
      if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
      const plane = planarFacePlane(face);
      if (!plane) throw new Error("offset face requires a planar face");
      const normal = plane.normal;

      // Press-pull: prism the face by |distance| outward (fuse) or inward (cut)
      const outward = f.distance > 0;
      const dist = Math.abs(f.distance);
      const dirVec: Vec3 = outward
        ? normal
        : [-normal[0], -normal[1], -normal[2]];
      const v = vec(dirVec[0] * dist, dirVec[1] * dist, dirVec[2] * dist);
      const prism = new k.BRepPrimAPI_MakePrism_1(face, v, false, true);
      prism.Build(progress());
      if (!prism.IsDone()) {
        prism.delete();
        throw new Error("offset face prism failed");
      }
      const toolShape = prism.Shape();
      const moved = new ShapeMap<string>();
      if (current.names.version === 2) {
        const last = prism.LastShape_1();
        const caps = facesOf(last);
        for (const cap of caps) moved.set(cap, ref.faceName);
        release([...caps, last]);
      }
      const toolNames = finalizeNames(toolShape, moved, f.id);
      prism.delete();
      v.delete();

      const op = outward
        ? new k.BRepAlgoAPI_Fuse_3(current.shape, toolShape, progress())
        : checkedCut(current.shape, toolShape, "offset face boolean failed");
      if (!op) continue;
      if (!op.IsDone()) {
        op.delete();
        throw new Error("offset face boolean failed");
      }
      const result = op.Shape();
      const names = propagateNames(
        op,
        [current, { shape: toolShape, names: toolNames }],
        result,
        f.id,
      );
      op.delete();
      current = { bodyId, shape: result, names };
    }
    const joined = f.distance > 0 ? finishJoin(current, f.id, [body]) : current;
    registerBodySolids(state, bodyId, joined.shape, joined.names);
  });
}

export function evalSplitBody(state: EvalState, f: SplitBodyFeature): void {
  const body = state.bodies.get(f.body);
  if (!body) throw new Error(`body ${f.body} not found`);
  const frame = resolvePlaneFrame(state, f.tool);
  const k = getKernel();
  kernelCall("splitBody", () => {
    const bbox = bboxOf(body.shape);
    const diag =
      Math.hypot(
        bbox.max[0] - bbox.min[0],
        bbox.max[1] - bbox.min[1],
        bbox.max[2] - bbox.min[2],
      ) + 10;
    const { sols, names } = scoped((own) => {
      const pln = own(
        new k.gp_Pln_3(
          own(pnt(frame.origin[0], frame.origin[1], frame.origin[2])),
          own(dir(frame.normal[0], frame.normal[1], frame.normal[2])),
        ),
      );
      const faceMk = own(
        new k.BRepBuilderAPI_MakeFace_9(pln, -diag, diag, -diag, diag),
      );
      const splitter = own(new k.BRepAlgoAPI_Splitter_1());
      splitter.SetArguments(own(shapeList([body.shape])));
      splitter.SetTools(own(shapeList([own(faceMk.Face())])));
      splitter.Build(progress());
      if (!splitter.IsDone()) throw new Error("split failed");
      const result = own(splitter.Shape());
      const names = propagateNames(splitter, [body], result, f.id);
      return { sols: solids(result), names };
    });
    if (sols.length < 2) {
      release(sols);
      throw new Error("split plane does not intersect the body");
    }
    // Deterministic ordering along the split normal.
    const sorted = sols
      .map((s) => {
        const bb = bboxOf(s);
        const c: Vec3 = [
          (bb.min[0] + bb.max[0]) / 2,
          (bb.min[1] + bb.max[1]) / 2,
          (bb.min[2] + bb.max[2]) / 2,
        ];
        return { s, key: V.dot(c, frame.normal) };
      })
      .sort((a, b) => a.key - b.key);
    state.bodies.delete(f.body);
    sorted.forEach((item, i) => {
      const id = i === 0 ? f.body : `${f.body}:s${i + 1}`;
      state.bodies.set(id, { bodyId: id, shape: item.s, names });
    });
  });
}

function mirrorTrsfFor(frame: PlaneFrame): any {
  const k = getKernel();
  const trsf = new k.gp_Trsf_1();
  const ax2 = new k.gp_Ax2_2(
    pnt(frame.origin[0], frame.origin[1], frame.origin[2]),
    dir(frame.normal[0], frame.normal[1], frame.normal[2]),
    dir(frame.xAxis[0], frame.xAxis[1], frame.xAxis[2]),
  );
  trsf.SetMirror_3(ax2);
  ax2.delete();
  return trsf;
}

export function evalMirror(state: EvalState, f: MirrorFeature): void {
  const frame = resolvePlaneFrame(state, f.plane);
  kernelCall("mirror", () => {
    const trsf = mirrorTrsfFor(frame);
    for (const bodyId of f.bodies) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      const tr = transformOp(body.shape, trsf);
      const mirrored = tr.Shape();
      const mirroredNames = transformNames(tr, body, `m:${f.id}`);
      tr.delete();
      if (f.combine) {
        const fused = fuseNamed(
          body,
          { shape: mirrored, names: mirroredNames },
          f.id,
          "mirror join failed",
        );
        const joined = finishJoin(fused, f.id, [body, { shape: mirrored }]);
        registerBodySolids(state, bodyId, joined.shape, joined.names);
      } else {
        const newId = `b:${f.id}:${bodyId}`;
        const finalNames = finalizeNames(mirrored, mirroredNames, f.id);
        registerBodySolids(state, newId, mirrored, finalNames);
      }
    }
    trsf.delete();
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
      const moved = tr.Shape();
      // empty prefix: keep the original persistent names
      const names = transformNames(tr, body, "");
      tr.delete();
      trsf.delete();
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

export function evalLinearPattern(
  state: EvalState,
  f: LinearPatternFeature,
): void {
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
  kernelCall("linearPattern", () => {
    for (const bodyId of f.bodies) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      let combined: NamedBody = body;
      const copies: { shape: Shape }[] = [body];
      for (let i = 1; i < f.count; i++) {
        const offset = V.scale(V.scale(direction, f.spacing), i);
        const prefix = `p${i}:${f.id}`;
        const trsf = placementToTrsf(Placement.fromTranslation(offset));
        const tr = transformOp(body.shape, trsf);
        const instance = tr.Shape();
        const instNames = transformNames(tr, body, prefix);
        tr.delete();
        trsf.delete();
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
          const newId = `b:${f.id}:${bodyId}:${i}`;
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
        registerBodySolids(state, bodyId, joined.shape, joined.names);
      }
    }
  });
}

export function evalCircularPattern(
  state: EvalState,
  f: CircularPatternFeature,
): void {
  if (f.count < 2) throw new Error("pattern count must be ≥ 2");
  const axis = resolveAxis(state, f.axis);
  const total = ((f.totalAngle || 360) * Math.PI) / 180;
  const fullCircle = Math.abs((f.totalAngle || 360) - 360) < ANGULAR_TOL_DEG;
  const step = fullCircle ? total / f.count : total / (f.count - 1);
  kernelCall("circularPattern", () => {
    for (const bodyId of f.bodies) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      let combined: NamedBody = body;
      const copies: { shape: Shape }[] = [body];
      for (let i = 1; i < f.count; i++) {
        const trsf = placementToTrsf(
          Placement.fromAxisAngle(axis.direction, step * i, axis.origin),
        );
        const tr = transformOp(body.shape, trsf);
        const instance = tr.Shape();
        const instNames = transformNames(tr, body, `p${i}:${f.id}`);
        tr.delete();
        trsf.delete();
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
          const newId = `b:${f.id}:${bodyId}:${i}`;
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
        registerBodySolids(state, bodyId, joined.shape, joined.names);
      }
    }
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

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function evaluateFeature(
  state: EvalState,
  feature: Feature,
  earlier: Feature[],
  sources: Sources = new Map(),
): FeatureOutcome | void {
  const kind = featureKind(feature.type);
  if (kind)
    return kind.evaluate(
      { state, earlier, index: earlier.length, sources },
      feature,
    );
  switch (feature.type) {
    case "importMesh": {
      const { shape, warning } = readMesh(feature),
        bodyId = `b:${feature.id}`,
        names = finalizeNames(shape, new ShapeMap(), feature.id);
      if (!warning) return registerBodySolids(state, bodyId, shape, names);
      state.bodies.set(bodyId, { bodyId, shape, names });
      return { warning };
    }
    default:
      throw new Error(`unknown feature type ${feature.type}`);
  }
}
