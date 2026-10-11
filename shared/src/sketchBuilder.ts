import type { BSpline } from "./bspline.js";
import {
  newId,
  type SketchEntity,
  type SketchPoint,
  type SketchSpline,
} from "./model.js";
import { LINEAR_TOL } from "./tolerance.js";

export interface SketchImport {
  entities: SketchEntity[];
  skipped: number;
}

export type XY = [number, number];

export type SketchBuilder = ReturnType<typeof sketchBuilder>;

const cell = (v: number) => Math.floor(v / LINEAR_TOL);
const flag = (construction: boolean) => (construction ? { construction } : {});
const finite = (...values: number[]) => values.every(Number.isFinite);

const scaledPoint = (
  [x, y]: XY,
  scale: number,
  construction: boolean,
): SketchPoint => ({
  id: newId("pt"),
  kind: "point",
  x: x * scale,
  y: y * scale,
  ...flag(construction),
});

function nearby(grid: Map<string, SketchPoint[]>, x: number, y: number) {
  const [gx, gy] = [cell(x), cell(y)];
  for (let i = gx - 1; i <= gx + 1; i++)
    for (let j = gy - 1; j <= gy + 1; j++)
      for (const p of grid.get(`${i},${j}`) ?? [])
        if (Math.hypot(p.x - x, p.y - y) <= LINEAR_TOL) return p;
  return undefined;
}

function pointPool(entities: SketchEntity[], scale: number) {
  const grid = new Map<string, SketchPoint[]>();
  const apart = (a: XY, b: XY) =>
    Math.hypot(b[0] - a[0], b[1] - a[1]) * scale > LINEAR_TOL;
  const point = (at: XY, construction: boolean): SketchPoint => {
    const p = scaledPoint(at, scale, construction);
    entities.push(p);
    return p;
  };
  const endpoint = (at: XY, construction: boolean): string => {
    const [x, y] = [at[0] * scale, at[1] * scale];
    const near = nearby(grid, x, y);
    if (near) {
      if (!construction) delete near.construction;
      return near.id;
    }
    const p = point(at, construction);
    const key = `${cell(x)},${cell(y)}`;
    grid.set(key, [...(grid.get(key) ?? []), p]);
    return p.id;
  };
  return { apart, point, endpoint };
}

function splineOn(
  { point, endpoint }: ReturnType<typeof pointPool>,
  s: BSpline,
  construction: boolean,
): SketchSpline {
  const { degree, weights, knots, multiplicities, periodic } = s;
  const last = s.poles.length - 1;
  return {
    id: newId("sp"),
    kind: "spline",
    degree,
    poles: s.poles.map((p, i) =>
      !periodic && (i === 0 || i === last)
        ? endpoint(p, construction)
        : point(p, construction).id,
    ),
    ...(weights && { weights }),
    knots,
    multiplicities,
    ...(periodic && { periodic }),
    ...flag(construction),
  };
}

export function sketchBuilder(scale = 1) {
  const entities: SketchEntity[] = [];
  const pool = pointPool(entities, scale);
  const { apart, point, endpoint } = pool;
  return {
    entities,
    point(at: XY, construction = false) {
      if (!finite(...at)) return false;
      point(at, construction);
      return true;
    },
    line(a: XY, b: XY, construction = false) {
      if (!finite(...a, ...b) || !apart(a, b)) return false;
      entities.push({
        id: newId("ln"),
        kind: "line",
        p1: endpoint(a, construction),
        p2: endpoint(b, construction),
        ...flag(construction),
      });
      return true;
    },
    circle(c: XY, r: number, construction = false) {
      if (!finite(...c, r) || !(r * scale > LINEAR_TOL)) return false;
      entities.push({
        id: newId("ci"),
        kind: "circle",
        center: point(c, construction).id,
        radius: r * scale,
        ...flag(construction),
      });
      return true;
    },
    ellipse(
      c: XY,
      major: XY,
      ratio: number,
      construction = false,
      ends?: [XY, XY],
    ) {
      const minor: XY = [c[0] - major[1] * ratio, c[1] + major[0] * ratio];
      if (!finite(...c, ...major, ratio) || !apart(c, minor)) return false;
      if (ends && !apart(...ends)) return false;
      entities.push({
        id: newId("el"),
        kind: "ellipse",
        center: point(c, construction).id,
        major: point([c[0] + major[0], c[1] + major[1]], construction).id,
        minor: point(minor, construction).id,
        ...(ends && {
          start: endpoint(ends[0], construction),
          end: endpoint(ends[1], construction),
        }),
        ...flag(construction),
      });
      return true;
    },
    spline(s: BSpline, construction = false) {
      entities.push(splineOn(pool, s, construction));
      return true;
    },
    arc(c: XY, s: XY, e: XY, construction = false) {
      if (!finite(...c, ...s, ...e) || !apart(s, e)) return false;
      entities.push({
        id: newId("arc"),
        kind: "arc",
        center: point(c, construction).id,
        start: endpoint(s, construction),
        end: endpoint(e, construction),
        ...flag(construction),
      });
      return true;
    },
  };
}
