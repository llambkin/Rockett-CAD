import {
  resolvePlaneFrame,
  vertexPoint,
  registerBodySolids,
  registerPieces,
  rejectInvalidBody,
  type EvaluatedSketch,
  type EvalState,
  type ToolResult,
  type FeatureOutcome,
} from "./featureState.js";
import {
  unifyTool,
  fuseNamed,
  applyToolOperation,
  operationKind,
  subtractSketchRegionsFromFace,
  type ToolFeature,
} from "./boolean.js";
import { finishJoin, warned } from "./booleanNaming.js";
import { boundsOf } from "./meshBody.js";
/**
 * Feature evaluators — each timeline feature type maps to a function that
 * transforms the evaluation state using the OCCT kernel.
 */

import {
  detectProfiles,
  regionWarning,
  unsupported,
  findProfile,
  solveSketch,
  settledEntities,
  derivedBodyId,
  ANGULAR_TOL_DEG,
  LINEAR_TOL,
  UNIT_DOT_TOL,
  ORIGIN_AXES,
  type AxisRef,
  type ConstructionPlaneFeature,
  type FaceRef,
  type ImportStepFeature,
  type LinearPatternFeature,
  type MirrorFeature,
  type OriginAxis,
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
  acquire,
  diagonal,
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
  scoped,
  solids,
  transformOp,
  vec,
  type Shape,
} from "./kernel.js";
import {
  capName,
  computeEdgeNames,
  computeVertexNames,
  finalizeNames,
  findFace,
  mirrorPrefix,
  namingVersion,
  patternPrefix,
  sideName,
  sweptNames,
  transformNames,
  type NamedBody,
} from "./naming.js";
import { transformCopy } from "./mesh.js";
import { ShapeMap } from "./shapeMap.js";

import { V, frameFromPlane, offsetFrame, uvTo3d } from "./frames.js";
import { sourceNames } from "./signature.js";
import { refreshProjections } from "./projectSource.js";
import { readImport } from "./importers.js";
import { placeImport } from "./stepImport.js";
import { type EvalContext } from "./featureKinds.js";
import {
  buildProfileFace,
  snapper,
  sideEdgeNames,
  type ProfileFace,
} from "./sketchGeom.js";
import { arcEdge, lineEdge } from "./sketchEdges.js";

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

const originAxisDirection = (axis: OriginAxis): Vec3 => {
  const i = ORIGIN_AXES.indexOf(axis);
  return [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0];
};

export function resolveAxis(
  state: EvalState,
  ref: AxisRef,
): { origin: Vec3; direction: Vec3 } {
  if (ref.kind === "originAxis") {
    return { origin: [0, 0, 0], direction: originAxisDirection(ref.axis) };
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
  const curve = acquire(new k.BRepAdaptor_Curve_2(edge));
  if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Line) {
    throw new Error(`edge ${ref.edge.edgeName} is not linear`);
  }
  const pA = acquire(curve.Value(curve.FirstParameter()));
  const pB = acquire(curve.Value(curve.LastParameter()));
  const origin: Vec3 = [pA.X(), pA.Y(), pA.Z()];
  const target: Vec3 = [pB.X(), pB.Y(), pB.Z()];
  return { origin, direction: V.normalize(V.sub(target, origin)) };
}

export function resolveProfiles(
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
  f: ToolFeature,
  tools: ToolResult[],
  regions: ProfileFace[],
): void {
  const featureId = f.id;
  const unified = tools.map((t) => unifyTool(t, featureId));
  for (const u of unified) rejectInvalidBody(operationKind(f), u.shape);

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
}

export function evalSketch(
  state: EvalState,
  f: SketchFeature,
): FeatureOutcome | void {
  const frame = resolvePlaneFrame(state, f.plane);
  const { entities, constraints, moved, lost } = refreshProjections(
    state,
    f,
    frame,
  );
  const solved = solveSketch({ entities, constraints });
  const placed = moved ? settledEntities(solved, entities) : entities;
  state.sketches.set(f.id, {
    featureId: f.id,
    frame,
    entities: placed,
    solveStatus: solved.status,
    dof: solved.dof,
    profiles: detectProfiles(placed),
  });
  const warning = [lost, regionWarning(placed)].filter(Boolean).join(" ");
  if (warning) return { warning };
}

