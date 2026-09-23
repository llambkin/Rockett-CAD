import type { SketchEntity, SketchPoint } from "./model.js";

export interface OrientedCurve {
  entityId: string;
  reversed: boolean;
  trim?: [number, number, number, number];
}

export interface Profile {
  id: string;
  outer: OrientedCurve[];
  holes: OrientedCurve[][];
  polygon: number[];
  holePolygons: number[][];
  area: number;
}

export interface CurveHit {
  x: number;
  y: number;
  t: number;
  by: string[];
}

const MERGE_TOL = 1e-6;
const SPLIT_TOL = 1e-4;
const ARC_SEGMENTS = 24;
const TAU = Math.PI * 2;

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

function polygonArea(poly: number[]): number {
  let s = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += poly[i * 2]! * poly[j * 2 + 1]! - poly[j * 2]! * poly[i * 2 + 1]!;
  }
  return s / 2;
}

export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]!,
      yi = poly[i * 2 + 1]!;
    const xj = poly[j * 2]!,
      yj = poly[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function profileIdFor(outerIds: string[], holeIds: string[][]): string {
  const uniq = (ids: string[]) => [...new Set(ids)].sort().join(",");
  const canon =
    uniq(outerIds) +
    "|" +
    holeIds
      .map((h) => uniq(h))
      .sort()
      .join(";");
  return "p" + fnv(canon);
}

type XY = [number, number];
type Line = {
  id: string;
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
type Arc = {
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
type Circle = { id: string; kind: "circle"; cx: number; cy: number; r: number };
type Curve = Line | Arc | Circle;
type Round = Arc | Circle;
type Detection = "current" | "legacy";

const interior = (t: number) => t > 0 && t < 1;

function onRound(c: Round, x: number, y: number): boolean {
  if (c.kind === "circle") return true;
  let ang = Math.atan2(y - c.cy, x - c.cx);
  while (ang <= c.a0) ang += TAU;
  return ang < c.a1;
}

function lineLine(a: Line, b: Line): XY[] {
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
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
  if (mode === "current" && Math.abs(h - c.r) <= MERGE_TOL) {
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
  const touch = mode === "current";
  let out: XY[] = [];
  if (touch && Math.abs(d - (a.r + b.r)) <= MERGE_TOL) {
    out = [[a.cx + ux * a.r, a.cy + uy * a.r]];
  } else if (touch && Math.abs(d - Math.abs(a.r - b.r)) <= MERGE_TOL) {
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

function meet(a: Curve, b: Curve, mode: Detection): XY[] {
  if (a.kind === "line" && b.kind === "line") return lineLine(a, b);
  if (a.kind === "line") return lineRound(a, b as Round, mode);
  if (b.kind === "line") return lineRound(b, a, mode);
  return roundRound(a, b, mode);
}

function sketchCurves(entities: SketchEntity[]): Curve[] {
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

const endsOf = (c: Line | Arc): [XY, XY] =>
  c.kind === "line"
    ? [
        [c.x1, c.y1],
        [c.x2, c.y2],
      ]
    : [c.s, c.e];

interface Cut {
  n: number;
  t: number;
}

interface Arrangement {
  nodes: XY[];
  curves: Curve[];
  ends: [number, number][];
  cuts: Cut[][];
}

function cutsOn(c: Curve, nodes: XY[], [from, to]: [number, number]): Cut[] {
  const cuts: Cut[] = [];
  nodes.forEach(([x, y], n) => {
    if (n === from || n === to) return;
    if (c.kind === "line") {
      const abx = c.x2 - c.x1;
      const aby = c.y2 - c.y1;
      const t =
        ((x - c.x1) * abx + (y - c.y1) * aby) / (abx * abx + aby * aby || 1);
      if (t <= 1e-9 || t >= 1 - 1e-9) return;
      if (Math.hypot(x - (c.x1 + t * abx), y - (c.y1 + t * aby)) < SPLIT_TOL)
        cuts.push({ n, t });
      return;
    }
    if (Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) >= SPLIT_TOL) return;
    let t = Math.atan2(y - c.cy, x - c.cx);
    if (c.kind === "circle") {
      cuts.push({ n, t });
      return;
    }
    while (t <= c.a0 + 1e-9) t += TAU;
    if (t < c.a1 - 1e-9) cuts.push({ n, t });
  });
  return cuts.sort((a, b) => a.t - b.t);
}

function arrange(entities: SketchEntity[], mode: Detection): Arrangement {
  const nodes: XY[] = [];
  const nodeFor = (x: number, y: number, tol: number): number => {
    const i = nodes.findIndex(([nx, ny]) => Math.hypot(nx - x, ny - y) < tol);
    if (i >= 0) return i;
    nodes.push([x, y]);
    return nodes.length - 1;
  };
  const curves: Curve[] = [];
  const ends: [number, number][] = [];
  for (const c of sketchCurves(entities)) {
    if (c.kind === "circle") {
      curves.push(c);
      ends.push([-1, -1]);
      continue;
    }
    const [s, e] = endsOf(c);
    const from = nodeFor(s[0], s[1], MERGE_TOL);
    const to = nodeFor(e[0], e[1], MERGE_TOL);
    if (from === to) continue;
    curves.push(c);
    ends.push([from, to]);
  }
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++)
      for (const [x, y] of meet(curves[i]!, curves[j]!, mode))
        nodeFor(x, y, SPLIT_TOL);
  const cuts = curves.map((c, i) => cutsOn(c, nodes, ends[i]!));
  return { nodes, curves, ends, cuts };
}

export function curveHits(entities: SketchEntity[]): Map<string, CurveHit[]> {
  const { nodes, curves, ends, cuts } = arrange(entities, "current");
  const through = new Map<number, string[]>();
  curves.forEach((c, i) => {
    for (const n of [...ends[i]!, ...cuts[i]!.map((cut) => cut.n)]) {
      if (n < 0) continue;
      const ids = through.get(n) ?? [];
      ids.push(c.id);
      through.set(n, ids);
    }
  });
  return new Map(
    curves.map((c, i) => [
      c.id,
      cuts[i]!.map(({ n, t }) => ({
        x: nodes[n]![0],
        y: nodes[n]![1],
        t,
        by: through.get(n)!.filter((id) => id !== c.id),
      })),
    ]),
  );
}

interface Piece {
  entityId: string;
  from: number;
  to: number;
  samples: number[];
  trim?: [number, number, number, number];
}

interface Loop {
  curves: OrientedCurve[];
  polygon: number[];
  area: number;
}

function piecesOf(arr: Arrangement): { pieces: Piece[]; whole: Circle[] } {
  const pieces: Piece[] = [];
  const whole: Circle[] = [];
  const at = (n: number) => arr.nodes[n]!;
  arr.curves.forEach((c, i) => {
    const cuts = arr.cuts[i]!;
    let chain: number[];
    if (c.kind === "circle") {
      if (cuts.length < 2) {
        whole.push(c);
        return;
      }
      chain = [...cuts.map((x) => x.n), cuts[0]!.n];
    } else {
      chain = [arr.ends[i]![0], ...cuts.map((x) => x.n), arr.ends[i]![1]];
    }
    const split = chain.length > 2 || c.kind === "circle";
    for (let k = 0; k < chain.length - 1; k++) {
      const [na, nb] = [chain[k]!, chain[k + 1]!];
      if (na === nb) continue;
      const [a, b] = [at(na), at(nb)];
      pieces.push({
        entityId: c.id,
        from: na,
        to: nb,
        samples:
          c.kind === "line"
            ? [a[0], a[1], b[0], b[1]]
            : sampleArc(c.cx, c.cy, a[0], a[1], b[0], b[1]),
        ...(split && { trim: [a[0], a[1], b[0], b[1]] }),
      });
    }
  });
  return { pieces, whole };
}

interface HalfEdge {
  from: number;
  to: number;
  samples: number[];
  curve: OrientedCurve;
  twin: number;
  angleOut: number;
  angleInRev: number;
  visited: boolean;
}

function faceLoops(pieces: Piece[]): Loop[] {
  const angle = (s: number[]) => Math.atan2(s[3]! - s[1]!, s[2]! - s[0]!);
  const halfEdges: HalfEdge[] = [];
  for (const p of pieces) {
    const rev: number[] = [];
    for (let i = p.samples.length - 2; i >= 0; i -= 2)
      rev.push(p.samples[i]!, p.samples[i + 1]!);
    const at = halfEdges.length;
    const trim = p.trim && { trim: p.trim };
    for (const reversed of [false, true]) {
      const [fwd, back] = reversed ? [rev, p.samples] : [p.samples, rev];
      halfEdges.push({
        from: reversed ? p.to : p.from,
        to: reversed ? p.from : p.to,
        samples: fwd,
        curve: { entityId: p.entityId, reversed, ...trim },
        twin: reversed ? at : at + 1,
        angleOut: angle(fwd),
        angleInRev: angle(back),
        visited: false,
      });
    }
  }
  const outgoing = new Map<number, number[]>();
  halfEdges.forEach((he, i) => {
    const arr = outgoing.get(he.from) ?? [];
    arr.push(i);
    outgoing.set(he.from, arr);
  });
  const loops: Loop[] = [];
  for (let start = 0; start < halfEdges.length; start++) {
    if (halfEdges[start]!.visited) continue;
    const curves: OrientedCurve[] = [];
    const polygon: number[] = [];
    let cur = start;
    let closed = false;
    for (let guard = 0; guard <= halfEdges.length; guard++) {
      const he = halfEdges[cur]!;
      if (he.visited) break;
      he.visited = true;
      curves.push(he.curve);
      for (let i = 0; i < he.samples.length - 2; i += 2)
        polygon.push(he.samples[i]!, he.samples[i + 1]!);
      const cands = outgoing.get(he.to) ?? [];
      let best = -1;
      let bestDelta = Infinity;
      for (const cand of cands) {
        if (cand === he.twin && cands.length > 1) continue;
        let delta = he.angleInRev - halfEdges[cand]!.angleOut;
        while (delta <= 1e-12) delta += TAU;
        while (delta > TAU) delta -= TAU;
        if (delta < bestDelta) {
          bestDelta = delta;
          best = cand;
        }
      }
      if (best < 0) break;
      cur = best;
      if (cur === start) {
        closed = true;
        break;
      }
    }
    if (!closed) continue;
    const area = polygonArea(polygon);
    if (area > 1e-9) loops.push({ curves, polygon, area });
  }
  return loops;
}

function circleLoop(c: Circle): Loop {
  const polygon: number[] = [];
  for (let i = 0; i < ARC_SEGMENTS * 2; i++) {
    const t = (i / (ARC_SEGMENTS * 2)) * TAU;
    polygon.push(c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t));
  }
  return {
    curves: [{ entityId: c.id, reversed: false }],
    polygon,
    area: Math.abs(polygonArea(polygon)),
  };
}

function contains(a: Loop, b: Loop): boolean {
  if (a === b || a.area <= b.area) return false;
  const n = b.polygon.length / 2;
  const step = Math.max(1, Math.floor(n / 5));
  for (let i = 0; i < n; i += step)
    if (!pointInPolygon(b.polygon[i * 2]!, b.polygon[i * 2 + 1]!, a.polygon))
      return false;
  return true;
}

function nest(loops: Loop[]): Profile[] {
  return loops.map((loop) => {
    const inside = loops.filter((o) => contains(loop, o));
    const direct = inside.filter(
      (o) => !inside.some((mid) => mid !== o && contains(mid, o)),
    );
    const holes = direct.map((h) => h.curves);
    return {
      id: profileIdFor(
        loop.curves.map((c) => c.entityId),
        holes.map((h) => h.map((c) => c.entityId)),
      ),
      outer: loop.curves,
      holes,
      polygon: loop.polygon,
      holePolygons: direct.map((h) => h.polygon),
      area: loop.area - direct.reduce((s, h) => s + h.area, 0),
    };
  });
}

function orientation(p: Profile): string {
  const side = (curves: OrientedCurve[]) =>
    curves
      .map((c) => c.entityId + (c.reversed ? "-" : "+"))
      .sort()
      .join(",");
  return [side(p.outer), ...p.holes.map(side).sort()].join("|");
}

function distinctIds(profiles: Profile[]): Profile[] {
  const count = new Map<string, number>();
  for (const p of profiles) count.set(p.id, (count.get(p.id) ?? 0) + 1);
  const seen = new Map<string, number>();
  return profiles.map((p) => {
    if (count.get(p.id) === 1) return p;
    const id = `${p.id}.${fnv(orientation(p))}`;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return { ...p, id: n === 1 ? id : `${id}.${n}` };
  });
}

function detect(entities: SketchEntity[], mode: Detection): Profile[] {
  const { pieces, whole } = piecesOf(arrange(entities, mode));
  const profiles = nest([...faceLoops(pieces), ...whole.map(circleLoop)]);
  return mode === "current" ? distinctIds(profiles) : profiles;
}

export function detectProfiles(entities: SketchEntity[]): Profile[] {
  return detect(entities, "current");
}

const legacyCache = new WeakMap<SketchEntity[], Profile[]>();

export function findProfile(
  sketch: { profiles: Profile[]; entities: SketchEntity[] },
  profileId: string,
): Profile | undefined {
  const found = sketch.profiles.find((p) => p.id === profileId);
  if (found) return found;
  let legacy = legacyCache.get(sketch.entities);
  if (!legacy) {
    legacy = detect(sketch.entities, "legacy");
    legacyCache.set(sketch.entities, legacy);
  }
  return legacy.find((p) => p.id === profileId);
}
