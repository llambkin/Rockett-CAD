import {
  derivedBodyId,
  moduleBody,
  type CadDocument,
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
  edgeCentroid,
  getKernel,
  planarFacePlane,
  shapeHash,
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

export interface ImportedLabel {
  name?: string;
  color?: string;
  reference?: true;
  approximate?: true;
}

export interface EvalState {
  bodies: Map<string, StateBody>;
  sketches: Map<string, EvaluatedSketch>;
  planes: Map<string, { frame: PlaneFrame; size: number }>;
  imported: Map<string, ImportedLabel>;
  blocked: ReadonlySet<string>;
  hidden?: ReadonlySet<string>;
}

export function bodyLabel(s: EvalState, doc: CadDocument, id: string) {
  const { reference, approximate, ...supplied } = s.imported.get(id) ?? {};
  const meta = doc.bodyMeta[id];
  const { name = id, color } = moduleBody(id)
    ? { ...meta, ...supplied }
    : { ...supplied, ...meta };
  return {
    name,
    ...(color && { color }),
    ...(reference && { reference }),
    ...(approximate && { approximate }),
  };
}

export interface ToolResult {
  shape: Shape;
  names: NameMap;
}

export type FeatureOutcome = Pick<
  FeatureStatus,
  "warning" | "targets" | "importTree"
>;

export class NoCorner extends Error {}

export type StateMap = "bodies" | "sketches" | "planes" | "imported";
export type ReadMap = StateMap | "sources";

export class Recorder {
  on = true;
  earlier = false;
  readonly read = new Map<ReadMap, Set<string> | "all">();
  readonly writes: [StateMap, "set" | "delete", string][] = [];

  reads(map: ReadMap, key?: string): void {
    if (!this.on) return;
    const keys = this.read.get(map) ?? new Set<string>();
    if (keys === "all" || key === undefined) this.read.set(map, "all");
    else this.read.set(map, keys.add(key));
  }

  wrote(map: ReadMap, op: "set" | "delete", key: string): void {
    if (this.on && map !== "sources") this.writes.push([map, op, key]);
  }
}

export const unrecorded = <V>(map: Map<string, V>) =>
  Map.prototype.values.call(map) as MapIterator<V>;

export class RecordedMap<V> extends Map<string, V> {
  constructor(
    readonly recorder: Recorder,
    readonly role: ReadMap,
    from: ReadonlyMap<string, V>,
  ) {
    super();
    for (const [k, v] of Map.prototype.entries.call(from) as MapIterator<
      [string, V]
    >)
      super.set(k, v);
  }
  override get(key: string) {
    this.recorder.reads(this.role, key);
    return super.get(key);
  }
  override has(key: string) {
    this.recorder.reads(this.role, key);
    return super.has(key);
  }
  override set(key: string, value: V) {
    this.recorder.wrote(this.role, "set", key);
    return super.set(key, value);
  }
  override delete(key: string) {
    this.recorder.wrote(this.role, "delete", key);
    return super.delete(key);
  }
  override get size() {
    this.recorder.reads(this.role);
    return super.size;
  }
  override forEach(...args: Parameters<Map<string, V>["forEach"]>) {
    this.recorder.reads(this.role);
    super.forEach(...args);
  }
  override keys() {
    this.recorder.reads(this.role);
    return super.keys();
  }
  override values() {
    this.recorder.reads(this.role);
    return super.values();
  }
  override entries() {
    this.recorder.reads(this.role);
    return super.entries();
  }
  override [Symbol.iterator]() {
    return this.entries();
  }
}

const copy = <V>(map: Map<string, V>) =>
  map instanceof RecordedMap
    ? new RecordedMap<V>(map.recorder, map.role, map)
    : new Map(map);

export function cloneState(state: EvalState): EvalState {
  return {
    bodies: copy(state.bodies),
    sketches: copy(state.sketches),
    planes: copy(state.planes),
    imported: copy(state.imported),
    blocked: state.blocked,
  };
}

export function emptyState(): EvalState {
  return {
    bodies: new Map(),
    sketches: new Map(),
    planes: new Map(),
    imported: new Map(),
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

export function registerPieces<T extends BodyPiece>(
  state: EvalState,
  bodyId: string,
  pieces: T[],
  madeBy?: string,
): Array<[string, T]> {
  const ordered = orderBodyPieces(bodyId, pieces);
  let n = 2;
  const extraId = (i: number) => {
    if (!madeBy) return `${bodyId}:${i + 1}`;
    while (state.bodies.has(derivedBodyId(madeBy, n))) n++;
    return derivedBodyId(madeBy, n);
  };
  return ordered.map((piece, i) => {
    const id = i === 0 ? bodyId : extraId(i);
    state.bodies.set(id, {
      bodyId: id,
      shape: piece.shape,
      names: piece.names,
    });
    return [id, piece];
  });
}

export function rejectInvalid(
  result: Shape,
  before: Shape | undefined,
  kind: string,
  size: string | undefined,
  advice: string,
): void {
  const broken = invalidPart(result);
  if (!broken) return;
  const what = size ? `${kind} of ${size}` : kind;
  const earlier = before && invalidPart(before);
  throw new Error(
    earlier
      ? `${what} cannot be published: the body was already invalid before this ${kind} (the kernel check rejects a ${earlier}), so the fault comes from an earlier feature; the previous body has been kept`
      : `${what} left an invalid shape (the kernel check rejects a ${broken}): ${advice}; the previous body has been kept`,
  );
}

export function rejectInvalidBody(
  kind: string,
  result: Shape,
  before?: Shape,
): void {
  rejectInvalid(
    result,
    before,
    kind,
    undefined,
    "try a different profile, size or target",
  );
}

function slitFace(face: Shape): boolean {
  return scoped((own) => {
    const k = getKernel();
    const location = own(new k.TopLoc_Location_1());
    const surface = own(k.BRep_Tool.Surface_1(face, location));
    const coincide = (a: Shape, b: Shape) =>
      a.IsSame(b)
        ? !k.BRep_Tool.IsClosed_3(a, surface, location)
        : V.norm(V.sub(edgeCentroid(a), edgeCentroid(b))) <=
          k.BRep_Tool.Tolerance_2(a) + k.BRep_Tool.Tolerance_2(b);
    const byEnds = new Map<string, Shape[]>();
    const ex = own(
      new k.TopExp_Explorer_2(
        face,
        k.TopAbs_ShapeEnum.TopAbs_EDGE,
        k.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    for (; ex.More(); ex.Next()) {
      const edge = own(k.TopoDS.Edge_1(own(ex.Current())));
      if (k.BRep_Tool.Degenerated(edge)) continue;
      const ends = [
        own(k.TopExp.FirstVertex(edge, false)),
        own(k.TopExp.LastVertex(edge, false)),
      ]
        .map(shapeHash)
        .toSorted((x, y) => x - y)
        .join(":");
      const twins = byEnds.get(ends) ?? [];
      if (twins.some((twin) => coincide(twin, edge))) return true;
      byEnds.set(ends, [...twins, edge]);
    }
    return false;
  });
}

export function invalidPart(shape: Shape): string | null {
  return scoped(() => {
    if (facesOf(shape).some(slitFace)) return "slit face";
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
    .toSorted((a, b) => a.key - b.key);
  state.bodies.delete(bodyId);
  sorted.forEach((item, i) => {
    const id = i === 0 ? bodyId : derivedBodyId(featureId, i + 1);
    state.bodies.set(id, { bodyId: id, shape: item.s, names });
  });
}
