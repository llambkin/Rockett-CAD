/**
 * Feature evaluators — each timeline feature type maps to a function that
 * transforms the evaluation state using the OCCT kernel.
 */

import {
  detectProfiles,
  solveSketch,
  projectEdge,
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
  type Feature,
  type FilletFeature,
  type LinearPatternFeature,
  type LoftFeature,
  type MirrorFeature,
  type MoveFeature,
  type CircularPatternFeature,
  type OffsetFaceFeature,
  type PlaneFrame,
  type PlaneRef,
  type Profile,
  type ProfileRef,
  type RevolveFeature,
  type ShellFeature,
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
  listToArray,
  placementToTrsf,
  planarFacePlane,
  pnt,
  progress,
  release,
  shapeHash,
  solids,
  vec,
  vertices as verticesOf,
  volumeOf,
  type Shape,
} from "./kernel.js";
import {
  computeEdgeNames,
  finalizeNames,
  findFace,
  historyNames,
  propagateNames,
  transformNames,
  type NameMap,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import {
  ORIGIN_FRAMES,
  V,
  frameFromPlane,
  offsetFrame,
  uvTo3d,
} from "./frames.js";
import { curveInfo } from "./tessellate.js";
import { tangentEdges } from "./tangentEdges.js";
import { readImport, readMesh, type Sources } from "./importers.js";
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
}

export function cloneState(state: EvalState): EvalState {
  return {
    bodies: new Map(state.bodies),
    sketches: new Map(state.sketches),
    planes: new Map(state.planes),
  };
}

