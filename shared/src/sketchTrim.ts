import {
  newId,
  type SketchConstraint,
  type SketchEllipse,
  type SketchEntity,
  type SketchPoint,
  type SketchFitSpline,
  type SketchSpline,
} from "./model.js";
import {
  CONTACT_UNSUPPORTED,
  refuseUnsupported,
  unsupported,
} from "./curveLimits.js";
import { curveHits, type CurveHit } from "./profiles.js";
import { arcAngles, entityPointIds, sampleArc } from "./sketchCurves.js";
import type { SketchModification } from "./sketchModify.js";
import { constraintEntityRefs } from "./sketchTransform.js";

type XY = { x: number; y: number };
type Curve = Exclude<
  SketchEntity,
  SketchPoint | SketchEllipse | SketchSpline | SketchFitSpline
>;

export interface TrimTarget {
  entityId: string;
  at: XY;
}

export interface TrimPiece extends TrimTarget {
  from: CurveHit | null;
  to: CurveHit | null;
  samples: number[];
}

const TAU = Math.PI * 2;
const ON_POINT = 1e-4;
const SEGMENTS = 32;
const hitCache = new WeakMap<SketchEntity[], Map<string, CurveHit[]>>();

const pointsOf = entityPointIds;

function hitMap(entities: SketchEntity[]): Map<string, CurveHit[]> {
  let hits = hitCache.get(entities);
  if (!hits) {
    const owned = new Set(entities.flatMap(pointsOf));
    const loose = entities.filter(
      (e): e is SketchPoint => e.kind === "point" && !owned.has(e.id),
    );
    const cutters = entities.map((e) =>
      e.kind === "point" ? e : { ...e, construction: false },
    );
    hits = curveHits(cutters, loose);
    hitCache.set(entities, hits);
  }
  return hits;
}

function hitsOn(entities: SketchEntity[], curve: Curve): CurveHit[] {
  const found = hitMap(entities).get(curve.id);
  if (!found) throw new Error(CONTACT_UNSUPPORTED);
  return found;
}

export function trimmable(
  entities: SketchEntity[],
  e: SketchEntity | undefined,
): e is Curve {
  return (
    !!e &&
    e.kind !== "point" &&
    !unsupported(e) &&
    !e.external &&
    hitMap(entities).has(e.id)
  );
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
  refuseUnsupported(curve);
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
  return { entityId, at, from, to, samples: g.samples(from, to) };
}

export function trimPieces(
  entities: SketchEntity[],
  targets: TrimTarget[],
): TrimPiece[] {
  const pieces = new Map<string, TrimPiece>();
  for (const { entityId, at } of targets) {
    if (curveIn(entities, entityId).external) continue;
    const piece = trimPiece(entities, entityId, at);
    const key = `${entityId} ${piece.from?.t} ${piece.to?.t}`;
    if (!pieces.has(key)) pieces.set(key, piece);
  }
  return [...pieces.values()];
}

function onCutter(
  entities: SketchEntity[],
  point: string,
  hit: CurveHit,
  cutterId: string,
): SketchConstraint {
  const cutter = entities.find((e) => e.id === cutterId);
  if (!cutter) throw new Error("Sketch cutter is missing.");
  const id = newId("c");
  if (cutter.kind === "point")
    return { id, type: "coincident", a: point, b: cutter.id };
  const meet = pointsOf(cutter).find((end) => {
    const p = pointIn(entities, end);
    return Math.hypot(p.x - hit.x, p.y - hit.y) < ON_POINT;
  });
  if (meet) return { id, type: "coincident", a: point, b: meet };
  return cutter.kind === "line"
    ? { id, type: "pointOnLine", point, line: cutter.id }
    : { id, type: "pointOnCircle", point, circle: cutter.id };
}

function cutsAt(
  entities: SketchEntity[],
  curve: Curve,
  cutterId: string,
  hit: CurveHit,
): boolean {
  const cutter = entities.find((e) => e.id === cutterId);
  if (!cutter || cutter.kind === "point") return true;
  const pair = [curve, cutter].flatMap((e) => [
    ...pointsOf(e).map((id) => pointIn(entities, id)),
    { ...e, construction: false },
  ]);
  return (curveHits(pair).get(curve.id) ?? []).some(
    (h) => Math.hypot(h.x - hit.x, h.y - hit.y) < ON_POINT,
  );
}

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

function middle({ samples }: TrimPiece): XY {
  const i = (samples.length / 2 - 1) / 2;
  const [a, b] = [Math.floor(i) * 2, Math.ceil(i) * 2];
  return {
    x: (samples[a]! + samples[b]!) / 2,
    y: (samples[a + 1]! + samples[b + 1]!) / 2,
  };
}

function cutNow(
  entities: SketchEntity[],
  curve: Curve,
  hit: CurveHit | null,
  end: string | undefined,
): CurveHit | null {
  if (!hit) return null;
  const near = (q: XY) => Math.hypot(q.x - hit.x, q.y - hit.y) < ON_POINT;
  if (end && near(pointIn(entities, end))) return null;
  return hitsOn(entities, curve).find(near) ?? { ...hit, by: [] };
}

export function trimSketchPieces(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  targets: TrimTarget[],
): SketchModification {
  let rest = trimPieces(entities, targets);
  if (targets.length && !rest.length)
    throw new Error(
      "Projected references cannot be trimmed. Draw a curve constrained to the reference instead.",
    );
  let sketch = { entities, constraints };
  while (rest.length) {
    const curve = curveIn(sketch.entities, rest[0]!.entityId);
    const { param } = shape(sketch.entities, curve);
    const piece = rest
      .filter((p) => p.entityId === curve.id)
      .reduce((a, b) => (param(middle(b)) > param(middle(a)) ? b : a));
    rest = rest.filter((p) => p !== piece);
    const [first, last] =
      curve.kind === "line"
        ? [curve.p1, curve.p2]
        : curve.kind === "arc"
          ? [curve.start, curve.end]
          : [];
    sketch = cut(
      sketch.entities,
      sketch.constraints,
      curve,
      cutNow(sketch.entities, curve, piece.from, first),
      cutNow(sketch.entities, curve, piece.to, last),
    );
  }
  const kept = new Set(sketch.constraints.map((c) => c.id));
  return {
    ...sketch,
    removedConstraints: constraints.filter((c) => !kept.has(c.id)).length,
  };
}

export function trimSketch(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  entityId: string,
  at: XY,
): SketchModification {
  return trimSketchPieces(entities, constraints, [{ entityId, at }]);
}

function cut(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  curve: Curve,
  from: CurveHit | null,
  to: CurveHit | null,
): { entities: SketchEntity[]; constraints: SketchConstraint[] } {
  const points: SketchEntity[] = [];
  const added: SketchConstraint[] = [];
  const end = (hit: CurveHit) => {
    const id = newId("p");
    points.push({ id, kind: "point", x: hit.x, y: hit.y });
    const unique = new Map(
      hit.by
        .filter((cutter) => cutsAt(entities, curve, cutter, hit))
        .map((cutter) => {
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
  return {
    entities: next.filter((e) => !gone.has(e.id)),
    constraints: [
      ...survivingConstraints(constraints, curve, gone, shortened),
      ...added,
    ],
  };
}
