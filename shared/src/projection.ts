import type {
  BodyRef,
  FaceRef,
  ProjectionRef,
  SectionRef,
  SketchEntity,
} from "./model.js";
import type { EdgeInfo, ExactCurve, PlaneFrame, Vec3 } from "./api.js";
import { sketchBuilder, type SketchBuilder } from "./sketchBuilder.js";
import { sketchCurves, TAU, type Curve, type XY } from "./sketchCurves.js";
import { LINEAR_TOL } from "./tolerance.js";

type Conic = Extract<EdgeInfo["curve"], { type: "circle" | "ellipse" }>;
type Copyable = Exclude<ExactCurve, { type: "other" }>;
type SpaceSpline = Extract<ExactCurve, { type: "bspline" }>;

const TO_POINT =
  "This edge projects to a point. Choose an edge visible in the sketch plane.";
const EDGE_ON =
  "This edge is seen edge-on and projects to a line. Choose an edge visible in the sketch plane.";

export const seenEdgeOn = (error: unknown) =>
  error instanceof Error && [TO_POINT, EDGE_ON].includes(error.message);

export type GroupRef = FaceRef | BodyRef | SectionRef;

export const isGroupRef = (ref: ProjectionRef): ref is GroupRef =>
  ref.kind === "face" || ref.kind === "body" || ref.kind === "section";

export const groupRoot = (memberId: string) => memberId.split(":")[0]!;

export function withGroups(
  entities: readonly SketchEntity[],
  ids: readonly string[],
): Set<string> {
  const picked = new Set(ids);
  const grouped = (e: SketchEntity) =>
    e.kind !== "point" && !!e.projection && isGroupRef(e.projection);
  const roots = new Set(
    entities
      .filter((e) => picked.has(e.id) && grouped(e))
      .map((e) => groupRoot(e.id)),
  );
  for (const e of entities)
    if (grouped(e) && roots.has(groupRoot(e.id))) picked.add(e.id);
  return picked;
}

export function sourceKey(ref: ProjectionRef): string {
  if (ref.kind === "edge") return `edge/${ref.bodyId}/${ref.edgeName}`;
  if (ref.kind === "face") return `face/${ref.bodyId}/${ref.faceName}`;
  if (ref.kind === "body") return `body/${ref.bodyId}`;
  if (ref.kind === "section") return `section/${sourceKey(ref.of)}`;
  return `sketch/${ref.sketchId}/${ref.entityId}`;
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((v, x, i) => v + x * b[i]!, 0);

const crossed = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function semiAxes(curve: Conic): [Vec3, Vec3] {
  if (curve.type === "ellipse") {
    const minor = crossed(curve.axis, curve.majorAxis);
    return [
      curve.majorAxis.map((v) => v * curve.majorRadius) as Vec3,
      minor.map((v) => v * curve.minorRadius) as Vec3,
    ];
  }
  const toStart = curve.start?.map((v, i) => v - curve.center[i]!) as Vec3;
  const seed: Vec3 =
    toStart && Math.hypot(...toStart) > 0
      ? toStart
      : crossed(
          curve.axis,
          Math.abs(curve.axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0],
        );
  const x = seed.map((v) => v / Math.hypot(...seed)) as Vec3;
  return [
    x.map((v) => v * curve.radius) as Vec3,
    crossed(curve.axis, x).map((v) => v * curve.radius) as Vec3,
  ];
}

interface Common {
  id: string;
  projection: ProjectionRef;
  external: true;
  construction: boolean;
}

const planeUv =
  (frame: PlaneFrame) =>
  (p: Vec3): XY => {
    const d = p.map((v, i) => v - frame.origin[i]!);
    return [dot(d, frame.xAxis), dot(d, frame.yAxis)];
  };

const pointEntity =
  (id: string) =>
  (suffix: string, [x, y]: XY): SketchEntity => ({
    id: `${id}:${suffix}`,
    kind: "point",
    x,
    y,
    external: true,
    construction: true,
  });

const whole = (curve: Conic) =>
  curve.sweep === undefined || curve.sweep > TAU - 1e-6;

function arcEnds(curve: Conic, uv: (p: Vec3) => XY, forward: boolean) {
  if (!curve.start || !curve.end) throw new Error("Missing arc endpoints.");
  const [s, e] = [uv(curve.start), uv(curve.end)];
  return (forward ? [s, e] : [e, s]) as [XY, XY];
}

const inPlane = (frame: PlaneFrame) => (w: Vec3) =>
  [dot(w, frame.xAxis), dot(w, frame.yAxis)] as XY;

/** Exact orthogonal projection of supported analytic and B-spline edges, with stable child IDs. */
export function projectEdge(
  curve: ExactCurve,
  frame: PlaneFrame,
  id: string,
  projection: ProjectionRef,
  construction = true,
): SketchEntity[] {
  const [uv, point] = [planeUv(frame), pointEntity(id)];
  const common = { id, projection, external: true as const, construction };
  if (curve.type === "line") {
    const a = uv(curve.a),
      b = uv(curve.b);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) throw new Error(TO_POINT);
    return [
      point("a", a),
      point("b", b),
      { ...common, kind: "line", p1: `${id}:a`, p2: `${id}:b` },
    ];
  }
  if (curve.type === "other")
    throw new Error(
      "Project supports straight edges, circles, ellipses, their arcs and B-splines.",
    );
  if (curve.type === "bspline") return projectSpline(curve, frame, common);
  return projectConic(curve, frame, common);
}

