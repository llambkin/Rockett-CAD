import { crossingCurves, endsOf } from "./curveLimits.js";
import { ARC_SEGMENTS } from "./curveSampling.js";
import type { SketchEntity, SketchPoint } from "./model.js";
import {
  curveDistance,
  curveSamples,
  meet,
  sampleArc,
  sampleEllipse,
  sketchCurves,
  spanParam,
  SPLIT_TOL,
  TAU,
  type Curve,
  type Detection,
  type XY,
} from "./sketchCurves.js";
import { LINEAR_TOL } from "./tolerance.js";

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

const uniq = (ids: string[]) => [...new Set(ids)].toSorted().join(",");

export function profileIdFor(outerIds: string[], holeIds: string[][]): string {
  const canon =
    uniq(outerIds) +
    "|" +
    holeIds
      .map((h) => uniq(h))
      .toSorted()
      .join(";");
  return "p" + fnv(canon);
}

const endless = (c: Curve) => endsOf(c).length === 0;

interface Cut {
  n: number;
  t: number;
}

interface Arrangement {
  nodes: XY[];
  curves: Curve[];
  ends: [number, number][];
  cuts: Cut[][];
  crossing: Set<string>;
}

function cutsOn(c: Curve, nodes: XY[], [from, to]: [number, number]): Cut[] {
  const cuts: Cut[] = [];
  if (c.kind === "spline") return cuts;
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
    if (c.kind === "ellipse") {
      if (curveDistance(c, x, y) >= SPLIT_TOL) return;
      const t = spanParam(c, [x, y]);
      if (!c.span || t < c.span.t1 - 1e-9) cuts.push({ n, t });
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
  return cuts.toSorted((a, b) => a.t - b.t);
}

function arrange(
  entities: SketchEntity[],
  mode: Detection,
  points: SketchPoint[] = [],
): Arrangement {
  const nodes: XY[] = [];
  const nodeFor = (x: number, y: number, tol: number): number => {
    const i = nodes.findIndex(([nx, ny]) => Math.hypot(nx - x, ny - y) < tol);
    if (i >= 0) return i;
    nodes.push([x, y]);
    return nodes.length - 1;
  };
  const curves: Curve[] = [];
  const ends: [number, number][] = [];
  const all = sketchCurves(entities);
  const crossing = crossingCurves(all, mode === "legacy");
  for (const c of all) {
    if (crossing.has(c.id) && (c.kind === "ellipse" || c.kind === "spline"))
      continue;
    if (endless(c)) {
      curves.push(c);
      ends.push([-1, -1]);
      continue;
    }
    const [s, e] = endsOf(c) as [XY, XY];
    const from = nodeFor(s[0], s[1], LINEAR_TOL);
    const to = nodeFor(e[0], e[1], LINEAR_TOL);
    if (from === to) continue;
    curves.push(c);
    ends.push([from, to]);
  }
  for (let i = 0; i < curves.length; i++)
    for (let j = i + 1; j < curves.length; j++)
      for (const [x, y] of meet(curves[i]!, curves[j]!, mode))
        nodeFor(x, y, SPLIT_TOL);
  for (const p of points) nodeFor(p.x, p.y, SPLIT_TOL);
  const cuts = curves.map((c, i) => cutsOn(c, nodes, ends[i]!));
  return { nodes, curves, ends, cuts, crossing };
}

export function curveHits(
  entities: SketchEntity[],
  points: SketchPoint[] = [],
): Map<string, CurveHit[]> {
  const { nodes, curves, ends, cuts, crossing } = arrange(
    entities,
    "trim",
    points,
  );
  const through = new Map<number, string[]>();
  for (const p of points) {
    const n = nodes.findIndex(
      ([x, y]) => Math.hypot(x - p.x, y - p.y) < SPLIT_TOL,
    );
    through.set(n, [...(through.get(n) ?? []), p.id]);
  }
  curves.forEach((c, i) => {
    for (const n of [...ends[i]!, ...cuts[i]!.map((cut) => cut.n)]) {
      if (n < 0) continue;
      const ids = through.get(n) ?? [];
      ids.push(c.id);
      through.set(n, ids);
    }
  });
  return new Map(
    curves.flatMap((c, i) =>
      crossing.has(c.id)
        ? []
        : [
            [
              c.id,
              cuts[i]!.map(({ n, t }) => ({
                x: nodes[n]![0],
                y: nodes[n]![1],
                t,
                by: through.get(n)!.filter((id) => id !== c.id),
              })),
            ] as const,
          ],
    ),
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

function piecesOf(arr: Arrangement): {
  pieces: Piece[];
  whole: Curve[];
} {
  const pieces: Piece[] = [];
  const whole: Curve[] = [];
  const at = (n: number) => arr.nodes[n]!;
  arr.curves.forEach((c, i) => {
    const cuts = arr.cuts[i]!;
    let chain: number[];
    if (endless(c)) {
      if (cuts.length < 2) {
        whole.push(c);
        return;
      }
      chain = [...cuts.map((x) => x.n), cuts[0]!.n];
    } else {
      chain = [arr.ends[i]![0], ...cuts.map((x) => x.n), arr.ends[i]![1]];
    }
    const split = chain.length > 2 || endless(c);
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
            : c.kind === "ellipse"
              ? sampleEllipse(c, a, b)
              : c.kind === "spline"
                ? curveSamples(c)
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

const angle = (s: number[]) => Math.atan2(s[3]! - s[1]!, s[2]! - s[0]!);

function faceLoops(pieces: Piece[]): Loop[] {
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

function closedLoop(c: Curve): Loop {
  const polygon = curveSamples(c, ARC_SEGMENTS * 2).slice(0, -2);
  const signed = polygonArea(polygon);
  return {
    curves: [{ entityId: c.id, reversed: signed < 0 }],
    polygon,
    area: Math.abs(signed),
  };
}

type Ring = Pick<Loop, "polygon" | "area">;

function contains(a: Ring, b: Ring): boolean {
  if (a.area <= b.area) return false;
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

export function uncovered(rings: number[][]): number[][] {
  const all = rings.map((polygon) => ({
    polygon,
    area: Math.abs(polygonArea(polygon)),
  }));
  return rings.filter((_, i) => !all.some((o) => contains(o, all[i]!)));
}

const sense = (c: OrientedCurve) => c.entityId + (c.reversed ? "-" : "+");

function orientation(p: Profile): string {
  const side = (curves: OrientedCurve[]) =>
    curves.map(sense).toSorted().join(",");
  return [side(p.outer), ...p.holes.map(side).toSorted()].join("|");
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

function withoutSpurs(pieces: Piece[]): Piece[] {
  const degree = new Map<number, number>();
  for (const p of pieces)
    for (const n of [p.from, p.to]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const free = (n: number) => degree.get(n) === 1;
  const kept = pieces.filter((p) => !free(p.from) && !free(p.to));
  return kept.length === pieces.length ? pieces : withoutSpurs(kept);
}

type Detected = { profiles: Profile[]; spurred: Profile[] | undefined };

function detect(
  entities: SketchEntity[],
  mode: Detection,
  spurs = false,
): Detected {
  const { pieces, whole } = piecesOf(arrange(entities, mode));
  const traced = (kept: Piece[]) => {
    const profiles = nest([...faceLoops(kept), ...whole.map(closedLoop)]);
    return mode === "current" ? distinctIds(profiles) : profiles;
  };
  const kept = withoutSpurs(pieces);
  const spurred = spurs && kept !== pieces ? traced(pieces) : undefined;
  return { profiles: traced(kept), spurred };
}

export function detectProfiles(entities: SketchEntity[]): Profile[] {
  return detect(entities, "current").profiles;
}

const detections = new WeakMap<SketchEntity[], Map<Detection, Detected>>();

function detected(entities: SketchEntity[], mode: Detection): Detected {
  const byMode = detections.get(entities) ?? new Map<Detection, Detected>();
  detections.set(entities, byMode);
  if (!byMode.has(mode)) byMode.set(mode, detect(entities, mode, true));
  return byMode.get(mode)!;
}

const sides = (p: Profile) => [...p.outer, ...p.holes.flat()].map(sense);

const sameRegion = (spurred: Profile) => (p: Profile) =>
  Math.abs(spurred.area - p.area) <= 1e-9 * Math.max(1, spurred.area) &&
  sides(p).every((side) => sides(spurred).includes(side));

const only = (found: Profile[]) => (found.length === 1 ? found[0] : undefined);

export function findProfile(
  sketch: { profiles: Profile[]; entities: SketchEntity[] },
  profileId: string,
): Profile | undefined {
  const { entities, profiles } = sketch;
  const byId = (p: Profile) => p.id === profileId;
  const found = profiles.find(byId);
  if (found) return found;
  const current = detected(entities, "current").spurred?.find(byId);
  if (current) return only(profiles.filter(sameRegion(current)));
  const legacy = detected(entities, "legacy");
  if (!legacy.spurred) return legacy.profiles.find(byId);
  const old = legacy.spurred.find(byId);
  return only(legacy.profiles.filter(old ? sameRegion(old) : byId));
}
