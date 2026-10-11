import {
  EndType,
  FillRule,
  JoinType,
  PointInPolygonResult,
  difference,
  inflatePaths,
  intersect,
  pointInPolygon,
  union,
  type Paths64,
} from "clipper2-ts";
import type { RegionLoop, Segment } from "../kernel/regions.js";
import {
  arcStep,
  arcSweep,
  type Move,
  type Xy,
  type Xyz,
} from "../shared/ir.js";
import { toolRefusal } from "../shared/operations.js";
import type { Box, Setup } from "../shared/setup.js";
import {
  validatePreset,
  validateTool,
  type Preset,
  type Tool,
} from "../shared/tools.js";

export type Loop = { x: number; y: number }[];

export type Motion = Extract<Move, { to: Xyz }>;

export type Cut = {
  setup: Pick<Setup, "safeHeight" | "clearance">;
  stock: Box;
  bottom: number;
  tool: Tool;
  preset: Preset;
};

const UNITS_PER_MM = 10_000;
const EPSILON = 1e-9;
const ARC_TOLERANCE = 0.0005;
const MITER_LIMIT = 2;
const STEPDOWN = 0.01;
const STEPOVER = 0.05;
const MOVES = 1_000_000;
export const PIECE = 1e-3;

export function checkMoves(what: string, count: number) {
  if (count > MOVES)
    throw new RangeError(
      `${what} passes the limit of ${MOVES.toLocaleString("en")} moves`,
    );
}

export function append<T>(out: T[], items: readonly T[]) {
  for (const item of items) out.push(item);
}

export function steps(length: number, step: number): number {
  return Math.max(1, Math.ceil(length / step - EPSILON));
}

export function depthLevels(
  top: number,
  bottom: number,
  stepdown: number,
): number[] {
  if (!(top > bottom))
    throw new RangeError("stock top must be above the cut depth");
  if (!(stepdown >= STEPDOWN))
    throw new RangeError(`stepdown must be at least ${STEPDOWN} mm`);
  const count = steps(top - bottom, stepdown);
  return Array.from({ length: count }, (_, i) =>
    i + 1 < count ? top - (i + 1) * stepdown : bottom,
  );
}

function toClipper(loops: Loop[]): Paths64 {
  return loops.map((loop) =>
    loop.map(({ x, y }) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new RangeError(`loop point (${x}, ${y}) is not finite`);
      }
      return {
        x: Math.round(x * UNITS_PER_MM),
        y: Math.round(y * UNITS_PER_MM),
      };
    }),
  );
}

function fromClipper(paths: Paths64): Loop[] {
  return paths.map((path) =>
    path.map(({ x, y }) => ({ x: x / UNITS_PER_MM, y: y / UNITS_PER_MM })),
  );
}

function inflated(
  loops: Loop[],
  distance: number,
  end: EndType,
  tolerance = ARC_TOLERANCE,
): Loop[] {
  return fromClipper(
    inflatePaths(
      toClipper(loops),
      distance * UNITS_PER_MM,
      JoinType.Round,
      end,
      MITER_LIMIT,
      tolerance * UNITS_PER_MM,
    ),
  );
}

export function offsetLoops(
  loops: Loop[],
  distance: number,
  tolerance = ARC_TOLERANCE,
): Loop[] {
  return inflated(loops, distance, EndType.Polygon, tolerance);
}

export function bandOf(loop: Loop, radius: number): Loop[] {
  return inflated([loop], radius, EndType.Joined);
}

export function swathOf(path: Loop, radius: number): Loop[] {
  return inflated([path], radius, EndType.Round);
}

export function subtractLoops(subject: Loop[], clip: Loop[]): Loop[] {
  return fromClipper(
    difference(toClipper(subject), toClipper(clip), FillRule.NonZero),
  );
}

export function unionLoops(loops: Loop[]): Loop[] {
  return fromClipper(union(toClipper(loops), FillRule.NonZero));
}

export function intersectLoops(subject: Loop[], clip: Loop[]): Loop[] {
  return fromClipper(
    intersect(toClipper(subject), toClipper(clip), FillRule.NonZero),
  );
}

export function covers(outer: Loop[], inner: Loop[]): boolean {
  return subtractLoops(inner, outer).length === 0;
}

const SIDES = 64;

export function disc([x, y]: Xy, radius: number): Loop {
  const reach = radius / Math.cos(Math.PI / SIDES) + 1 / UNITS_PER_MM;
  return Array.from({ length: SIDES }, (_, i) => {
    const angle = (2 * Math.PI * i) / SIDES;
    return { x: x + reach * Math.cos(angle), y: y + reach * Math.sin(angle) };
  });
}

function signedArea(loop: Loop): number {
  return loop.reduce((twice, a, i) => {
    const b = loop[(i + 1) % loop.length]!;
    return twice + a.x * b.y - b.x * a.y;
  }, 0);
}

export function components(loops: Loop[]): Loop[][] {
  const outers = loops.filter((loop) => signedArea(loop) > 0);
  const paths = toClipper(outers);
  const groups = outers.map((outer) => [outer]);
  for (const hole of loops.filter((loop) => signedArea(loop) <= 0)) {
    const point = toClipper([hole])[0]![0]!;
    const index = paths.findIndex(
      (path) => pointInPolygon(point, path) !== PointInPolygonResult.IsOutside,
    );
    groups[index]?.push(hole);
  }
  return groups;
}

