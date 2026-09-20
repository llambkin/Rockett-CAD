/**
 * Sketch profile (closed region) detection.
 *
 * Builds a planar subdivision from the sketch curves and extracts minimal
 * enclosed regions ("profiles") using half-edge traversal — the same concept
 * as Fusion 360's clickable blue profile regions.
 *
 * Regions are identified by a stable id derived from the entity ids that
 * bound them, so a profile reference survives regeneration as long as the
 * same entities still enclose the region.
 */

import type { SketchArc, SketchEntity, SketchPoint } from "./model.js";

export interface OrientedCurve {
  entityId: string;
  reversed: boolean;
  /**
   * Present when this boundary piece is a T-junction split of the entity:
   * sub-curve endpoints [sx, sy, ex, ey] in the entity's NATURAL direction
   * (line p1→p2 / arc start→end); `reversed` still says how the loop
   * traverses it.
   */
  trim?: [number, number, number, number];
}

export interface Profile {
  id: string;
  /** Outer boundary, ordered counter-clockwise. */
  outer: OrientedCurve[];
  /** Inner loops (holes), each ordered clockwise as stored polygon-wise. */
  holes: OrientedCurve[][];
  /** Sampled outer polygon [x0,y0,x1,y1,...] for display / hit-testing. */
  polygon: number[];
  holePolygons: number[][];
  area: number;
}

const MERGE_TOL = 1e-6;
const ARC_SEGMENTS = 24;

interface Node {
  x: number;
  y: number;
  pointIds: string[];
}

interface HalfEdge {
  from: number;
  to: number;
  /** Sample polyline from->to including both endpoints. */
  samples: number[];
  entityId: string;
  reversed: boolean;
  trim?: [number, number, number, number];
  twin: number;
  angleOut: number; // direction of departure at `from`
  angleInRev: number; // direction of arrival reversed at `to`
  visited: boolean;
}

export function arcAngles(
  a: { cx: number; cy: number; sx: number; sy: number; ex: number; ey: number },
  _ccw = true
): { a0: number; a1: number; r: number } {
  const a0 = Math.atan2(a.sy - a.cy, a.sx - a.cx);
  let a1 = Math.atan2(a.ey - a.cy, a.ex - a.cx);
  if (a1 <= a0 + 1e-12) a1 += Math.PI * 2;
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
  segments = ARC_SEGMENTS
): number[] {
  const { a0, a1, r } = arcAngles({ cx, cy, sx, sy, ex, ey });
  const out: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = a0 + ((a1 - a0) * i) / segments;
    out.push(cx + r * Math.cos(t), cy + r * Math.sin(t));
  }
  // Snap endpoints exactly
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
    s += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  return s / 2;
}

export function pointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2],
      yi = poly[i * 2 + 1];
    const xj = poly[j * 2],
      yj = poly[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

type RawCurve =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "arc"; cx: number; cy: number; r: number; a0: number; a1: number };
type RawLine = Extract<RawCurve, { kind: "line" }>;
type RawArc = Extract<RawCurve, { kind: "arc" }>;

/** Strictly interior segment parameter (excludes both endpoints). */
const interior = (t: number) => t > 0 && t < 1;

function onArcInterior(arc: RawArc, x: number, y: number): boolean {
  let ang = Math.atan2(y - arc.cy, x - arc.cx);
  while (ang <= arc.a0) ang += Math.PI * 2;
  return ang < arc.a1;
}

function lineLineCrossings(a: RawLine, b: RawLine): [number, number][] {
  const d1x = a.x2 - a.x1;
  const d1y = a.y2 - a.y1;
  const d2x = b.x2 - b.x1;
  const d2y = b.y2 - b.y1;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return []; // parallel / collinear: no crossing point
  const t = ((b.x1 - a.x1) * d2y - (b.y1 - a.y1) * d2x) / den;
  const u = ((b.x1 - a.x1) * d1y - (b.y1 - a.y1) * d1x) / den;
  if (!interior(t) || !interior(u)) return [];
  return [[a.x1 + t * d1x, a.y1 + t * d1y]];
}

/** Segment ∩ circle, keeping points interior to the segment. A tangent touch
 * (zero discriminant) is skipped — it doesn't separate regions. */
