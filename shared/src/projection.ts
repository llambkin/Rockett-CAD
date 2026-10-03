import type { EdgeRef, SketchEntity } from "./model.js";
import type { EdgeInfo, PlaneFrame, Vec3 } from "./api.js";
import { TAU, type XY } from "./sketchCurves.js";

type Conic = Extract<EdgeInfo["curve"], { type: "circle" | "ellipse" }>;

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
  projection: EdgeRef;
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

/** Exact orthogonal projection of supported analytic edges, with stable child IDs. */
export function projectEdge(
  curve: EdgeInfo["curve"],
  frame: PlaneFrame,
  id: string,
  projection: EdgeRef,
  construction = true,
): SketchEntity[] {
  const [uv, point] = [planeUv(frame), pointEntity(id)];
  const common = { id, projection, external: true as const, construction };
  if (curve.type === "line") {
    const a = uv(curve.a),
      b = uv(curve.b);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7)
      throw new Error(
        "This edge projects to a point. Choose an edge visible in the sketch plane.",
      );
    return [
      point("a", a),
      point("b", b),
      { ...common, kind: "line", p1: `${id}:a`, p2: `${id}:b` },
    ];
  }
  if (curve.type === "other")
    throw new Error(
      "Project supports straight edges, circles, ellipses and their arcs.",
    );
  return projectConic(curve, frame, common);
}

function projectConic(
  curve: Conic,
  frame: PlaneFrame,
  common: Common,
): SketchEntity[] {
  const { id } = common;
  const [uv, point] = [planeUv(frame), pointEntity(id)];
  const full = curve.sweep === undefined || curve.sweep > TAU - 1e-6;
  const ends = (forward: boolean): [XY, XY] => {
    if (!curve.start || !curve.end) throw new Error("Missing arc endpoints.");
    const [s, e] = [uv(curve.start), uv(curve.end)];
    return forward ? [s, e] : [e, s];
  };
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
  const [u, v] = semiAxes(curve).map((w) => [
    dot(w, frame.xAxis),
    dot(w, frame.yAxis),
  ]) as [XY, XY];
  const turn = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(turn) < 1e-9 * (dot(u, u) + dot(v, v)))
    throw new Error(
      "This edge is seen edge-on and projects to a line. Choose an edge visible in the sketch plane.",
    );
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
