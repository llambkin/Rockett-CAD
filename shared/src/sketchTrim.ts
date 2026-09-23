import {
  newId,
  type SketchConstraint,
  type SketchEntity,
  type SketchPoint,
} from "./model.js";
import { arcAngles, curveHits, sampleArc, type CurveHit } from "./profiles.js";
import {
  constraintEntityRefs,
  type SketchModification,
} from "./sketchModify.js";

type XY = { x: number; y: number };
type Curve = Exclude<SketchEntity, SketchPoint>;

export interface TrimPiece {
  entityId: string;
  from: CurveHit | null;
  to: CurveHit | null;
  samples: number[];
}

const TAU = Math.PI * 2;
const ON_POINT = 1e-4;
const SEGMENTS = 32;
const hitCache = new WeakMap<SketchEntity[], Map<string, CurveHit[]>>();

function hitsOn(entities: SketchEntity[], curve: Curve): CurveHit[] {
  let hits = hitCache.get(entities);
  if (!hits) {
    hits = curveHits(entities);
    hitCache.set(entities, hits);
  }
  let on = hits.get(curve.id);
  if (!on) {
    const cut = entities.map((e) =>
      e.id === curve.id ? { ...curve, construction: false } : e,
    );
    on = curve.construction ? (curveHits(cut).get(curve.id) ?? []) : [];
    hits.set(curve.id, on);
  }
  return on;
}

function pointIn(entities: SketchEntity[], id: string): SketchPoint {
  const p = entities.find((e) => e.id === id);
  if (!p || p.kind !== "point") throw new Error("Sketch endpoint is missing.");
  return p;
}

function curveIn(entities: SketchEntity[], id: string): Curve {
  const curve = entities.find((e) => e.id === id);
  if (!curve || curve.kind === "point")
    throw new Error("Choose a sketch curve.");
  return curve;
}

function shape(entities: SketchEntity[], curve: Curve) {
  const at = (hit: CurveHit | null, id: string): XY =>
    hit ?? pointIn(entities, id);
  if (curve.kind === "line") {
    const a = pointIn(entities, curve.p1);
    const b = pointIn(entities, curve.p2);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      param: (q: XY) =>
        Math.min(
          1,
          Math.max(
            0,
            ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        ),
      samples: (from: CurveHit | null, to: CurveHit | null) => {
        const [p, q] = [at(from, curve.p1), at(to, curve.p2)];
        return [p.x, p.y, q.x, q.y];
      },
    };
  }
  const c = pointIn(entities, curve.center);
  const angle = (q: XY) => Math.atan2(q.y - c.y, q.x - c.x);
  const arc = (p: XY, q: XY) =>
    sampleArc(c.x, c.y, p.x, p.y, q.x, q.y, SEGMENTS);
  if (curve.kind === "circle") {
    const rim = { x: c.x + curve.radius, y: c.y };
    return {
      param: angle,
      samples: (from: CurveHit | null, to: CurveHit | null) =>
        from && to ? arc(from, to) : arc(rim, rim),
    };
  }
  const s = pointIn(entities, curve.start);
  const e = pointIn(entities, curve.end);
  const { a0, a1 } = arcAngles({
    cx: c.x,
    cy: c.y,
    sx: s.x,
    sy: s.y,
    ex: e.x,
    ey: e.y,
  });
  return {
    param: (q: XY) => {
      let t = angle(q);
      while (t <= a0) t += TAU;
      if (t < a1) return t;
      return t - a1 < a0 + TAU - t ? a1 : a0;
    },
    samples: (from: CurveHit | null, to: CurveHit | null) =>
      arc(at(from, curve.start), at(to, curve.end)),
  };
}

export function trimPiece(
  entities: SketchEntity[],
  entityId: string,
  at: XY,
): TrimPiece {
  const curve = curveIn(entities, entityId);
  const hits = hitsOn(entities, curve);
  const g = shape(entities, curve);
  const t = g.param(at);
  const next = hits.findIndex((h) => h.t >= t);
  const after = hits[next] ?? null;
  const before = (next < 0 ? hits.at(-1) : hits[next - 1]) ?? null;
  const [from, to] =
    curve.kind !== "circle"
      ? [before, after]
      : hits.length < 2
        ? [null, null]
        : [before ?? hits.at(-1)!, after ?? hits[0]!];
  return { entityId, from, to, samples: g.samples(from, to) };
}