function lineCircleCrossings(
  l: RawLine,
  cx: number,
  cy: number,
  r: number
): [number, number][] {
  const dx = l.x2 - l.x1;
  const dy = l.y2 - l.y1;
  const fx = l.x1 - cx;
  const fy = l.y1 - cy;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-24 || disc <= 0) return [];
  const sq = Math.sqrt(disc);
  const out: [number, number][] = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (interior(t)) out.push([l.x1 + t * dx, l.y1 + t * dy]);
  }
  return out;
}

/** Circle ∩ circle; tangent and concentric pairs yield nothing. */
function circleCircleCrossings(a: RawArc, b: RawArc): [number, number][] {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-12 || d >= a.r + b.r || d <= Math.abs(a.r - b.r)) return [];
  const m = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h2 = a.r * a.r - m * m;
  if (h2 <= 0) return [];
  const h = Math.sqrt(h2);
  const mx = a.cx + (m * dx) / d;
  const my = a.cy + (m * dy) / d;
  const ox = (-dy * h) / d;
  const oy = (dx * h) / d;
  return [
    [mx + ox, my + oy],
    [mx - ox, my - oy],
  ];
}

/** Points where two curves cross at their interiors (no shared endpoint). */
function curveCrossings(a: RawCurve, b: RawCurve): [number, number][] {
  if (a.kind === "line" && b.kind === "line") return lineLineCrossings(a, b);
  if (a.kind === "arc" && b.kind === "arc") {
    return circleCircleCrossings(a, b).filter(
      ([x, y]) => onArcInterior(a, x, y) && onArcInterior(b, x, y)
    );
  }
  const line = a.kind === "line" ? a : (b as RawLine);
  const arc = a.kind === "arc" ? a : (b as RawArc);
  return lineCircleCrossings(line, arc.cx, arc.cy, arc.r).filter(([x, y]) =>
    onArcInterior(arc, x, y)
  );
}

/** FNV-1a over a canonical string of loop entity ids. Ids are deduplicated
 * so a T-junction split (one entity contributing several boundary pieces)
 * doesn't change the id. */
