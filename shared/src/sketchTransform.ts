import {
  newId,
  normalizeDegrees,
  type ParameterBinding,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type SketchPoint,
} from "./model.js";
import { ValidationError } from "./schema/index.js";
import { curveSamples, entityPointIds, sketchCurves } from "./sketchCurves.js";
import type { SketchModification } from "./sketchModify.js";
import { LINEAR_TOL } from "./tolerance.js";

type XY = { x: number; y: number };

const REF_KEYS = ["a", "b", "point", "line", "circle", "entity"] as const;

export const constraintEntityRefs = (c: SketchConstraint): string[] =>
  REF_KEYS.map((k) => (c as unknown as Record<string, unknown>)[k]).filter(
    (x): x is string => typeof x === "string",
  );

function renamedConstraint(
  c: SketchConstraint,
  ids: ReadonlyMap<string, string>,
): SketchConstraint {
  const out: Record<string, unknown> = { ...c, id: newId("c") };
  for (const key of REF_KEYS) {
    const ref = out[key];
    if (typeof ref === "string") out[key] = ids.get(ref) ?? ref;
  }
  return out as unknown as SketchConstraint;
}

export interface SketchMove {
  dx: number;
  dy: number;
  angle: number;
  pivot: XY | null;
  copy: boolean;
  bound: readonly string[];
}

const BOUND_VALUE = /^\/constraints\/(0|[1-9][0-9]*)\/value$/;

export const boundConstraintIds = (
  bindings: readonly ParameterBinding[],
  sketch: SketchFeature,
): string[] =>
  bindings.flatMap((b) => {
    const at = b.featureId === sketch.id && BOUND_VALUE.exec(b.path);
    const id = at ? sketch.constraints[Number(at[1])]?.id : undefined;
    return id ? [id] : [];
  });

export class FixedEntityError extends ValidationError {
  constructor(
    readonly entityId: string,
    readonly reason: "fixed" | "reference",
  ) {
    super(
      reason === "fixed"
        ? "Fixed geometry cannot move. Remove its Fix, or use Copy."
        : "Projected and offset geometry cannot move. Use Copy.",
    );
  }
}

function boxCentre(group: SketchEntity[]): XY {
  const coords = sketchCurves(group, true).flatMap((c) => curveSamples(c));
  for (const e of group) if (e.kind === "point") coords.push(e.x, e.y);
  const mid = (odd: number) => {
    const v = coords.filter((_, i) => i % 2 === odd);
    const low = v.reduce((a, b) => Math.min(a, b), Infinity);
    return (low + v.reduce((a, b) => Math.max(a, b), -Infinity)) / 2;
  };
  return { x: mid(0), y: mid(1) };
}

function refuseFixed(
  selected: SketchEntity[],
  entities: SketchEntity[],
  constraints: SketchConstraint[],
) {
  const fixed = new Set(
    constraints.flatMap((c) => (c.type === "fix" ? [c.point] : [])),
  );
  const external = new Set(
    entities.flatMap((e) => (e.kind === "point" && e.external ? [e.id] : [])),
  );
  for (const e of selected) {
    const own = [e.id, ...entityPointIds(e)];
    if (own.some((id) => fixed.has(id)))
      throw new FixedEntityError(e.id, "fixed");
    if (e.external || own.some((id) => external.has(id)))
      throw new FixedEntityError(e.id, "reference");
  }
}

const valueOf = (c: SketchConstraint) => ("value" in c ? c.value : undefined);

interface Placement {
  at: (p: XY) => XY;
  turn: (degrees: number) => number;
  flip: boolean;
}

function rigid(angle: number, pivot: XY, dx = 0, dy = 0): Placement {
  const t = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(t), Math.sin(t)];
  return {
    at: ({ x, y }) => {
      const [u, v] = [x - pivot.x, y - pivot.y];
      return {
        x: pivot.x + u * cos - v * sin + dx,
        y: pivot.y + u * sin + v * cos + dy,
      };
    },
    turn: (d) => d + angle,
    flip: false,
  };
}

function reflection([a, b]: [XY, XY]): Placement {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const [ux, uy] = [(b.x - a.x) / length, (b.y - a.y) / length];
  const twice = (Math.atan2(uy, ux) * 360) / Math.PI;
  return {
    at: ({ x, y }) => {
      const [u, v] = [x - a.x, y - a.y];
      const s = 2 * (u * ux + v * uy);
      return { x: a.x + s * ux - u, y: a.y + s * uy - v };
    },
    turn: (d) => twice - d,
    flip: true,
  };
}