/** Build prism tool(s) for extrude-like features. */
export function buildPrism(
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
      const trsf = acquire(new k.gp_Trsf_1());
      trsf.SetTranslation_1(
        vec(
          direction[0] * baseOffset,
          direction[1] * baseOffset,
          direction[2] * baseOffset,
        ),
      );
      const tr = transformOp(face, trsf);
      const moved = acquire(tr.Shape());
      // remap edge->entity through the transform
      const newMap = new ShapeMap<string>();
      for (const e of edgesOf(face)) {
        const id = profileFace.edgeEntity.get(e);
        if (!id) continue;
        try {
          const me = acquire(tr.ModifiedShape(e));
          newMap.set(me, id);
        } catch {
          // ignore
        }
      }
      offsetEdgeEntity = newMap;
      face = acquire(k.TopoDS.Face_1(moved));
    }
    const v = vec(
      direction[0] * distance,
      direction[1] * distance,
      direction[2] * distance,
    );
    const prism = acquire(
      new k.BRepPrimAPI_MakePrism_1(face, v, copyBase, true),
    );
    prism.Build(progress());
    if (!prism.IsDone()) {
      throw new Error("prism generation failed: is the profile closed?");
    }
    const shape = acquire(prism.Shape());

    const provisional = new ShapeMap<string>();
    const faceEdges = edgesOf(face);
    for (const e of faceEdges) {
      const entityId = offsetEdgeEntity.get(e);
      if (!entityId) continue;
      const gen = listToArray(prism.Generated(e));
      for (const g of gen) {
        if (g.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_FACE) {
          provisional.set(g, sideName(featureId, entityId));
        }
      }
    }

    for (const cap of facesOf(acquire(prism.FirstShape_1())))
      provisional.set(cap, capName(featureId, "start"));
    for (const cap of facesOf(acquire(prism.LastShape_1())))
      provisional.set(cap, capName(featureId, "end"));

    const names = finalizeNames(shape, provisional, featureId);
    return { shape, names };
  });
}

export function faceProfile(
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

export function applyProfileTools(
  state: EvalState,
  f: ToolFeature,
  tools: ToolResult[],
  regions: ProfileFace[],
): FeatureOutcome | void {
  const featureId = f.id;
  if (f.operation === "newBody") {
    registerNewBodies(state, f, tools, regions);
    return;
  }

  const tool = tools.slice(1).reduce((acc, next) => {
    const fused = fuseNamed(
      acc,
      next,
      featureId,
      "failed to merge profile solids",
    );

    return fused;
  }, tools[0]!);
  const unified = unifyTool(tool, featureId);

  return applyToolOperation(state, f, unified);
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
    throw new Error(REVOLVE_CROSSES_AXIS);
  }
  const k = getKernel();
  const angleRad = (Math.min(Math.abs(f.angle), 360) * Math.PI) / 180;
  const full = Math.abs(f.angle) >= 360 - ANGULAR_TOL_DEG;
  const sign = f.angle >= 0 ? 1 : -1;

  const tools: ToolResult[] = [];
  for (const { pf, copy } of sources) {
    const tool = kernelCall("revolve", () => {
      const ax1 = acquire(
        new k.gp_Ax1_2(
          pnt(...axis.origin),
          dir(
            sign * axis.direction[0],
            sign * axis.direction[1],
            sign * axis.direction[2],
          ),
        ),
      );
      const revol = full
        ? acquire(new k.BRepPrimAPI_MakeRevol_2(pf.face, ax1, copy))
        : acquire(new k.BRepPrimAPI_MakeRevol_1(pf.face, ax1, angleRad, copy));
      revol.Build(progress());
      if (!revol.IsDone()) {
        throw new Error("the kernel could not revolve the profile");
      }
      const shape = acquire(revol.Shape());
      const names = sweptNames(
        shape,
        f.id,
        sideEdgeNames(f.id, pf),
        (e) => revol.Generated(e),
        full
          ? []
          : [acquire(revol.FirstShape_1()), acquire(revol.LastShape_1())],
      );
      return { shape, names };
    });
    tools.push(tool);
  }

  return applyProfileTools(state, f, tools, profileFaces);
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
  const wire = acquire(
    kernelCall("sweep path", () =>
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
        return own.keep(own(wireMaker.Wire()));
      }),
    ),
  );

  const tools = profileFaces.map((pf) =>
    kernelCall("sweep", (): ToolResult => {
      const pipe = acquire(new k.BRepOffsetAPI_MakePipe_1(wire, pf.face));
      pipe.Build(progress());
      if (!pipe.IsDone()) {
        throw new Error(
          "sweep failed: check that the profile lies on the path start",
        );
      }
      const shape = acquire(pipe.Shape());
      const names =
        namingVersion() === 1
          ? finalizeNames(shape, new ShapeMap(), f.id)
          : sweptNames(
              shape,
              f.id,
              sideEdgeNames(f.id, pf),
              (e) => pipe.Generated_1(e),
              [acquire(pipe.FirstShape()), acquire(pipe.LastShape())],
            );
      return { shape, names };
    }),
  );

  if (tools.length > 1) return applyProfileTools(state, f, tools, profileFaces);

  return applyToolOperation(state, f, tools[0]!);
}