export function profileIdFor(outerIds: string[], holeIds: string[][]): string {
  const uniq = (ids: string[]) => [...new Set(ids)].sort().join(",");
  const canon =
    uniq(outerIds) +
    "|" +
    holeIds
      .map((h) => uniq(h))
      .sort()
      .join(";");
  let h = 0x811c9dc5;
  for (let i = 0; i < canon.length; i++) {
    h ^= canon.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return "p" + (h >>> 0).toString(36);
}

export function detectProfiles(entities: SketchEntity[]): Profile[] {
  const points = new Map<string, SketchPoint>();
  for (const e of entities) if (e.kind === "point") points.set(e.id, e);

  // --- merge nodes by position tolerance ---
  const nodes: Node[] = [];
  const pointNode = new Map<string, number>();
  const nodeFor = (x: number, y: number, pid?: string): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - x, nodes[i].y - y) < MERGE_TOL) {
        if (pid) {
          nodes[i].pointIds.push(pid);
          pointNode.set(pid, i);
        }
        return i;
      }
    }
    nodes.push({ x, y, pointIds: pid ? [pid] : [] });
    if (pid) pointNode.set(pid, nodes.length - 1);
    return nodes.length - 1;
  };

  interface CurveSeg {
    entityId: string;
    from: number;
    to: number;
    samples: number[]; // includes endpoints
    trim?: [number, number, number, number];
  }
  const curves: CurveSeg[] = [];
  const circles: { entityId: string; cx: number; cy: number; r: number }[] = [];

  /** How close a node must be to a curve's interior to split it. */
  const SPLIT_TOL = 1e-4;

  // Pass 1: register every curve endpoint as a node, so pass 2 can detect
  // T-junctions (an endpoint landing on the INTERIOR of another curve).
  const raw: RawCurve[] = [];
  for (const e of entities) {
    if (e.construction) continue;
    if (e.kind === "line") {
      const p1 = points.get(e.p1);
      const p2 = points.get(e.p2);
      if (p1) nodeFor(p1.x, p1.y, p1.id);
      if (p2) nodeFor(p2.x, p2.y, p2.id);
      if (p1 && p2) {
        raw.push({ kind: "line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      }
    } else if (e.kind === "arc") {
      const c = points.get(e.center);
      const s = points.get(e.start);
      const en = points.get(e.end);
      if (s) nodeFor(s.x, s.y, s.id);
      if (en) nodeFor(en.x, en.y, en.id);
      if (c && s && en) {
        const { a0, a1, r } = arcAngles({
          cx: c.x,
          cy: c.y,
          sx: s.x,
          sy: s.y,
          ex: en.x,
          ey: en.y,
        });
        raw.push({ kind: "arc", cx: c.x, cy: c.y, r, a0, a1 });
      }
    } else if (e.kind === "circle") {
      const c = points.get(e.center);
      if (c && e.radius > 0) {
        // full turn: every angle in (-π, π] counts as interior
        raw.push({
          kind: "arc",
          cx: c.x,
          cy: c.y,
          r: e.radius,
          a0: -Math.PI - 1e-9,
          a1: Math.PI + 1e-9,
        });
      }
    }
  }

  // Pass 1b: register X-junctions — two curves crossing at their interiors
  // with no sketch point there. A crossing registered as a node gets split by
  // pass 2 exactly like a T-junction, so crossing lines divide regions the
  // way they do in Fusion. Candidates near an existing node are endpoints or
  // T-junctions already; re-adding them would only cut sliver segments.
  const nearNode = (x: number, y: number) =>
    nodes.some((n) => Math.hypot(n.x - x, n.y - y) < SPLIT_TOL);
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      for (const [x, y] of curveCrossings(raw[i], raw[j])) {
        if (!nearNode(x, y)) nodeFor(x, y);
      }
    }
  }

  // Pass 2: build curve segments, splitting each curve at interior nodes so
  // shapes "closed" against the middle of another line still form regions.
  for (const e of entities) {
    if (e.construction) continue;
    if (e.kind === "line") {
      const p1 = points.get(e.p1);
      const p2 = points.get(e.p2);
      if (!p1 || !p2) continue;
      const from = nodeFor(p1.x, p1.y, p1.id);
      const to = nodeFor(p2.x, p2.y, p2.id);
      if (from === to) continue;
      const abx = p2.x - p1.x;
      const aby = p2.y - p1.y;
      const len2 = abx * abx + aby * aby || 1;
      const cuts: { n: number; t: number }[] = [];
      for (let i = 0; i < nodes.length; i++) {
        if (i === from || i === to) continue;
        const t = ((nodes[i].x - p1.x) * abx + (nodes[i].y - p1.y) * aby) / len2;
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const px = p1.x + t * abx;
        const py = p1.y + t * aby;
        if (Math.hypot(nodes[i].x - px, nodes[i].y - py) < SPLIT_TOL) {
          cuts.push({ n: i, t });
        }
      }
      cuts.sort((a, b) => a.t - b.t);
      const chain = [from, ...cuts.map((c) => c.n), to];
      for (let i = 0; i < chain.length - 1; i++) {
        if (chain[i] === chain[i + 1]) continue;
        const a = nodes[chain[i]];
        const b = nodes[chain[i + 1]];
        curves.push({
          entityId: e.id,
          from: chain[i],
          to: chain[i + 1],
          samples: [a.x, a.y, b.x, b.y],
          trim: chain.length > 2 ? [a.x, a.y, b.x, b.y] : undefined,
        });
      }
    } else if (e.kind === "arc") {
      const c = points.get(e.center);
      const s = points.get(e.start);
      const en = points.get(e.end);
      if (!c || !s || !en) continue;
      const from = nodeFor(s.x, s.y, s.id);
      const to = nodeFor(en.x, en.y, en.id);
      if (from === to) continue;
      const { a0, a1, r } = arcAngles({
        cx: c.x,
        cy: c.y,
        sx: s.x,
        sy: s.y,
        ex: en.x,
        ey: en.y,
      });
      const cuts: { n: number; ang: number }[] = [];
      for (let i = 0; i < nodes.length; i++) {
        if (i === from || i === to) continue;
        const dc = Math.hypot(nodes[i].x - c.x, nodes[i].y - c.y);
        if (Math.abs(dc - r) >= SPLIT_TOL) continue;
        let ang = Math.atan2(nodes[i].y - c.y, nodes[i].x - c.x);
        while (ang <= a0 + 1e-9) ang += Math.PI * 2;
        if (ang < a1 - 1e-9) cuts.push({ n: i, ang });
      }
      cuts.sort((a, b) => a.ang - b.ang);
      const chain = [from, ...cuts.map((x) => x.n), to];
      for (let i = 0; i < chain.length - 1; i++) {
        if (chain[i] === chain[i + 1]) continue;
        const a = nodes[chain[i]];
        const b = nodes[chain[i + 1]];
        curves.push({
          entityId: e.id,
          from: chain[i],
          to: chain[i + 1],
          samples: sampleArc(c.x, c.y, a.x, a.y, b.x, b.y),
          trim: chain.length > 2 ? [a.x, a.y, b.x, b.y] : undefined,
        });
      }
    } else if (e.kind === "circle") {
      const c = points.get(e.center);
      if (!c || e.radius <= 0) continue;
      // Two or more nodes on the circle (crossings, or curves ending on it)
      // split it into arcs that join the wire graph, so the disc and its
      // neighbours divide like they do in Fusion. Otherwise it stays a whole
      // loop (a single touching curve can't divide anything).
      const onCircle: { n: number; ang: number }[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const d = Math.hypot(nodes[i].x - c.x, nodes[i].y - c.y);
        if (Math.abs(d - e.radius) < SPLIT_TOL) {
          onCircle.push({ n: i, ang: Math.atan2(nodes[i].y - c.y, nodes[i].x - c.x) });
        }
      }
      if (onCircle.length < 2) {
        circles.push({ entityId: e.id, cx: c.x, cy: c.y, r: e.radius });
        continue;
      }
      onCircle.sort((a, b) => a.ang - b.ang);
      for (let i = 0; i < onCircle.length; i++) {
        const from = onCircle[i].n;
        const to = onCircle[(i + 1) % onCircle.length].n;
        if (from === to) continue;
        const a = nodes[from];
        const b = nodes[to];
        curves.push({
          entityId: e.id,
          from,
          to,
          samples: sampleArc(c.x, c.y, a.x, a.y, b.x, b.y),
          trim: [a.x, a.y, b.x, b.y],
        });
      }
    }
  }

  // --- half-edge structure ---
  const halfEdges: HalfEdge[] = [];
  for (const c of curves) {
    const n = c.samples.length;
    const rev: number[] = [];
    for (let i = n - 2; i >= 0; i -= 2) rev.push(c.samples[i], c.samples[i + 1]);
    const fwdIdx = halfEdges.length;
    const angle = (samples: number[]) =>
      Math.atan2(samples[3] - samples[1], samples[2] - samples[0]);
    halfEdges.push({
      from: c.from,
      to: c.to,
      samples: c.samples,
      entityId: c.entityId,
      reversed: false,
      trim: c.trim,
      twin: fwdIdx + 1,
      angleOut: angle(c.samples),
      angleInRev: angle(rev),
      visited: false,
    });
    halfEdges.push({
      from: c.to,
      to: c.from,
      samples: rev,
      entityId: c.entityId,
      reversed: true,
      trim: c.trim,
      twin: fwdIdx,
      angleOut: angle(rev),
      angleInRev: angle(c.samples),
      visited: false,
    });
  }

  // outgoing half-edges per node, sorted by departure angle
  const outgoing = new Map<number, number[]>();
  halfEdges.forEach((he, i) => {
    const arr = outgoing.get(he.from) ?? [];
    arr.push(i);
    outgoing.set(he.from, arr);
  });
  for (const arr of outgoing.values()) {
    arr.sort((a, b) => halfEdges[a].angleOut - halfEdges[b].angleOut);
  }

  interface RawLoop {
    curves: OrientedCurve[];
    polygon: number[];
    area: number;
  }
  const loops: RawLoop[] = [];

  for (let start = 0; start < halfEdges.length; start++) {
    if (halfEdges[start].visited) continue;
    const loopCurves: OrientedCurve[] = [];
    const poly: number[] = [];
    let cur = start;
    let guard = 0;
    let ok = true;
    while (guard++ < halfEdges.length + 1) {
      const he = halfEdges[cur];
      if (he.visited) {
        ok = false;
        break;
      }
      he.visited = true;
      loopCurves.push({ entityId: he.entityId, reversed: he.reversed, trim: he.trim });
      for (let i = 0; i < he.samples.length - 2; i += 2) {
        poly.push(he.samples[i], he.samples[i + 1]);
      }
      // next: among edges leaving he.to, pick the one making the sharpest
      // clockwise turn relative to arrival direction (standard face walk).
      const arrive = he.angleInRev; // direction pointing back along arrival
      const cands = outgoing.get(he.to) ?? [];
      let best = -1;
      let bestDelta = Infinity;
      for (const cand of cands) {
        if (cand === he.twin && cands.length > 1) continue;
        let delta = arrive - halfEdges[cand].angleOut;
        while (delta <= 1e-12) delta += Math.PI * 2;
        while (delta > Math.PI * 2) delta -= Math.PI * 2;
        if (delta < bestDelta) {
          bestDelta = delta;
          best = cand;
        }
      }
      if (best < 0) {
        ok = false;
        break;
      }
      cur = best;
      if (cur === start) break;
    }
    if (!ok || cur !== start) continue;
    const area = polygonArea(poly);
    if (Math.abs(area) < 1e-9) continue;
    loops.push({ curves: loopCurves, polygon: poly, area });
  }

  // Regions = CCW loops (area > 0). CW loops trace the unbounded outside.
  const regions = loops.filter((l) => l.area > 1e-9);

  // --- circles: whole-circle loops ---
  interface CircleLoop {
    entityId: string;
    polygon: number[];
    cx: number;
    cy: number;
    r: number;
  }
  const circleLoops: CircleLoop[] = circles.map((c) => {
    const poly: number[] = [];
    for (let i = 0; i < ARC_SEGMENTS * 2; i++) {
      const t = (i / (ARC_SEGMENTS * 2)) * Math.PI * 2;
      poly.push(c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t));
    }
    return { entityId: c.entityId, polygon: poly, cx: c.cx, cy: c.cy, r: c.r };
  });

  // --- unified region tree ---
  // Every closed loop (wire-walk region or full circle) is a profile whose
  // holes are the loops *directly* contained inside it (even-odd nesting).
  interface Loop {
    curves: OrientedCurve[];
    polygon: number[];
    area: number;
  }
  const allLoops: Loop[] = [
    ...regions.map((r) => ({
      curves: r.curves,
      polygon: r.polygon,
      area: r.area,
    })),
    ...circleLoops.map((c) => ({
      curves: [{ entityId: c.entityId, reversed: false }],
      polygon: c.polygon,
      area: Math.abs(polygonArea(c.polygon)),
    })),
  ];

  const contains = (a: Loop, b: Loop): boolean => {
    if (a === b) return false;
    if (a.area <= b.area) return false;
    // all sampled vertices of b inside a (test a few for speed)
    const n = b.polygon.length / 2;
    const step = Math.max(1, Math.floor(n / 5));
    for (let i = 0; i < n; i += step) {
      if (!pointInPolygon(b.polygon[i * 2], b.polygon[i * 2 + 1], a.polygon)) {
        return false;
      }
    }
    return true;
  };

  const profiles: Profile[] = [];
  for (const loop of allLoops) {
    const inside = allLoops.filter((o) => contains(loop, o));
    // direct children: contained in loop but not in any other contained loop
    const holesLoops = inside.filter(
      (o) => !inside.some((mid) => mid !== o && contains(mid, o))
    );
    const holes = holesLoops.map((h) => h.curves);
    const holePolygons = holesLoops.map((h) => h.polygon);
    const outerIds = loop.curves.map((c) => c.entityId);
    profiles.push({
      id: profileIdFor(outerIds, holes.map((h) => h.map((c) => c.entityId))),
      outer: loop.curves,
      holes,
      polygon: loop.polygon,
      holePolygons,
      area: loop.area - holesLoops.reduce((s, h) => s + h.area, 0),
    });
  }

  return profiles;
}