export function checkCut(operation: string, cut: Cut) {
  const { setup, stock, bottom, tool, preset } = cut;
  const problems = [...validateTool(tool), ...validatePreset(preset)];
  if (problems.length) throw new RangeError(problems.join("; "));
  const refusal = toolRefusal(`rockett.cam.${operation}`, tool.kind);
  if (refusal) throw new RangeError(refusal);
  if (!(setup.clearance > 0 && setup.safeHeight >= setup.clearance))
    throw new RangeError(
      "clearance must be above 0 and safe height at least the clearance",
    );
  const depth = stock.max[2] - bottom;
  if (depth > tool.fluteLength)
    throw new RangeError(
      `a ${depth} mm deep cut is past the ${tool.fluteLength} mm flute length of ${tool.name}`,
    );
}

export function stepoverOf({ stepoverFraction }: Preset, tool: Tool): number {
  if (!(stepoverFraction >= STEPOVER && stepoverFraction <= 1))
    throw new RangeError(
      `stepover fraction must be at least ${STEPOVER} and at most 1`,
    );
  return stepoverFraction * tool.diameter;
}

export const gap = (a: Xy, b: Xy) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function sweep(from: Xy, to: Xy, centre: Xy, dir: "cw" | "ccw") {
  return arcSweep([...from, 0], {
    kind: "arc",
    to: [...to, 0],
    centre: [...centre, 0],
    dir,
    plane: "xy",
    feed: 1,
    role: "cut",
  });
}

export function chorded(loop: RegionLoop): Loop {
  const points: Loop = [{ x: loop.start[0], y: loop.start[1] }];
  for (const { from, segment } of pieces(loop)) {
    if (segment.kind === "arc") {
      const [cx, cy] = segment.centre;
      const radius = gap(from, segment.centre);
      const turn = sweep(from, segment.to, segment.centre, segment.dir);
      const count = steps(turn, arcStep(radius, ARC_TOLERANCE));
      const begin = Math.atan2(from[1] - cy, from[0] - cx);
      const sign = segment.dir === "ccw" ? 1 : -1;
      for (let i = 1; i < count; i++) {
        const angle = begin + (sign * turn * i) / count;
        points.push({
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        });
      }
    }
    points.push({ x: segment.to[0], y: segment.to[1] });
  }
  return points.slice(0, -1);
}

export function lines(loop: Loop): RegionLoop {
  const points = loop.map(({ x, y }): Xy => [x, y]);
  return {
    start: points[0]!,
    segments: [...points.slice(1), points[0]!].map((to) => ({
      kind: "line",
      to,
    })),
  };
}

export function* pieces({ start, segments }: RegionLoop) {
  let from = start;
  for (const segment of segments) {
    yield { from, segment };
    from = segment.to;
  }
}

export function area(loop: RegionLoop) {
  let twice = 0;
  for (const { from, segment } of pieces(loop)) {
    const [x, y] = segment.to;
    if (segment.kind === "line") {
      twice += from[0] * y - x * from[1];
      continue;
    }
    const [cx, cy] = segment.centre;
    const turn = sweep(from, segment.to, segment.centre, segment.dir);
    twice +=
      cx * (y - from[1]) -
      cy * (x - from[0]) +
      gap(from, segment.centre) ** 2 * (segment.dir === "ccw" ? turn : -turn);
  }
  return twice / 2;
}

function nearest(p: Xy, from: Xy, segment: Segment): Xy {
  const to = segment.to;
  if (segment.kind === "line") {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    const length = Math.hypot(dx, dy);
    const along = (p[0] - from[0]) * dx + (p[1] - from[1]) * dy;
    if (!length || along <= 0) return from;
    if (along >= length * length) return to;
    const [nx, ny] = [-dy / length, dx / length];
    const off = (p[0] - from[0]) * nx + (p[1] - from[1]) * ny;
    return [p[0] - off * nx, p[1] - off * ny];
  }
  const [cx, cy] = segment.centre;
  const radius = gap(from, segment.centre);
  const angle = Math.atan2(p[1] - cy, p[0] - cx);
  const on: Xy = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  if (
    sweep(from, on, segment.centre, segment.dir) <=
    sweep(from, to, segment.centre, segment.dir)
  )
    return on;
  return gap(p, from) <= gap(p, to) ? from : to;
}

export function startAt(loop: RegionLoop, p: Xy): RegionLoop {
  const all = [...pieces(loop)].map((piece) => ({
    ...piece,
    at: nearest(p, piece.from, piece.segment),
  }));
  const best = all.reduce((a, b) => (gap(p, b.at) < gap(p, a.at) ? b : a));
  const index = all.indexOf(best);
  const { from, segment, at } = best;
  const { segments } = loop;
  if (gap(at, from) > PIECE && gap(at, segment.to) > PIECE)
    return {
      start: at,
      segments: [
        segment,
        ...segments.slice(index + 1),
        ...segments.slice(0, index),
        { ...segment, to: at },
      ],
    };
  const first =
    (gap(at, from) <= gap(at, segment.to) ? index : index + 1) %
    segments.length;
  return {
    start: all[first]!.from,
    segments: [...segments.slice(first), ...segments.slice(0, first)],
  };
}

export function pass(loop: RegionLoop, z: number, feed: number): Motion[] {
  return loop.segments.map((segment): Motion =>
    segment.kind === "line"
      ? { kind: "feed", to: [...segment.to, z], feed, role: "cut" }
      : {
          kind: "arc",
          to: [...segment.to, z],
          centre: [...segment.centre, z],
          dir: segment.dir,
          plane: "xy",
          feed,
          role: "cut",
        },
  );
}