export function emptyState(): EvalState {
  return { bodies: new Map(), sketches: new Map(), planes: new Map() };
}

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
    const sketch = state.sketches.get(ref.sketchId);
    if (!sketch) throw new Error(`sketch ${ref.sketchId} not found`);
    const line = sketch.entities.find(
      (e) => e.id === ref.entityId && e.kind === "line",
    ) as any;
    if (!line) throw new Error(`axis line ${ref.entityId} not found`);
    const p1 = sketch.entities.find((e) => e.id === line.p1) as any;
    const p2 = sketch.entities.find((e) => e.id === line.p2) as any;
    const a = uvTo3d(sketch.frame, p1.x, p1.y);
    const b = uvTo3d(sketch.frame, p2.x, p2.y);
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
    const profile = s.profiles.find((p) => p.id === ref.profileId);
    if (!profile) {
      throw new Error(
        `profile ${ref.profileId} no longer exists in ${ref.sketchId} — the sketch region may have changed`,
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

/**
 * Register the solids of `shape` under `bodyId`. If the shape contains
 * multiple solids they become bodyId, bodyId:2, ... ordered by volume.
 */
function registerBodySolids(
  state: EvalState,
  bodyId: string,
  shape: Shape,
  names: NameMap,
): void {
  const sols = solids(shape);
  if (sols.length === 0) {
    state.bodies.delete(bodyId);
    return;
  }
  if (sols.length === 1) {
    state.bodies.set(bodyId, { bodyId, shape: sols[0], names });
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

// ---------------------------------------------------------------------------
// Tool-solid creation (extrude / revolve / sweep / loft share this plumbing)
// ---------------------------------------------------------------------------

interface ToolResult {
  shape: Shape;
  names: NameMap;
}

/**
 * Merge coplanar faces and collinear edges of a tool solid, so a body made
 * from several adjacent sketch regions reads as one solid instead of showing
 * the sketch's internal boundaries as edges. Purely cosmetic: on any kernel
 * failure the unmerged tool is kept.
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
    uni.Build();
    const merged = uni.Shape();
    if (facesOf(merged).length === 0) {
      uni.delete();
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

function applyToolOperation(
  state: EvalState,
  featureId: string,
  tool: ToolResult,
  operation: "newBody" | "join" | "cut" | "intersect",
): void {
  const k = getKernel();
  if (operation === "newBody" || state.bodies.size === 0) {
    registerBodySolids(state, `b:${featureId}`, tool.shape, tool.names);
    return;
  }

  if (operation === "join") {
    // Fuse into the first overlapping body; otherwise create a new body.
    const target = [...state.bodies.values()].find((b) =>
      bboxOverlap(b.shape, tool.shape),
    );
    if (!target) {
      registerBodySolids(state, `b:${featureId}`, tool.shape, tool.names);
      return;
    }
    const op = new k.BRepAlgoAPI_Fuse_3(target.shape, tool.shape, progress());
    op.Build(progress());
    if (!op.IsDone()) {
      op.delete();
      throw new Error("boolean join failed");
    }
    const result = op.Shape();
    const names = propagateNames(
      op,
      [target, { shape: tool.shape, names: tool.names }],
      result,
      featureId,
    );
    op.delete();
    // Clean the final union too: unifying only the incoming tool leaves
    // coplanar splits where a later extrusion meets the existing body.
    const joined = unifyTool({ shape: result, names }, featureId);
    registerBodySolids(state, target.bodyId, joined.shape, joined.names);
    return;
  }

  if (operation === "cut") {
    // Cut affects every overlapping body.
    let any = false;
    for (const body of Array.from(state.bodies.values())) {
      if (!bboxOverlap(body.shape, tool.shape)) continue;
      any = true;
      const op = new k.BRepAlgoAPI_Cut_3(body.shape, tool.shape, progress());
      op.Build(progress());
      if (!op.IsDone()) {
        op.delete();
        throw new Error("boolean cut failed");
      }
      const result = op.Shape();
      const names = propagateNames(
        op,
        [body, { shape: tool.shape, names: tool.names }],
        result,
        featureId,
      );
      op.delete();
      registerBodySolids(state, body.bodyId, result, names);
    }
    if (!any) throw new Error("cut tool does not intersect any body");
    return;
  }

  // intersect
  const target = [...state.bodies.values()].find((b) =>
    bboxOverlap(b.shape, tool.shape),
  );
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
}

// ---------------------------------------------------------------------------
// Individual feature evaluators
// ---------------------------------------------------------------------------

function evalSketch(state: EvalState, f: SketchFeature): void {
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
      const tr = new k.BRepBuilderAPI_Transform_2(face, trsf, true);
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
      throw new Error("prism generation failed — is the profile closed?");
    }
    const shape = prism.Shape();

    const provisional: NameMap = new ShapeMap();
    // side faces from profile edges
    for (const e of edgesOf(face)) {
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
    // caps
    const firstShape = prism.FirstShape_1();
    for (const cap of facesOf(firstShape)) {
      provisional.set(cap, `f:${featureId}:cap:start`);
    }
    const lastShape = prism.LastShape_1();
    for (const cap of facesOf(lastShape)) {
      provisional.set(cap, `f:${featureId}:cap:end`);
    }
    const names = finalizeNames(shape, provisional, featureId);
    prism.delete();
    v.delete();
    return { shape, names };
  });
}

function evalExtrude(state: EvalState, f: ExtrudeFeature): void {
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

  // Planar body faces used directly as profiles (face extrude).
  for (const ref of faceRefs) {
    const body = state.bodies.get(ref.bodyId);
    if (!body) throw new Error(`body ${ref.bodyId} no longer exists`);
    const face = findFace(body, ref.faceName);
    if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
    const plane = planarFacePlane(face);
    if (!plane) throw new Error(`face ${ref.faceName} is not planar`);
    const n = plane.normal;
    // Sketch regions drawn on this face split it (Fusion-style). Regions
    // also selected as profiles in this feature get their own prism and
    // fuse back in below.
    const cut = subtractSketchRegionsFromFace(face, state.sketches.values());
    sources.push({
      pf: {
        face: cut.face,
        edgeEntity: cut.edgeEntity,
        profileId: ref.faceName,
      },
      n,
      copy: true,
    });
  }

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

  // "New body": every region is its own body — Join is what merges them.
  if (f.operation === "newBody") {
    tools.forEach((t, i) => {
      const u = unifyTool(t, f.id);
      registerBodySolids(
        state,
        i === 0 ? `b:${f.id}` : `b:${f.id}:${i + 1}`,
        u.shape,
        u.names,
      );
    });
    return;
  }

  // merge multiple profile prisms into one tool
  let tool = tools[0]!;
  const k = getKernel();
  for (let i = 1; i < tools.length; i++) {
    const op = new k.BRepAlgoAPI_Fuse_3(
      tool.shape,
      tools[i]!.shape,
      progress(),
    );
    op.Build(progress());
    if (!op.IsDone()) {
      op.delete();
      throw new Error("failed to merge profile solids");
    }
    const merged = op.Shape();
    const names = propagateNames(
      op,
      [
        { shape: tool.shape, names: tool.names },
        { shape: tools[i]!.shape, names: tools[i]!.names },
      ],
      merged,
      f.id,
    );
    op.delete();
    tool = { shape: merged, names };
  }

  applyToolOperation(state, f.id, unifyTool(tool, f.id), f.operation);
}

function evalRevolve(state: EvalState, f: RevolveFeature): void {
  const { faces: profileFaces } = resolveProfiles(state, f.profiles);
  const axis = resolveAxis(state, f.axis);
  const k = getKernel();
  const angleRad = (Math.min(Math.abs(f.angle), 360) * Math.PI) / 180;
  const full = Math.abs(f.angle) >= 360 - ANGULAR_TOL_DEG;
  const sign = f.angle >= 0 ? 1 : -1;

  const tools: ToolResult[] = [];
  for (const pf of profileFaces) {
    const tool = kernelCall("revolve", () => {
      const ax1 = new k.gp_Ax1_2(
        pnt(axis.origin[0], axis.origin[1], axis.origin[2]),
        dir(
          sign * axis.direction[0],
          sign * axis.direction[1],
          sign * axis.direction[2],
        ),
      );
      const revol = full
        ? new k.BRepPrimAPI_MakeRevol_2(pf.face, ax1, false)
        : new k.BRepPrimAPI_MakeRevol_1(pf.face, ax1, angleRad, false);
      revol.Build(progress());
      if (!revol.IsDone()) {
        revol.delete();
        throw new Error(
          "revolve failed — the profile may cross the axis of revolution",
        );
      }
      const shape = revol.Shape();
      const provisional: NameMap = new ShapeMap();
      for (const e of edgesOf(pf.face)) {
        const entityId = pf.edgeEntity.get(shapeHash(e));
        if (!entityId) continue;
        const gen = listToArray(revol.Generated(e));
        for (const g of gen) {
          if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE) {
            provisional.set(g, `f:${f.id}:s:${entityId}`);
          }
        }
        release(gen);
      }
      if (!full) {
        for (const cap of facesOf(revol.FirstShape_1())) {
          provisional.set(cap, `f:${f.id}:cap:start`);
        }
        for (const cap of facesOf(revol.LastShape_1())) {
          provisional.set(cap, `f:${f.id}:cap:end`);
        }
      }
      const names = finalizeNames(shape, provisional, f.id);
      revol.delete();
      ax1.delete();
      return { shape, names };
    });
    tools.push(tool);
  }

  // "New body": every region is its own body — Join is what merges them.
  if (f.operation === "newBody") {
    tools.forEach((t, i) => {
      const u = unifyTool(t, f.id);
      registerBodySolids(
        state,
        i === 0 ? `b:${f.id}` : `b:${f.id}:${i + 1}`,
        u.shape,
        u.names,
      );
    });
    return;
  }

  let tool = tools[0]!;
  for (let i = 1; i < tools.length; i++) {
    const op = new k.BRepAlgoAPI_Fuse_3(
      tool.shape,
      tools[i]!.shape,
      progress(),
    );
    op.Build(progress());
    const merged = op.Shape();
    const names = propagateNames(
      op,
      [
        { shape: tool.shape, names: tool.names },
        { shape: tools[i]!.shape, names: tools[i]!.names },
      ],
      merged,
      f.id,
    );
    op.delete();
    tool = { shape: merged, names };
  }
  applyToolOperation(state, f.id, unifyTool(tool, f.id), f.operation);
}

function evalSweep(state: EvalState, f: SweepFeature): void {
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

  const tool = kernelCall("sweep", () => {
    const pipe = new k.BRepOffsetAPI_MakePipe_1(wire, profileFaces[0]!.face);
    pipe.Build(progress());
    if (!pipe.IsDone()) {
      pipe.delete();
      throw new Error(
        "sweep failed — check that the profile lies on the path start",
      );
    }
    const shape = pipe.Shape();
    const names = finalizeNames(shape, new ShapeMap(), f.id);
    pipe.delete();
    return { shape, names };
  });
  applyToolOperation(state, f.id, tool, f.operation);
}

function evalLoft(state: EvalState, f: LoftFeature): void {
  const k = getKernel();
  if (f.sections.length < 2)
    throw new Error("loft requires at least two sections");
  const tool = kernelCall("loft", () => {
    const thru = new k.BRepOffsetAPI_ThruSections(true, false, LINEAR_TOL);
    for (const ref of f.sections) {
      const sketch = state.sketches.get(ref.sketchId);
      if (!sketch) throw new Error(`sketch ${ref.sketchId} not found`);
      const profile = sketch.profiles.find((p) => p.id === ref.profileId);
      if (!profile) throw new Error(`profile ${ref.profileId} not found`);
      const pf = buildProfileFace(profile, sketch.entities, sketch.frame);
      // use the outer wire of the face
      const wires = [...exploreWires(pf.face)];
      if (wires.length === 0) throw new Error("loft section has no wire");
      thru.AddWire(wires[0]);
    }
    thru.Build(progress());
    if (!thru.IsDone()) {
      thru.delete();
      throw new Error("loft failed — sections may be incompatible");
    }
    const shape = thru.Shape();
    const names = finalizeNames(shape, new ShapeMap(), f.id);
    thru.delete();
    return { shape, names };
  });
  applyToolOperation(state, f.id, tool, f.operation);
}

function* exploreWires(shape: Shape): Generator<Shape> {
  const k = getKernel();
  const ex = new k.TopExp_Explorer_2(
    shape,
    k.TopAbs_ShapeEnum.TopAbs_WIRE,
    k.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  while (ex.More()) {
    yield k.TopoDS.Wire_1(ex.Current());
    ex.Next();
  }
  ex.delete();
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

function collectEdges(
  body: NamedBody,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  tangentChain: boolean | undefined,
  label: string,
): { edge: Shape; name: string }[] {
  const resolve = (ref: EdgeRef) => {
    if (ref.bodyId !== body.bodyId) {
      throw new Error(`all ${label} edges must belong to the same body`);
    }
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
  const provisional: NameMap = new ShapeMap();
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

function evalFillet(state: EvalState, f: FilletFeature): void {
  if (f.edges.length === 0) throw new Error("no edges selected");
  if (f.radius <= 0) throw new Error("fillet radius must be positive");
  const bodyId = f.edges[0]!.bodyId;
  const body = state.bodies.get(bodyId);
  if (!body) throw new Error(`body ${bodyId} no longer exists`);
  const k = getKernel();
  kernelCall("fillet", () => {
    const byName = computeEdgeNames(body).byName;
    const op = new k.BRepFilletAPI_MakeFillet(
      body.shape,
      k.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    let result: Shape | undefined;
    try {
      const sourceEdges = collectEdges(
        body,
        byName,
        f.edges,
        f.tangentChain,
        "fillet",
      );
      for (const { edge } of sourceEdges) {
        if (!op.Contour(edge)) op.Add_2(f.radius, edge);
      }
      op.Build(progress());
      if (!op.IsDone()) {
        throw new Error(
          `fillet of radius ${f.radius} failed — radius may be too large for the geometry`,
        );
      }
      result = op.Shape();
      // IsDone only confirms that the algorithm completed. Some edge junctions
      // produce an invalid solid even when it reports success; never publish it.
      const check = new k.BRepCheck_Analyzer(result, true, false);
      let valid: boolean;
      try {
        valid = check.IsValid_2();
      } finally {
        check.delete();
      }
      if (!valid) {
        throw new Error(
          `fillet of radius ${f.radius} produced invalid geometry — try fewer edges or a different radius; the previous body has been kept`,
        );
      }
      const names = blendNames(op, body, sourceEdges, result, f.id);
      registerBodySolids(state, bodyId, result, names);
    } finally {
      result?.delete();
      op.delete();
      release(byName.values());
    }
  });
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
    const op = new k.BRepBuilderAPI_Transform_2(shape, tr, true);
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
    const point = (v: Shape): Vec3 => {
      const p = k.BRep_Tool.Pnt(v);
      const out: Vec3 = [p.X(), p.Y(), p.Z()];
      p.delete();
      return out;
    };
    const innerPts = verticesOf(inner).map(point);
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
      const ends = verticesOf(e).map(point);
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
    const envNames: NameMap = new ShapeMap();
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

function evalChamfer(state: EvalState, f: ChamferFeature): void {
  if (f.edges.length === 0) throw new Error("no edges selected");
  if (f.distance <= 0) throw new Error("chamfer distance must be positive");
  const bodyId = f.edges[0]!.bodyId;
  const body = state.bodies.get(bodyId);
  if (!body) throw new Error(`body ${bodyId} no longer exists`);
  const k = getKernel();
  kernelCall("chamfer", () => {
    const byName = computeEdgeNames(body).byName;
    const op = new k.BRepFilletAPI_MakeChamfer(body.shape);
    let result: Shape | undefined;
    try {
      const sourceEdges = collectEdges(
        body,
        byName,
        f.edges,
        f.tangentChain,
        "chamfer",
      );
      for (const { edge } of sourceEdges) {
        if (!op.Contour(edge)) op.Add_2(f.distance, edge);
      }
      op.Build(progress());
      if (!op.IsDone()) {
        // ChFi3d can't consume a face (e.g. chamfers from both caps meeting
        // mid-wall); a boolean envelope can, for complete planar outlines
        const viaEnvelope = chamferByEnvelope(
          body,
          sourceEdges,
          f.distance,
          f.id,
        );
        if (!viaEnvelope) {
          throw new Error(
            `could not build a ${f.distance} mm chamfer — check for missing connecting edges or try a smaller distance`,
          );
        }
        registerBodySolids(state, bodyId, viaEnvelope.shape, viaEnvelope.names);
        return;
      }
      result = op.Shape();
      const names = blendNames(op, body, sourceEdges, result, f.id);
      registerBodySolids(state, bodyId, result, names);
    } finally {
      result?.delete();
      op.delete();
      release(byName.values());
    }
  });
}

function evalCombine(state: EvalState, f: CombineFeature): void {
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
        op = new k.BRepAlgoAPI_Cut_3(current.shape, tool.shape, progress());
      } else {
        op = new k.BRepAlgoAPI_Common_3(current.shape, tool.shape, progress());
      }
      op.Build(progress());
      if (!op.IsDone()) {
        op.delete();
        throw new Error(`boolean ${f.operation} failed`);
      }
      const result = op.Shape();
      const names = propagateNames(op, [current, tool], result, f.id);
      op.delete();
      current = { bodyId: target.bodyId, shape: result, names };
    }
    registerBodySolids(state, target.bodyId, current.shape, current.names);
    if (!f.keepTools) {
      for (const tool of tools) state.bodies.delete(tool.bodyId);
    }
  });
}

function evalShell(state: EvalState, f: ShellFeature): void {
  if (f.thickness <= 0) throw new Error("shell thickness must be positive");
  const bodyId = f.openFaces[0]?.bodyId ?? [...state.bodies.keys()][0];
  const body = bodyId === undefined ? undefined : state.bodies.get(bodyId);
  if (bodyId === undefined || !body) throw new Error("no body to shell");
  const k = getKernel();
  kernelCall("shell", () => {
    const closing = new k.TopTools_ListOfShape_1();
    for (const ref of f.openFaces) {
      const face = findFace(body, ref.faceName);
      if (!face) throw new Error(`face ${ref.faceName} no longer exists`);
      closing.Append_1(face);
    }
    const op = new k.BRepOffsetAPI_MakeThickSolid();
    op.MakeThickSolidByJoin(
      body.shape,
      closing,
      -f.thickness,
      LINEAR_TOL,
      k.BRepOffset_Mode.BRepOffset_Skin,
      false,
      false,
      k.GeomAbs_JoinType.GeomAbs_Arc,
      false,
      progress(),
    );
    op.Build(progress());
    if (!op.IsDone()) {
      op.delete();
      closing.delete();
      throw new Error("shell failed — thickness may be too large");
    }
    const result = op.Shape();
    const names = propagateNames(op, [body], result, f.id);
    op.delete();
    closing.delete();
    if (f.openFaces.length > 0) {
      registerBodySolids(state, bodyId, result, names);
      return;
    }
    const cut = new k.BRepAlgoAPI_Cut_3(body.shape, result, progress());
    cut.Build(progress());
    if (!cut.IsDone()) {
      cut.delete();
      throw new Error("shell failed: could not hollow the closed body");
    }
    const hollow = cut.Shape();
    const hollowNames = propagateNames(
      cut,
      [body, { shape: result, names }],
      hollow,
      f.id,
    );
    cut.delete();
    registerBodySolids(state, bodyId, hollow, hollowNames);
  });
}

function evalOffsetFace(state: EvalState, f: OffsetFaceFeature): void {
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
      const toolNames = finalizeNames(toolShape, new ShapeMap(), f.id);
      prism.delete();
      v.delete();

      const op = outward
        ? new k.BRepAlgoAPI_Fuse_3(current.shape, toolShape, progress())
        : new k.BRepAlgoAPI_Cut_3(current.shape, toolShape, progress());
      op.Build(progress());
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
    registerBodySolids(state, bodyId, current.shape, current.names);
  });
}

function evalSplitBody(state: EvalState, f: SplitBodyFeature): void {
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
    const pln = new k.gp_Pln_3(
      pnt(frame.origin[0], frame.origin[1], frame.origin[2]),
      dir(frame.normal[0], frame.normal[1], frame.normal[2]),
    );
    const faceMk = new k.BRepBuilderAPI_MakeFace_9(
      pln,
      -diag,
      diag,
      -diag,
      diag,
    );
    const toolFace = faceMk.Face();
    faceMk.delete();
    pln.delete();

    const splitter = new k.BRepAlgoAPI_Splitter_1();
    const args = new k.TopTools_ListOfShape_1();
    args.Append_1(body.shape);
    const toolsList = new k.TopTools_ListOfShape_1();
    toolsList.Append_1(toolFace);
    splitter.SetArguments(args);
    splitter.SetTools(toolsList);
    splitter.Build(progress());
    if (!splitter.IsDone()) {
      splitter.delete();
      args.delete();
      toolsList.delete();
      throw new Error("split failed");
    }
    const result = splitter.Shape();
    const names = propagateNames(splitter, [body], result, f.id);
    splitter.delete();
    args.delete();
    toolsList.delete();

    const sols = solids(result);
    if (sols.length < 2) {
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

function evalMirror(state: EvalState, f: MirrorFeature): void {
  const frame = resolvePlaneFrame(state, f.plane);
  const k = getKernel();
  kernelCall("mirror", () => {
    const trsf = mirrorTrsfFor(frame);
    for (const bodyId of f.bodies) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      const tr = new k.BRepBuilderAPI_Transform_2(body.shape, trsf, true);
      const mirrored = tr.Shape();
      const mirroredNames = transformNames(tr, body, `m:${f.id}`);
      tr.delete();
      if (f.combine) {
        const op = new k.BRepAlgoAPI_Fuse_3(body.shape, mirrored, progress());
        op.Build(progress());
        if (!op.IsDone()) {
          op.delete();
          throw new Error("mirror join failed");
        }
        const result = op.Shape();
        const names = propagateNames(
          op,
          [body, { shape: mirrored, names: mirroredNames }],
          result,
          f.id,
        );
        op.delete();
        registerBodySolids(state, bodyId, result, names);
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
function evalMove(state: EvalState, f: MoveFeature, earlier: Feature[]): void {
  if (f.bodies.length === 0)
    throw new Error("select at least one body to move");
  const placement = Placement.fromTranslation(f.translation);
  const k = getKernel();
  kernelCall("move", () => {
    for (const bodyId of f.bodies) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      const trsf = placementToTrsf(placement);
      const tr = new k.BRepBuilderAPI_Transform_2(body.shape, trsf, true);
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
    [...movedIds].some(
      (id) => id === `b:${g.id}` || id.startsWith(`b:${g.id}:`),
    );
  for (const [skId, sk] of state.sketches) {
    const feat = earlier.find((g) => g.id === skId && g.type === "sketch") as
      SketchFeature | undefined;
    if (!feat) continue;
    let follows =
      feat.plane.kind === "face" && movedIds.has(feat.plane.face.bodyId);
    if (!follows) {
      for (const g of earlier) {
        const anyG = g as any;
        const consumes =
          [...(anyG.profiles ?? []), ...(anyG.sections ?? [])].some(
            (p: any) => p.sketchId === skId,
          ) || anyG.pathSketchId === skId;
        if (consumes && createdBy(g)) {
          follows = true;
          break;
        }
      }
    }
    if (follows) {
      state.sketches.set(skId, {
        ...sk,
        frame: Placement.applyToFrame(placement, sk.frame),
      });
    }
  }
}

function evalLinearPattern(state: EvalState, f: LinearPatternFeature): void {
  if (f.count < 2) throw new Error("pattern count must be ≥ 2");
  const k = getKernel();
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
      for (let i = 1; i < f.count; i++) {
        const offset = V.scale(V.scale(direction, f.spacing), i);
        const prefix = `p${i}:${f.id}`;
        const trsf = placementToTrsf(Placement.fromTranslation(offset));
        const tr = new k.BRepBuilderAPI_Transform_2(body.shape, trsf, true);
        const instance = tr.Shape();
        const instNames = transformNames(tr, body, prefix);
        tr.delete();
        trsf.delete();
        if (f.combine) {
          const op = new k.BRepAlgoAPI_Fuse_3(
            combined.shape,
            instance,
            progress(),
          );
          op.Build(progress());
          if (!op.IsDone()) {
            op.delete();
            throw new Error("pattern join failed");
          }
          const result = op.Shape();
          const names = propagateNames(
            op,
            [combined, { shape: instance, names: instNames }],
            result,
            f.id,
          );
          op.delete();
          combined = { bodyId, shape: result, names };
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
        registerBodySolids(state, bodyId, combined.shape, combined.names);
      }
    }
  });
}

function evalCircularPattern(
  state: EvalState,
  f: CircularPatternFeature,
): void {
  if (f.count < 2) throw new Error("pattern count must be ≥ 2");
  const axis = resolveAxis(state, f.axis);
  const k = getKernel();
  const total = ((f.totalAngle || 360) * Math.PI) / 180;
  const fullCircle = Math.abs((f.totalAngle || 360) - 360) < ANGULAR_TOL_DEG;
  const step = fullCircle ? total / f.count : total / (f.count - 1);
  kernelCall("circularPattern", () => {
    for (const bodyId of f.bodies) {
      const body = state.bodies.get(bodyId);
      if (!body) throw new Error(`body ${bodyId} not found`);
      let combined: NamedBody = body;
      for (let i = 1; i < f.count; i++) {
        const trsf = placementToTrsf(
          Placement.fromAxisAngle(axis.direction, step * i, axis.origin),
        );
        const tr = new k.BRepBuilderAPI_Transform_2(body.shape, trsf, true);
        const instance = tr.Shape();
        const instNames = transformNames(tr, body, `p${i}:${f.id}`);
        tr.delete();
        trsf.delete();
        if (f.combine) {
          const op = new k.BRepAlgoAPI_Fuse_3(
            combined.shape,
            instance,
            progress(),
          );
          op.Build(progress());
          if (!op.IsDone()) {
            op.delete();
            throw new Error("pattern join failed");
          }
          const result = op.Shape();
          const names = propagateNames(
            op,
            [combined, { shape: instance, names: instNames }],
            result,
            f.id,
          );
          op.delete();
          combined = { bodyId, shape: result, names };
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
        registerBodySolids(state, bodyId, combined.shape, combined.names);
      }
    }
  });
}

function evalConstructionPlane(
  state: EvalState,
  f: ConstructionPlaneFeature,
): void {
  let frame: PlaneFrame;
  if (f.method.kind === "offset") {
    const base = resolvePlaneFrame(state, f.method.base);
    frame = offsetFrame(base, f.method.distance);
  } else {
    const a = resolvePlaneFrame(state, f.method.a);
    const b = resolvePlaneFrame(state, f.method.b);
    // midplane between two (near-)parallel planes
    const midOrigin = V.scale(V.add(a.origin, b.origin), 0.5);
    frame = frameFromPlane(midOrigin, a.normal);
  }
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

function evalEmboss(state: EvalState, f: EmbossFeature): void {
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
  };
  evalExtrude(state, pseudo);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function evaluateFeature(
  state: EvalState,
  feature: Feature,
  earlier: Feature[],
  sources: Sources = new Map(),
): string | void {
  switch (feature.type) {
    case "importStep": {
      const shape = readImport(feature, sources);
      registerBodySolids(
        state,
        `b:${feature.id}`,
        shape,
        finalizeNames(shape, new ShapeMap(), feature.id),
      );
      return;
    }
    case "importMesh": {
      const { shape, warning } = readMesh(feature),
        bodyId = `b:${feature.id}`,
        names = finalizeNames(shape, new ShapeMap(), feature.id);
      if (warning) state.bodies.set(bodyId, { bodyId, shape, names });
      else registerBodySolids(state, bodyId, shape, names);
      return warning;
    }
    case "sketch":
      return evalSketch(state, feature);
    case "extrude":
      return evalExtrude(state, feature);
    case "revolve":
      return evalRevolve(state, feature);
    case "sweep":
      return evalSweep(state, feature);
    case "loft":
      return evalLoft(state, feature);
    case "fillet":
      return evalFillet(state, feature);
    case "chamfer":
      return evalChamfer(state, feature);
    case "combine":
      return evalCombine(state, feature);
    case "shell":
      return evalShell(state, feature);
    case "offsetFace":
      return evalOffsetFace(state, feature);
    case "splitBody":
      return evalSplitBody(state, feature);
    case "mirror":
      return evalMirror(state, feature);
    case "linearPattern":
      return evalLinearPattern(state, feature);
    case "circularPattern":
      return evalCircularPattern(state, feature);
    case "constructionPlane":
      return evalConstructionPlane(state, feature);
    case "referenceImage": {
      // No solid geometry — resolve the frame so the client can render the
      // image quad on the right plane.
      const frame = resolvePlaneFrame(state, feature.plane);
      state.planes.set(feature.id, { frame, size: 0 });
      return;
    }
    case "emboss":
      return evalEmboss(state, feature);
    case "move":
      return evalMove(state, feature, earlier);
    default: {
      const t: never = feature;
      throw new Error(`unknown feature type ${(t as any).type}`);
    }
  }
}
