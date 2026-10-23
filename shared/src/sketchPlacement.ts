import type { SketchEntity } from "./model.js";

export interface ImportPlacement {
  scale: number;
  rotation: number;
  x: number;
  y: number;
}

export interface ImportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PlacementTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FIT = 0.8;
const TAU = Math.PI * 2;

type Point = Extract<SketchEntity, { kind: "point" }>;

export function importBounds(entities: SketchEntity[]): ImportBounds {
  const points = new Map(
    entities
      .filter((e): e is Point => e.kind === "point")
      .map((p) => [p.id, p]),
  );
  const b = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const e of entities) {
    if (e.kind === "point") add(e.x, e.y);
    else if (e.kind === "circle") {
      const c = points.get(e.center);
      if (c) {
        add(c.x - e.radius, c.y - e.radius);
        add(c.x + e.radius, c.y + e.radius);
      }
    } else if (e.kind === "arc") {
      const c = points.get(e.center),
        s = points.get(e.start),
        t = points.get(e.end);
      if (!c || !s || !t) continue;
      const r = Math.hypot(s.x - c.x, s.y - c.y);
      const from = Math.atan2(s.y - c.y, s.x - c.x);
      const sweep =
        (((Math.atan2(t.y - c.y, t.x - c.x) - from) % TAU) + TAU) % TAU || TAU;
      for (let k = 0; k < 4; k++) {
        const angle = (k * Math.PI) / 2;
        if ((((angle - from) % TAU) + TAU) % TAU <= sweep)
          add(c.x + r * Math.cos(angle), c.y + r * Math.sin(angle));
      }
    }
  }
  return b;
}

export function defaultPlacement(
  entities: SketchEntity[],
  target: PlacementTarget | null,
): ImportPlacement {
  if (!target) return { scale: 1, rotation: 0, x: 0, y: 0 };
  const b = importBounds(entities);
  const fit = [
    [b.maxX - b.minX, target.width],
    [b.maxY - b.minY, target.height],
  ]
    .filter(([size]) => size! > 1e-9)
    .map(([size, room]) => (FIT * room!) / size!);
  return {
    scale: Math.min(1, ...fit),
    rotation: 0,
    x: target.x,
    y: target.y,
  };
}

export function placeImport(
  entities: SketchEntity[],
  { scale, rotation, x, y }: ImportPlacement,
): SketchEntity[] {
  const b = importBounds(entities);
  const cx = (b.minX + b.maxX) / 2,
    cy = (b.minY + b.maxY) / 2;
  const cos = Math.cos((rotation * Math.PI) / 180),
    sin = Math.sin((rotation * Math.PI) / 180);
  return entities.map((e) => {
    if (e.kind === "point") {
      const dx = (e.x - cx) * scale,
        dy = (e.y - cy) * scale;
      return { ...e, x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos };
    }
    if (e.kind === "circle") return { ...e, radius: e.radius * scale };
    return e;
  });
}