function onCutter(
  entities: SketchEntity[],
  point: string,
  hit: CurveHit,
  cutterId: string,
): SketchConstraint {
  const cutter = curveIn(entities, cutterId);
  const ends =
    cutter.kind === "line"
      ? [cutter.p1, cutter.p2]
      : cutter.kind === "arc"
        ? [cutter.start, cutter.end]
        : [];
  const meet = ends.find((id) => {
    const p = pointIn(entities, id);
    return Math.hypot(p.x - hit.x, p.y - hit.y) < ON_POINT;
  });
  const id = newId("c");
  if (meet) return { id, type: "coincident", a: point, b: meet };
  return cutter.kind === "line"
    ? { id, type: "pointOnLine", point, line: cutter.id }
    : { id, type: "pointOnCircle", point, circle: cutter.id };
}

const pointsOf = (e: SketchEntity): string[] =>
  e.kind === "line"
    ? [e.p1, e.p2]
    : e.kind === "arc"
      ? [e.center, e.start, e.end]
      : e.kind === "circle"
        ? [e.center]
        : [];

function keptPieces(
  curve: Curve,
  from: CurveHit | null,
  to: CurveHit | null,
  end: (hit: CurveHit) => string,
): Curve[] {
  const flag =
    curve.construction === undefined
      ? {}
      : { construction: curve.construction };
  if (curve.kind === "circle")
    return from && to
      ? [
          {
            id: curve.id,
            kind: "arc",
            center: curve.center,
            start: end(to),
            end: end(from),
            ...flag,
          },
        ]
      : [];
  const [first, last] =
    curve.kind === "line" ? [curve.p1, curve.p2] : [curve.start, curve.end];
  const spans: [string, string][] = [];
  if (from) spans.push([first, end(from)]);
  if (to) spans.push([end(to), last]);
  const pieces: Curve[] = [];
  spans.forEach(([p, q], i) => {
    const id = i === 0 ? curve.id : newId("e");
    pieces.push(
      curve.kind === "line"
        ? { id, kind: "line", p1: p, p2: q, ...flag }
        : { id, kind: "arc", center: curve.center, start: p, end: q, ...flag },
    );
  });
  return pieces;
}

function survivingConstraints(
  constraints: SketchConstraint[],
  curve: Curve,
  gone: Set<string>,
  shortened: boolean,
): SketchConstraint[] {
  return constraints.filter((c) => {
    const refs = constraintEntityRefs(c);
    if (refs.some((id) => gone.has(id))) return false;
    return !(
      shortened &&
      refs.includes(curve.id) &&
      (c.type === "length" || c.type === "midpoint" || c.type === "equal")
    );
  });
}

export function trimSketch(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  entityId: string,
  at: XY,
): SketchModification {
  const curve = curveIn(entities, entityId);
  if (curve.external)
    throw new Error(
      "Projected references cannot be trimmed. Draw a curve constrained to the reference instead.",
    );
  const { from, to } = trimPiece(entities, entityId, at);
  const points: SketchEntity[] = [];
  const added: SketchConstraint[] = [];
  const end = (hit: CurveHit) => {
    const id = newId("p");
    points.push({ id, kind: "point", x: hit.x, y: hit.y });
    const unique = new Map(
      hit.by.map((cutter) => {
        const c = onCutter(entities, id, hit, cutter);
        return [JSON.stringify({ ...c, id: "" }), c] as const;
      }),
    );
    added.push(...unique.values());
    return id;
  };
  const pieces = keptPieces(curve, from, to, end);
  if (pieces[1])
    added.push({
      id: newId("c"),
      type: curve.kind === "line" ? "collinear" : "equal",
      a: curve.id,
      b: pieces[1].id,
    });
  const rest = entities.flatMap((e) =>
    e.id !== curve.id ? [e] : pieces.slice(0, 1),
  );
  const next = [...rest, ...pieces.slice(1), ...points];
  const used = new Set(next.flatMap(pointsOf));
  const gone = new Set(pointsOf(curve).filter((id) => !used.has(id)));
  if (!pieces.length) gone.add(curve.id);
  const shortened = pieces.length > 0 && curve.kind === "line";
  const kept = survivingConstraints(constraints, curve, gone, shortened);
  return {
    entities: next.filter((e) => !gone.has(e.id)),
    constraints: [...kept, ...added],
    removedConstraints: constraints.length - kept.length,
  };
}
