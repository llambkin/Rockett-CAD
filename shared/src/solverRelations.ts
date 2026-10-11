import { endDerivatives, splineCurve } from "./bspline.js";
import type { Residual } from "./leastSquares.js";
import type { SketchConstraint, SketchEntity } from "./model.js";
import { entityPointIds, type XY } from "./sketchCurves.js";
import {
  SMOOTH_NEEDS,
  splineEnds,
  splineLike,
  splineTangent,
} from "./splineJoints.js";
import { SolverModelError } from "./solverError.js";
import { jointRow, lineOffset, type Ends } from "./solverRows.js";

type Pt = [Residual, Residual];
type At = (id: string) => Pt;
type Of<T extends SketchConstraint["type"]> = Extract<
  SketchConstraint,
  { type: T }
>;

export const SYMMETRIC_NEEDS =
  "symmetric needs two points, two lines or two circles or arcs and a line";

const groupOf = (kind: string | undefined) =>
  kind === "circle" || kind === "arc" ? "round" : kind;

export function symmetricKind(
  kindOf: (id: string) => string | undefined,
  c: { a: string; b: string; line: string },
) {
  const kind = groupOf(kindOf(c.a));
  const like = kind === groupOf(kindOf(c.b));
  const known = kind === "point" || kind === "line" || kind === "round";
  return like && known && kindOf(c.line) === "line" ? kind : undefined;
}

type Shape = {
  px: (id: string) => Residual;
  py: (id: string) => Residual;
  lineEnds: (id: string) => Ends;
  radius: (id: string) => Residual;
  centerOf: (id: string) => { cx: Residual; cy: Residual };
};

type Input = { entities: SketchEntity[]; constraints: SketchConstraint[] };

export function relationRows(
  input: Input,
  c: Of<"symmetric" | "smooth">,
  shape: Shape,
): Residual[] {
  const at: At = (id) => [shape.px(id), shape.py(id)];
  const rows =
    c.type === "smooth"
      ? smoothRows(input, c, at)
      : symmetricRows(input, c, shape, at);
  if (typeof rows === "string") throw new SolverModelError(rows);
  return rows;
}

function symmetricRows(
  input: Input,
  c: Of<"symmetric">,
  shape: Shape,
  at: At,
): Residual[] | string {
  const kinds = new Map(input.entities.map((e) => [e.id, e.kind]));
  const kind = symmetricKind((id) => kinds.get(id), c);
  if (!kind) return SYMMETRIC_NEEDS;
  const ends = (id: string): Pt[] => {
    if (kind === "point") return [at(id)];
    if (kind === "round") {
      const { cx, cy } = shape.centerOf(id);
      return [[cx, cy]];
    }
    const l = shape.lineEnds(id);
    return [
      [l.x1, l.y1],
      [l.x2, l.y2],
    ];
  };
  const axis = shape.lineEnds(c.line);
  const offset = lineOffset(axis);
  const across = (x: Float64Array, [fx, fy]: Pt): XY => {
    const [dx, dy] = [axis.x2(x) - axis.x1(x), axis.y2(x) - axis.y1(x)];
    const [px, py] = [fx(x), fy(x)];
    const k = (2 * offset(x, px, py)) / (Math.hypot(dx, dy) || 1);
    return [px + k * dy, py - k * dx];
  };
  const [a, [b1, b2]] = [ends(c.a), ends(c.b) as [Pt, Pt?]];
  if (b2) {
    const onB = lineOffset({ x1: b1[0], y1: b1[1], x2: b2[0], y2: b2[1] });
    return a.map((p) => (x) => onB(x, ...across(x, p)));
  }
  const rows = [0, 1].map((k) => (x: Float64Array) => {
    return across(x, a[0]!)[k]! - b1[k]!(x);
  });
  if (kind !== "round") return rows;
  const [ra, rb] = [shape.radius(c.a), shape.radius(c.b)];
  return [...rows, (x) => ra(x) - rb(x)];
}

type Bend = { bend: XY; speed: number };

function bendOf(
  e: SketchEntity | undefined,
  [p, q]: [string, string],
  at: At,
): (x: Float64Array) => Bend {
  if (e?.kind === "arc") {
    const [[cx, cy], [jx, jy]] = [at(p), at(q)];
    return (x) => {
      const [vx, vy] = [cx(x) - jx(x), cy(x) - jy(x)];
      const r2 = vx * vx + vy * vy || 1;
      return { bend: [vx / r2, vy / r2], speed: 1 };
    };
  }
  if (!splineLike(e)) return () => ({ bend: [0, 0], speed: 1 });
  const [first] = splineEnds(e);
  const atStart = first?.[0] === p && first[1] === q;
  const ids = entityPointIds(e);
  const coords = ids.map(at);
  return (x) => {
    const points = new Map(
      ids.map((id, i) => {
        const [fx, fy] = coords[i]!;
        return [id, { id, kind: "point" as const, x: fx(x), y: fy(x) }];
      }),
    );
    const [s] = splineCurve(e, points);
    if (!s) return { bend: [0, 0], speed: 1 };
    const [[ux, uy], [vx, vy]] = endDerivatives(s, atStart);
    const speed = ux * ux + uy * uy;
    const along = speed && (ux * vx + uy * vy) / speed;
    return { bend: [vx - along * ux, vy - along * uy], speed };
  };
}

function smoothRows(
  input: Input,
  c: Of<"smooth">,
  at: At,
): Residual[] | string {
  const joint = splineTangent(input.entities, input.constraints, c);
  if (typeof joint !== "object") return joint ?? SMOOTH_NEEDS;
  const { end, other, curves } = joint;
  const find = (id: string) => input.entities.find((e) => e.id === id);
  const point = (id: string) => {
    const e = find(id);
    return e?.kind === "point" ? e : { x: 0, y: 0 };
  };
  const stored: At = (id) => {
    const { x, y } = point(id);
    return [() => x, () => y];
  };
  const sides = (via: At) =>
    [
      bendOf(find(curves[0]), end, via),
      bendOf(find(curves[1]), other, via),
    ] as const;
  const [ka, kb] = sides(at);
  const none = new Float64Array();
  const [a0, b0] = sides(stored).map((f) => f(none).speed || 1);
  const [[x1, y1], [x2, y2]] = [at(end[0]), at(end[1])];
  const [p, q] = [point(end[0]), point(end[1])];
  const reach = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  const scale = (reach || 1) / (a0! * b0!);
  return [
    jointRow(joint, at),
    (x) => {
      const [tx, ty] = [x2(x) - x1(x), y2(x) - y1(x)];
      const [a, b] = [ka(x), kb(x)];
      const normal = (k: XY) =>
        (k[1] * tx - k[0] * ty) / (Math.hypot(tx, ty) || 1);
      return scale * (normal(a.bend) * b.speed - normal(b.bend) * a.speed);
    },
  ];
}
