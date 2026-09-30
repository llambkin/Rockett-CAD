import {
  resolvePlaneFrame,
  vertexPoint,
  registerBodySolids,
  registerPieces,
  type EvaluatedSketch,
  type EvalState,
  type ToolResult,
  type FeatureOutcome,
} from "./featureState.js";
import {
  unifyTool,
  fuseNamed,
  applyToolOperation,
  subtractSketchRegionsFromFace,
} from "./boolean.js";
import { finishJoin, warned } from "./booleanNaming.js";
/**
 * Feature evaluators — each timeline feature type maps to a function that
 * transforms the evaluation state using the OCCT kernel.
 */

import {
  detectProfiles,
  findProfile,
  solveSketch,
  settledEntities,
  projectEdge,
  bodyMadeBy,
  derivedBodyId,
  featureRefs,
  ANGULAR_TOL_DEG,
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type AxisRef,
  type ConstructionPlaneFeature,
  type EmbossFeature,
  type ExtrudeFeature,
  type FaceRef,
  type Feature,
  type ImportMeshFeature,
  type ImportStepFeature,
  type LinearPatternFeature,
  type LoftFeature,
  type MirrorFeature,
  type MoveFeature,
  type ReferenceImageFeature,
  type CircularPatternFeature,
  type PlaneFrame,
  type PointRef,
  type ProfileRef,
  type RevolveFeature,
  type SketchEntity,
  type SketchFeature,
  type SweepFeature,
  type Vec3,
  Placement,
} from "@rockett/shared";
import {
  bboxOf,
  dir,
  edges as edgesOf,
  faces as facesOf,
  getKernel,
  kernelCall,
  listToArray,
  placementToTrsf,
  planarFacePlane,
  pnt,
  progress,
  release,
  scoped,
  shapeHash,
  solids,
  transformOp,
  vec,
  wires as wiresOf,
  type Shape,
} from "./kernel.js";
import {
  computeEdgeNames,
  computeVertexNames,
  finalizeNames,
  findFace,
  namingVersion,
  sweptNames,
  transformNames,
  type NamedBody,
} from "./naming.js";
import { ShapeMap } from "./shapeMap.js";

import { V, frameFromPlane, offsetFrame, uvTo3d } from "./frames.js";
import { geometryNames } from "./signature.js";
import { curveInfo } from "./tessellate.js";
import { readImport, readMesh, type Sources } from "./importers.js";
import { featureKind, type EvalContext } from "./featureKinds.js";
import {
  arcEdge,
  buildProfileFace,
  snapper,
  type ProfileFace,
} from "./sketchGeom.js";

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

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
  const wire = kernelCall("sweep path", () =>
    scoped((own) => {
      if (chain.length === 0)
        throw new Error("path sketch contains no usable curves");
      const wireMaker = own(new k.BRepBuilderAPI_MakeWire_1());
      for (const seg of chain) {
        const edge = sketchEntityToEdge(seg, pathSketch, points);
        if (edge) wireMaker.Add_1(own(edge));
        if (!wireMaker.IsDone())
          throw new Error("sweep path is not a connected chain");
      }
      return wireMaker.Wire();
    }),
  );

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
  if (tools.length > 1)
    return applyProfileTools(
      state,
      f.id,
      tools,
      profileFaces,
      f.operation,
      f.targets,
    );
  try {
    return applyToolOperation(state, f.id, tools[0]!, f.operation, f.targets);
  } finally {
    tools[0]!.shape.delete();
  }
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
    return scoped((own) =>
      own(
        new k.BRepBuilderAPI_MakeEdge_3(own(pnt(...p1)), own(pnt(...p2))),
      ).Edge(),
    );
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

export function evalMirror(state: EvalState, f: MirrorFeature) {
  const frame = resolvePlaneFrame(state, f.plane);
  return kernelCall("mirror", () => {
    const trsf = mirrorTrsfFor(frame);
    const warnings: (string | undefined)[] = [];
    for (const [j, bodyId] of f.bodies.entries()) {
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
        warnings.push(joined.warning);
        registerBodySolids(state, bodyId, joined.shape, joined.names);
      } else {
        const newId = derivedBodyId(f.id, j + 1);
        const finalNames = finalizeNames(mirrored, mirroredNames, f.id);
        registerBodySolids(state, newId, mirrored, finalNames);
      }
    }
    trsf.delete();
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
  if (!kind) throw new Error(`unknown feature type ${feature.type}`);
  return kind.evaluate(
    { state, earlier, index: earlier.length, sources },
    feature,
  );
}

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