const sweep = (from: number, to: number) =>
  (((to - from) % TAU) + TAU) % TAU || TAU;

function spaceCurve(c: Curve, frame: PlaneFrame): ExactCurve {
  const at = ([x, y]: XY) =>
    frame.origin.map(
      (o, i) => o + x * frame.xAxis[i]! + y * frame.yAxis[i]!,
    ) as Vec3;
  const axis = frame.normal;
  if (c.kind === "line")
    return { type: "line", a: at([c.x1, c.y1]), b: at([c.x2, c.y2]) };
  if (c.kind === "spline") {
    const { degree, poles, weights, knots, multiplicities, periodic } = c;
    return {
      type: "bspline",
      degree,
      poles: poles.map(at),
      ...(weights && { weights }),
      knots,
      multiplicities,
      ...(periodic && { periodic }),
    };
  }
  const center = at([c.cx, c.cy]);
  if (c.kind === "circle") return { type: "circle", center, axis, radius: c.r };
  if (c.kind === "arc")
    return {
      type: "circle",
      center,
      axis,
      radius: c.r,
      start: at(c.s),
      end: at(c.e),
      sweep: sweep(c.a0, c.a1),
    };
  const ellipse = {
    type: "ellipse" as const,
    center,
    axis,
    majorAxis: frame.xAxis.map(
      (v, i) => c.ux * v + c.uy * frame.yAxis[i]!,
    ) as Vec3,
    majorRadius: c.a,
    minorRadius: c.b,
  };
  const { span } = c;
  if (!span) return ellipse;
  const ends = { start: at(span.s), end: at(span.e) };
  return { ...ellipse, ...ends, sweep: sweep(span.t0, span.t1) };
}

export function sketchSpaceCurve(
  sketch: { frame: PlaneFrame; entities: readonly SketchEntity[] },
  entityId: string,
): ExactCurve | undefined {
  const curve = sketchCurves(sketch.entities, true).find(
    (c) => c.id === entityId,
  );
  return curve && spaceCurve(curve, sketch.frame);
}

function spread(points: readonly number[][]): [number, number] {
  const rel = points.map((p) => p.map((v, i) => v - points[0]![i]!));
  const far = rel.reduce((a, b) => (dot(b, b) > dot(a, a) ? b : a));
  const reach = Math.sqrt(dot(far, far));
  if (reach < LINEAR_TOL) return [reach, 0];
  const off = (r: number[]) => dot(r, r) - (dot(r, far) / reach) ** 2;
  return [reach, Math.sqrt(Math.max(0, ...rel.map(off)))];
}

