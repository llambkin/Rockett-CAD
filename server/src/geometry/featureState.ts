import {
  derivedBodyId,
  type FeatureStatus,
  type PlaneFrame,
  type PlaneRef,
  type Profile,
  type SketchEntity,
  type SketchSolveStatus,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  scoped,
  bboxOf,
  getKernel,
  planarFacePlane,
  solids,
  faces as facesOf,
  edges as edgesOf,
  vertices as verticesOf,
  type Shape,
} from "./kernel.js";
import {
  orderBodyPieces,
  findFace,
  type BodyPiece,
  type NameMap,
  type NamedBody,
} from "./naming.js";
import { ORIGIN_FRAMES, V, frameFromPlane } from "./frames.js";

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

export interface ToolResult {
  shape: Shape;
  names: NameMap;
}

export type FeatureOutcome = Pick<FeatureStatus, "warning" | "targets">;

export class NoCorner extends Error {}

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

export function resolvePlaneFrame(state: EvalState, ref: PlaneRef): PlaneFrame {
  if (ref.kind === "origin") {
    return ORIGIN_FRAMES[ref.plane];
  }
  if (ref.kind === "construction") {
    const p = state.planes.get(ref.featureId);
    if (!p) throw new Error(`construction plane ${ref.featureId} not found`);
    return p.frame;
  }
  return scoped(() => {
    const body = state.bodies.get(ref.face.bodyId);
    if (!body) throw new Error(`body ${ref.face.bodyId} no longer exists`);
    const face = findFace(body, ref.face.faceName);
    if (!face) {
      throw new Error(
        `face ${ref.face.faceName} no longer exists on ${ref.face.bodyId}`,
      );
    }
    const plane = planarFacePlane(face);
    if (!plane) throw new Error(`face ${ref.face.faceName} is not planar`);
    return frameFromPlane(plane.origin, plane.normal);
  });
}

export function vertexPoint(vertex: Shape): Vec3 {
  return scoped(() => {
    const p = acquire(getKernel().BRep_Tool.Pnt(vertex));
    const out: Vec3 = [p.X(), p.Y(), p.Z()];
    return out;
  });
}

export function registerBodySolids(
  state: EvalState,
  bodyId: string,
  shape: Shape,
  names: NameMap,
  madeBy?: string,
): void {
  registerSolids(state, bodyId, solids(shape), names, madeBy);
}

export function registerSolids(
  state: EvalState,
  bodyId: string,
  sols: Shape[],
  names: NameMap,
  madeBy?: string,
): void {
  if (sols.length === 0) state.bodies.delete(bodyId);
  else
    registerPieces(
      state,
      bodyId,
      sols.map((shape) => ({ shape, names })),
      names.version === 2 ? madeBy : undefined,
    );
}

export function registerPieces(
  state: EvalState,
  bodyId: string,
  pieces: BodyPiece[],
  madeBy?: string,
): void {
  const ordered = orderBodyPieces(bodyId, pieces);
  let n = 2;
  const extraId = (i: number) => {
    if (!madeBy) return `${bodyId}:${i + 1}`;
    while (state.bodies.has(derivedBodyId(madeBy, n))) n++;
    return derivedBodyId(madeBy, n);
  };
  ordered.forEach(({ shape, names }, i) => {
    const id = i === 0 ? bodyId : extraId(i);
    state.bodies.set(id, { bodyId: id, shape, names });
  });
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

export function invalidPart(shape: Shape): string | null {
  return scoped(() => {
    const check = acquire(
      new (getKernel().BRepCheck_Analyzer)(shape, true, false, false),
    );
    if (check.IsValid_2()) return null;
    for (const [part, of] of [
      ["face", facesOf],
      ["edge", edgesOf],
      ["vertex", verticesOf],
    ] as const) {
      const shapes = of(shape);

      if (shapes.some((s) => !check.IsValid_1(s))) return part;
    }
    return "solid";
  });
}

export function registerSplitBodies(
  state: EvalState,
  bodyId: string,
  featureId: string,
  sols: Shape[],
  names: NameMap,
  normal: Vec3,
): void {
  const sorted = sols
    .map((s) => {
      const bb = bboxOf(s);
      const c: Vec3 = [
        (bb.min[0] + bb.max[0]) / 2,
        (bb.min[1] + bb.max[1]) / 2,
        (bb.min[2] + bb.max[2]) / 2,
      ];
      return { s, key: V.dot(c, normal) };
    })
    .sort((a, b) => a.key - b.key);
  state.bodies.delete(bodyId);
  sorted.forEach((item, i) => {
    const id = i === 0 ? bodyId : derivedBodyId(featureId, i + 1);
    state.bodies.set(id, { bodyId: id, shape: item.s, names });
  });
}
