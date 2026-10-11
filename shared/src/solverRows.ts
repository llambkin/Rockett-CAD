import type { Residual } from "./leastSquares.js";
import type { SketchEntity } from "./model.js";
import { entityPointIds } from "./sketchCurves.js";
import type { SplineJoint } from "./splineJoints.js";

const STAY_WEIGHT = 1e-2;

export function stayRows(
  input: { entities: SketchEntity[]; drag?: { pointId: string } },
  varsOf: (id: string) => number[],
  x0: number[],
) {
  const drag = input.drag?.pointId;
  return input.entities.flatMap((e) => {
    const ids = e.kind === "ellipse" ? entityPointIds(e) : [];
    if (drag && ids.includes(drag)) return [];
    return ids.flatMap(varsOf).map((v) => ({
      v,
      r: (x: Float64Array) => STAY_WEIGHT * (x[v]! - x0[v]!),
    }));
  });
}

export type Ends = { x1: Residual; y1: Residual; x2: Residual; y2: Residual };

export function turn(a: Ends, b: Ends, x: Float64Array) {
  const [ax, ay] = [a.x2(x) - a.x1(x), a.y2(x) - a.y1(x)];
  const [bx, by] = [b.x2(x) - b.x1(x), b.y2(x) - b.y1(x)];
  const scale = (Math.hypot(ax, ay) || 1) * (Math.hypot(bx, by) || 1);
  return { dot: ax * bx + ay * by, cross: ax * by - ay * bx, scale };
}

export function lineOffset(l: Ends) {
  return (x: Float64Array, ptx: number, pty: number) => {
    const dx = l.x2(x) - l.x1(x),
      dy = l.y2(x) - l.y1(x);
    const len = Math.hypot(dx, dy) || 1;
    return (dx * (pty - l.y1(x)) - dy * (ptx - l.x1(x))) / len;
  };
}

export function jointRow(
  { end, other, radial }: SplineJoint,
  at: (id: string) => [Residual, Residual],
): Residual {
  const ends = ([p, q]: [string, string]): Ends => {
    const [[x1, y1], [x2, y2]] = [at(p), at(q)];
    return { x1, y1, x2, y2 };
  };
  const [a, b] = [ends(end), ends(other)];
  return (x) => {
    const t = turn(a, b, x);
    return (radial ? t.dot : t.cross) / t.scale;
  };
}