function turned(
  c: SketchConstraint,
  p: Placement,
  direction: (line: string) => number,
): SketchConstraint | null {
  const angle = p.turn(0);
  if (!p.flip && normalizeDegrees(angle) === 0) return c;
  const quarter = Math.round(angle / 90);
  const square = Math.abs(angle - quarter * 90) < 1e-9;
  const odd = square && quarter % 2 !== 0;
  if (c.type === "horizontal" || c.type === "vertical") {
    if (!square)
      return {
        id: c.id,
        type: "lineAngle",
        line: c.line,
        value: direction(c.line),
      };
    if (!odd) return c;
    return { ...c, type: c.type === "horizontal" ? "vertical" : "horizontal" };
  }
  if (c.type === "lineAngle") {
    const off = c.axis === "y" ? 90 : 0;
    return { ...c, value: normalizeDegrees(p.turn(c.value + off) - off) };
  }
  if (c.type !== "distance" || !c.axis) return c;
  if (!square) return null;
  return odd ? { ...c, axis: c.axis === "x" ? "y" : "x" } : c;
}

function renamed(
  e: SketchEntity,
  ids: ReadonlyMap<string, string>,
): SketchEntity {
  const to = (id: string) => ids.get(id) ?? id;
  switch (e.kind) {
    case "point":
      return e;
    case "line":
      return { ...e, p1: to(e.p1), p2: to(e.p2) };
    case "circle":
      return { ...e, center: to(e.center) };
    case "arc":
      return { ...e, center: to(e.center), start: to(e.start), end: to(e.end) };
    case "ellipse":
      return {
        ...e,
        center: to(e.center),
        major: to(e.major),
        minor: to(e.minor),
        ...(e.start && { start: to(e.start) }),
        ...(e.end && { end: to(e.end) }),
      };
    case "spline":
      return { ...e, poles: e.poles.map(to) };
    case "fitSpline":
      return {
        ...e,
        points: e.points.map(to),
        handles: [to(e.handles[0]), to(e.handles[1])],
      };
  }
}

function copied(
  e: SketchEntity,
  ids: ReadonlyMap<string, string>,
  flip: boolean,
) {
  const copy = { ...renamed(e, ids), id: ids.get(e.id)! };
  delete copy.external;
  if (copy.kind !== "point") delete copy.projection;
  if ((copy.kind === "arc" || copy.kind === "ellipse") && flip) {
    const { start, end } = copy;
    if (start && end) Object.assign(copy, { start: end, end: start });
  }
  return copy;
}

function detached(
  entities: SketchEntity[],
  moving: ReadonlySet<string>,
): SketchEntity[] {
  const fresh = new Map<string, string>();
  const added: SketchPoint[] = [];
  const kept = entities.map((e) => {
    const shared = entityPointIds(e).filter((id) => moving.has(id));
    if (moving.has(e.id) || !shared.length) return e;
    for (const id of shared)
      if (!fresh.has(id)) {
        const point = entities.find((p) => p.id === id) as SketchPoint;
        added.push({ ...point, id: newId("pt") });
        fresh.set(id, added.at(-1)!.id);
      }
    return renamed(e, fresh);
  });
  return [...kept, ...added];
}

function selectionGroup(entities: SketchEntity[], ids: readonly string[]) {
  const chosen = new Set(ids);
  const selected = entities.filter((e) => chosen.has(e.id));
  if (!selected.length) throw new Error("Select sketch geometry.");
  const moving = new Set(selected.flatMap(entityPointIds));
  for (const e of selected) moving.add(e.id);
  return { selected, moving, group: entities.filter((e) => moving.has(e.id)) };
}

