import type { SketchEntity, SketchPoint } from "./model.js";
import { LINEAR_TOL } from "./tolerance.js";

export const SPLIT_TOL = 1e-4;
export const ARC_SEGMENTS = 24;
export const TAU = Math.PI * 2;

export function arcAngles(
  a: { cx: number; cy: number; sx: number; sy: number; ex: number; ey: number },
  _ccw = true,
): { a0: number; a1: number; r: number } {
  const a0 = Math.atan2(a.sy - a.cy, a.sx - a.cx);
  let a1 = Math.atan2(a.ey - a.cy, a.ex - a.cx);
  if (a1 <= a0 + 1e-12) a1 += TAU;
  const r = Math.hypot(a.sx - a.cx, a.sy - a.cy);
  return { a0, a1, r };
}

export function sampleArc(
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  segments = ARC_SEGMENTS,
): number[] {
  const { a0, a1, r } = arcAngles({ cx, cy, sx, sy, ex, ey });
  const out: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = a0 + ((a1 - a0) * i) / segments;
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  out[0] = sx;
  out[1] = sy;
  out[out.length - 2] = ex;
  out[out.length - 1] = ey;
  return out;
}

export type XY = [number, number];
export type Line = {
  id: string;
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
export type Arc = {
  id: string;
  kind: "arc";
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
  s: XY;
  e: XY;
};
export type Circle = {
  id: string;
  kind: "circle";
  cx: number;
  cy: number;
  r: number;
};
export type Curve = Line | Arc | Circle;
type Round = Arc | Circle;
export type Detection = "current" | "legacy" | "trim";

const interior = (t: number) => t > 0 && t < 1;

function onRound(c: Round, x: number, y: number): boolean {
  if (c.kind === "circle") return true;
  let ang = Math.atan2(y - c.cy, x - c.cx);
  while (ang <= c.a0) ang += TAU;
  return ang < c.a1;
}

function lineLine(a: Line, b: Line, mode: Detection): XY[] {
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
  const off = (x: number, y: number) =>
    Math.abs((x - a.x1) * d1y - (y - a.y1) * d1x) / Math.hypot(d1x, d1y);
  if (mode === "trim" && Math.max(off(b.x1, b.y1), off(b.x2, b.y2)) < SPLIT_TOL)
    return [];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return [];
  const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / den;
  const u = ((b.x1 - a.x1) * d1y - (b.y1 - a.y1) * d1x) / den;
  if (!interior(t) || !interior(u)) return [];
  return [[a.x1 + t * d1x, a.y1 + t * d1y]];
}

function lineRound(l: Line, c: Round, mode: Detection): XY[] {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-24) return [];
  const t0 = ((c.cx - l.x1) * dx + (c.cy - l.y1) * dy) / len2;
  const fx = l.x1 + t0 * dx;
  const fy = l.y1 + t0 * dy;
  const h = Math.hypot(c.cx - fx, c.cy - fy);
  const out: XY[] = [];
  if (mode !== "legacy" && Math.abs(h - c.r) <= LINEAR_TOL) {
    if (interior(t0)) out.push([fx, fy]);
  } else if (h < c.r) {
    const half = Math.sqrt(c.r * c.r - h * h) / Math.sqrt(len2);
    for (const t of [t0 - half, t0 + half])
      if (interior(t)) out.push([l.x1 + t * dx, l.y1 + t * dy]);
  }
  return out.filter(([x, y]) => onRound(c, x, y));
}

function roundRound(a: Round, b: Round, mode: Detection): XY[] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-12) return [];
  const ux = dx / d;
  const uy = dy / d;
  const touch = mode !== "legacy";
  let out: XY[] = [];
  if (touch && Math.abs(d - (a.r + b.r)) <= LINEAR_TOL) {
    out = [[a.cx + ux * a.r, a.cy + uy * a.r]];
  } else if (touch && Math.abs(d - Math.abs(a.r - b.r)) <= LINEAR_TOL) {
    const sign = a.r > b.r ? 1 : -1;
    out = [[a.cx + sign * ux * a.r, a.cy + sign * uy * a.r]];
  } else if (d < a.r + b.r && d > Math.abs(a.r - b.r)) {
    const m = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a.r * a.r - m * m));
    const mx = a.cx + m * ux;
    const my = a.cy + m * uy;
    out = [
      [mx - uy * h, my + ux * h],
      [mx + uy * h, my - ux * h],
    ];
  }
  return out.filter(([x, y]) => onRound(a, x, y) && onRound(b, x, y));
}

export function meet(a: Curve, b: Curve, mode: Detection): XY[] {
  if (a.kind === "line" && b.kind === "line") return lineLine(a, b, mode);
  if (a.kind === "line") return lineRound(a, b as Round, mode);
  if (b.kind === "line") return lineRound(b, a, mode);
  return roundRound(a, b, mode);
}

export function sketchCurves(entities: SketchEntity[]): Curve[] {
  const points = new Map<string, SketchPoint>();
  for (const e of entities) if (e.kind === "point") points.set(e.id, e);
  const curves: Curve[] = [];
  for (const e of entities) {
    if (e.construction) continue;
    if (e.kind === "line") {
      const p1 = points.get(e.p1);
      const p2 = points.get(e.p2);
      if (p1 && p2)
        curves.push({
          id: e.id,
          kind: "line",
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
        });
    } else if (e.kind === "arc") {
      const c = points.get(e.center);
      const s = points.get(e.start);
      const en = points.get(e.end);
      if (!c || !s || !en) continue;
      const { a0, a1, r } = arcAngles({
        cx: c.x,
        cy: c.y,
        sx: s.x,
        sy: s.y,
        ex: en.x,
        ey: en.y,
      });
      curves.push({
        id: e.id,
        kind: "arc",
        cx: c.x,
        cy: c.y,
        r,
        a0,
        a1,
        s: [s.x, s.y],
        e: [en.x, en.y],
      });
    } else if (e.kind === "circle") {
      const c = points.get(e.center);
      if (c && e.radius > 0)
        curves.push({
          id: e.id,
          kind: "circle",
          cx: c.x,
          cy: c.y,
          r: e.radius,
        });
    }
  }
  return curves;
}