function orderOpenChain(
  entities: SketchEntity[],
  points: Map<string, { x: number; y: number }>,
): SketchEntity[] {
  const snap = snapper();
  const ends = new Map<SketchEntity, [number, number][]>();
  const at = new Map<[number, number], SketchEntity[]>();
  for (const e of entities) {
    if (unsupported(e) && !e.construction)
      throw new Error(`A sweep path cannot use the ${e.kind} ${e.id} yet.`);
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
  if (e.kind === "line") {
    const a = points.get(e.p1)!;
    const b = points.get(e.p2)!;
    return lineEdge(sketch.frame, [a.x, a.y], [b.x, b.y]);
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
      const tr = transformCopy(body.shape, trsf);
      const mirrored = acquire(tr.Shape());
      const mirroredNames = transformNames(tr, body, mirrorPrefix(f.id));
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

const patternCopyId = (id: string, sources: number, i: number, j: number) =>
  derivedBodyId(id, (i - 1) * sources + j + 1);

export function evalLinearPattern(state: EvalState, f: LinearPatternFeature) {
  if (f.count < 2) throw new Error("pattern count must be ≥ 2");
  let direction: Vec3;
  if (f.direction.kind === "axis") {
    direction = originAxisDirection(f.direction.axis);
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
        const prefix = patternPrefix(i, f.id);
        const trsf = placementToTrsf(Placement.fromTranslation(offset));
        const tr = transformCopy(body.shape, trsf);
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
        const tr = transformCopy(body.shape, trsf);
        const instance = acquire(tr.Shape());
        const instNames = transformNames(tr, body, patternPrefix(i, f.id));
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
    size = Math.max(size, diagonal(boundsOf(body)) * 0.75);
  }
  state.planes.set(f.id, { frame, size });
}

export function evalImportStep(
  { state, sources }: EvalContext,
  f: ImportStepFeature,
): FeatureOutcome | void {
  const read = readImport(f, sources);
  return placeImport(state, `b:${f.id}`, read, sourceNames(read.shape, f.id));
}

export function evalReferenceImage(
  state: EvalState,
  f: ReferenceImageFeature,
): void {
  const frame = resolvePlaneFrame(state, f.plane);
  state.planes.set(f.id, { frame, size: 0 });
}

export { evaluateFeature } from "./featureKinds.js";
export { evalImportMesh } from "./meshBody.js";

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