function projectSpline(
  curve: SpaceSpline,
  frame: PlaneFrame,
  common: Common,
): SketchEntity[] {
  const { id } = common;
  const [uv, point] = [planeUv(frame), pointEntity(id)];
  const flat = curve.poles.map(uv);
  const [reach, off] = spread(flat);
  if (reach < LINEAR_TOL) throw new Error(TO_POINT);
  if (off < LINEAR_TOL && spread(curve.poles)[1] >= LINEAR_TOL)
    throw new Error(EDGE_ON);
  const { degree, weights, knots, multiplicities, periodic } = curve;
  return [
    ...flat.map((p, i) => point(`p${i}`, p)),
    {
      ...common,
      kind: "spline",
      degree,
      poles: flat.map((_, i) => `${id}:p${i}`),
      ...(weights && { weights }),
      knots,
      multiplicities,
      ...(periodic && { periodic }),
    },
  ];
}

function projectConic(
  curve: Conic,
  frame: PlaneFrame,
  common: Common,
): SketchEntity[] {
  const { id } = common;
  const [uv, point] = [planeUv(frame), pointEntity(id)];
  const full = whole(curve);
  const ends = (forward: boolean) => arcEnds(curve, uv, forward);
  const c = uv(curve.center);
  const normal = dot(curve.axis, frame.normal);
  if (curve.type === "circle" && Math.abs(normal) >= 1 - 1e-6) {
    if (full)
      return [
        point("c", c),
        { ...common, kind: "circle", center: `${id}:c`, radius: curve.radius },
      ];
    const [a, b] = ends(normal > 0);
    return [
      point("c", c),
      point("a", a),
      point("b", b),
      {
        ...common,
        kind: "arc",
        center: `${id}:c`,
        start: `${id}:a`,
        end: `${id}:b`,
      },
    ];
  }
  const [u, v] = semiAxes(curve).map(inPlane(frame)) as [XY, XY];
  const turn = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(turn) < 1e-9 * (dot(u, u) + dot(v, v))) throw new Error(EDGE_ON);
  const t = Math.atan2(2 * dot(u, v), dot(u, u) - dot(v, v)) / 2;
  const at = (k: number): XY => [
    c[0] + u[0] * Math.cos(t + k) + v[0] * Math.sin(t + k),
    c[1] + u[1] * Math.cos(t + k) + v[1] * Math.sin(t + k),
  ];
  const axes = [point("c", c), point("m", at(0)), point("n", at(Math.PI / 2))];
  const ellipse = {
    ...common,
    kind: "ellipse" as const,
    center: `${id}:c`,
    major: `${id}:m`,
    minor: `${id}:n`,
  };
  if (full) return [...axes, ellipse];
  const [a, b] = ends(turn > 0);
  return [
    ...axes,
    point("a", a),
    point("b", b),
    { ...ellipse, start: `${id}:a`, end: `${id}:b` },
  ];
}

function copyCurve(b: SketchBuilder, curve: Copyable, frame: PlaneFrame) {
  const uv = planeUv(frame);
  if (curve.type === "line") return b.line(uv(curve.a), uv(curve.b));
  if (curve.type === "bspline")
    return b.spline({ ...curve, poles: curve.poles.map(uv) });
  const ends = whole(curve)
    ? undefined
    : arcEnds(curve, uv, dot(curve.axis, frame.normal) > 0);
  const c = uv(curve.center);
  if (curve.type === "circle")
    return ends ? b.arc(c, ...ends) : b.circle(c, curve.radius);
  const [major] = semiAxes(curve).map(inPlane(frame));
  const ratio = curve.minorRadius / curve.majorRadius;
  return b.ellipse(c, major!, ratio, false, ends);
}

export function copyEdges(
  curves: Copyable[],
  frame: PlaneFrame,
): SketchEntity[] | undefined {
  const b = sketchBuilder();
  return curves.every((c) => copyCurve(b, c, frame)) ? b.entities : undefined;
}
