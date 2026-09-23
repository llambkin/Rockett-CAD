import { newId, type SketchEntity, type SketchPoint } from "./model.js";
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

export function sketchBuilder(scale = 1) {
  const entities: SketchEntity[] = [];
  const grid = new Map<string, SketchPoint[]>();
  const apart = (a: XY, b: XY) =>
    Math.hypot(b[0] - a[0], b[1] - a[1]) * scale > LINEAR_TOL;
  const point = ([x, y]: XY, construction: boolean): SketchPoint => {
    const p: SketchPoint = {
      id: newId("pt"),
      kind: "point",
      x: x * scale,
      y: y * scale,
      ...flag(construction),
    };
    entities.push(p);
    return p;
  };
  const endpoint = (at: XY, construction: boolean): string => {
    const [x, y] = [at[0] * scale, at[1] * scale];
    const [gx, gy] = [cell(x), cell(y)];
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gy - 1; j <= gy + 1; j++)
        for (const p of grid.get(`${i},${j}`) ?? [])
          if (Math.hypot(p.x - x, p.y - y) <= LINEAR_TOL) {
            if (!construction) delete p.construction;
            return p.id;
          }
    const p = point(at, construction);
    const key = `${gx},${gy}`;
    grid.set(key, [...(grid.get(key) ?? []), p]);
    return p.id;
  };
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