function placedGroup(group: SketchEntity[], p: Placement) {
  const placed = new Map(
    group.map((e): [string, SketchEntity] => [
      e.id,
      e.kind === "point" ? { ...e, ...p.at(e) } : e,
    ]),
  );
  const direction = (line: string) => {
    const l = placed.get(line);
    const [a, b] =
      l?.kind === "line" ? [placed.get(l.p1), placed.get(l.p2)] : [];
    if (a?.kind !== "point" || b?.kind !== "point") return 0;
    return normalizeDegrees((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  };
  return { placed, direction };
}

function copies(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  ids: readonly string[],
  placements: readonly Placement[],
): SketchModification {
  const { moving, group } = selectionGroup(entities, ids);
  const left = new Set<string>();
  const added: SketchEntity[] = [];
  const carried: SketchConstraint[] = [];
  for (const p of placements) {
    const { placed, direction } = placedGroup(group, p);
    const copyIds = new Map(group.map((e) => [e.id, newId(e.kind)]));
    added.push(...group.map((e) => copied(placed.get(e.id)!, copyIds, p.flip)));
    for (const c of constraints) {
      const refs = constraintEntityRefs(c);
      const inside = refs.filter((r) => moving.has(r)).length;
      if (!inside) continue;
      const next = inside === refs.length ? turned(c, p, direction) : null;
      if (!next) left.add(c.id);
      else if (next.type !== "fix")
        carried.push(renamedConstraint(next, copyIds));
    }
  }
  return {
    entities: [...entities, ...added],
    constraints: [...constraints, ...carried],
    removedConstraints: left.size,
  };
}

export function moveSketchSelection(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  ids: readonly string[],
  move: SketchMove,
): SketchModification {
  const { selected, moving, group } = selectionGroup(entities, ids);
  if (![move.dx, move.dy, move.angle].every(Number.isFinite))
    throw new Error("Enter a number for each distance and the angle.");
  const pivot = move.pivot ?? boxCentre(group);
  const p = rigid(move.angle, pivot, move.dx, move.dy);
  if (move.copy) return copies(entities, constraints, ids, [p]);
  refuseFixed(selected, entities, constraints);
  const { placed, direction } = placedGroup(group, p);
  const bound = new Set(move.bound);
  let removed = 0;
  const kept: SketchConstraint[] = [];
  for (const c of constraints) {
    const refs = constraintEntityRefs(c);
    const inside = refs.filter((r) => moving.has(r)).length;
    let next =
      inside > 0 && inside === refs.length ? turned(c, p, direction) : null;
    if (next && bound.has(c.id) && valueOf(next) !== valueOf(c)) next = null;
    if (inside === 0) kept.push(c);
    else if (next) kept.push(next);
    else removed++;
  }
  return {
    entities: detached(entities, moving).map((e) => placed.get(e.id) ?? e),
    constraints: kept,
    removedConstraints: removed,
  };
}

export interface PatternDirection {
  axis: "x" | "y" | { line: string };
  count: number;
  spacing: number;
}

export type SketchCopy =
  | { kind: "mirror"; line: string }
  | { kind: "rect"; first: PatternDirection; second: PatternDirection | null }
  | { kind: "circ"; centre: XY; count: number; angle: number };

const MAX_COPIES = 500;

function lineEnds(entities: SketchEntity[], id: string): [XY, XY] {
  const line = entities.find((e) => e.id === id);
  const [a, b] =
    line?.kind === "line"
      ? [line.p1, line.p2].map((p) => entities.find((e) => e.id === p))
      : [];
  if (a?.kind !== "point" || b?.kind !== "point")
    throw new Error("Pick a sketch line.");
  if (Math.hypot(b.x - a.x, b.y - a.y) < LINEAR_TOL)
    throw new Error("The picked line has no length.");
  return [a, b];
}

function unit(entities: SketchEntity[], axis: PatternDirection["axis"]): XY {
  if (axis === "x") return { x: 1, y: 0 };
  if (axis === "y") return { x: 0, y: 1 };
  const [a, b] = lineEnds(entities, axis.line);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function quantity(...counts: number[]): number {
  if (!counts.every((n) => Number.isInteger(n) && n >= 1))
    throw new Error("Enter a whole number of 1 or more for each quantity.");
  const total = counts.reduce((a, b) => a * b, 1) - 1;
  if (total < 1) throw new Error("Set a quantity above 1.");
  if (total > MAX_COPIES)
    throw new Error(`Patterns make at most ${MAX_COPIES} copies.`);
  return total;
}

function rectPlacements(
  entities: SketchEntity[],
  pattern: Extract<SketchCopy, { kind: "rect" }>,
): Placement[] {
  const dirs = [
    pattern.first,
    pattern.second ?? { ...pattern.first, count: 1 },
  ];
  if (!dirs.every((d) => Number.isFinite(d.spacing)))
    throw new Error("Enter a number for each spacing.");
  quantity(...dirs.map((d) => d.count));
  const [u, v] = dirs.map((d) => unit(entities, d.axis));
  const [one, two] = dirs;
  const out: Placement[] = [];
  for (let j = 0; j < two!.count; j++)
    for (let i = 0; i < one!.count; i++) {
      if (!i && !j) continue;
      const [s, t] = [i * one!.spacing, j * two!.spacing];
      out.push(
        rigid(0, { x: 0, y: 0 }, s * u!.x + t * v!.x, s * u!.y + t * v!.y),
      );
    }
  return out;
}

function circPlacements(
  pattern: Extract<SketchCopy, { kind: "circ" }>,
): Placement[] {
  if (!Number.isFinite(pattern.angle))
    throw new Error("Enter a number for the total angle.");
  const total = quantity(pattern.count);
  const full = Math.abs(Math.abs(pattern.angle) - 360) < 1e-9;
  const step = pattern.angle / (full ? pattern.count : total);
  return Array.from({ length: total }, (_, k) =>
    rigid((k + 1) * step, pattern.centre),
  );
}

export function copySketchSelection(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  ids: readonly string[],
  pattern: SketchCopy,
): SketchModification {
  switch (pattern.kind) {
    case "mirror":
      return copies(
        entities,
        constraints,
        ids.filter((id) => id !== pattern.line),
        [reflection(lineEnds(entities, pattern.line))],
      );
    case "rect":
      return copies(
        entities,
        constraints,
        ids,
        rectPlacements(entities, pattern),
      );
    case "circ":
      return copies(entities, constraints, ids, circPlacements(pattern));
  }
}
