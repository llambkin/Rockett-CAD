import {
  arcSweep,
  type Move,
  type Section,
  type Xy,
  type Xyz,
} from "../shared/ir.js";
import type { OffsetInput } from "../kernel/offset.js";
import type { RegionLoop, Segment } from "../kernel/regions.js";
import {
  PIECE,
  append,
  area,
  checkCut,
  checkMoves,
  depthLevels,
  gap,
  lines,
  offsetLoops,
  pass,
  pieces,
  startAt,
  type Cut,
  type Loop,
  type Motion,
} from "./geometry.js";

export type Offset = (input: OffsetInput) => RegionLoop[];

export type Tabs = { count: number; width: number; height: number };

export type ContourInput = Cut & {
  operationId: string;
  loop: RegionLoop | Loop;
  side: "outside" | "inside";
  direction: "climb" | "conventional";
  start: Xy;
  tabs?: Tabs;
};

type Piece = { from: Xy; segment: Segment; at: number; length: number };
type Range = { lo: number; hi: number };
type Span = Range & { lifted: number };
type Plan = { top: number; ramp: number; spans: [number, number][] };

const EPSILON = 1e-9;

function check(input: ContourInput) {
  checkCut("contour", input);
  if (!input.tool.centreCutting)
    throw new RangeError(
      `${input.tool.name} is not centre cutting and cannot plunge`,
    );
  const { tabs, stock, bottom } = input;
  if (!tabs) return;
  if (!(Number.isInteger(tabs.count) && tabs.count > 0))
    throw new RangeError("tab count must be a whole number above 0");
  if (!(tabs.width > 0)) throw new RangeError("tab width must be above 0");
  if (!(tabs.height > 0)) throw new RangeError("tab height must be above 0");
  const depth = stock.max[2] - bottom;
  if (tabs.height >= depth)
    throw new RangeError(
      `a ${tabs.height} mm tab reaches the stock top: the cut is only ${depth} mm deep`,
    );
}

function offset(input: ContourInput, run: Offset) {
  const { loop, side, tool } = input;
  const radius = tool.diameter / 2;
  const distance = side === "outside" ? radius : -radius;
  const found = Array.isArray(loop)
    ? offsetLoops([loop], distance).map(lines)
    : run({ loop, distance });
  const what = `${side} offset by the ${radius} mm tool radius`;
  if (!found.length)
    throw new RangeError(
      `${what} leaves no path: the loop is smaller than the tool`,
    );
  if (found.length > 1)
    throw new RangeError(
      `${what} splits into ${found.length} loops: the tool does not fit everywhere`,
    );
  const path = straightened(found[0]!);
  if (Math.abs(area(path)) < PIECE)
    throw new RangeError(
      `${what} leaves a path with no area: the loop is no wider than the tool`,
    );
  return path;
}

function minor(from: Xy, { to, centre, dir }: Segment & { kind: "arc" }) {
  const side =
    (to[0] - from[0]) * (centre[1] - from[1]) -
    (to[1] - from[1]) * (centre[0] - from[0]);
  return dir === "ccw" ? side > 0 : side < 0;
}

function straightened(loop: RegionLoop): RegionLoop {
  if (loop.segments.length === 1) return loop;
  const segments = [...pieces(loop)].map(({ from, segment }): Segment =>
    segment.kind === "arc" &&
    gap(from, segment.to) <= PIECE &&
    minor(from, segment)
      ? { kind: "line", to: segment.to }
      : segment,
  );
  return { start: loop.start, segments };
}

function reversed(loop: RegionLoop): RegionLoop {
  const segments = [...pieces(loop)]
    .toReversed()
    .map(({ from, segment }): Segment =>
      segment.kind === "line"
        ? { kind: "line", to: from }
        : { ...segment, to: from, dir: segment.dir === "ccw" ? "cw" : "ccw" },
    );
  return { start: loop.start, segments };
}

function oriented(loop: RegionLoop, { side, direction }: ContourInput) {
  const clockwise = (side === "outside") === (direction === "climb");
  return area(loop) < 0 === clockwise ? loop : reversed(loop);
}

function measured(loop: RegionLoop): Piece[] {
  const moves = pass(loop, 0, 1);
  let at = 0;
  return [...pieces(loop)].map(({ from, segment }, i) => {
    const move = moves[i]!;
    const length =
      move.kind === "arc"
        ? Math.hypot(move.centre[0] - from[0], move.centre[1] - from[1]) *
          arcSweep([...from, 0], move)
        : gap(from, segment.to);
    at += length;
    return { from, segment, at: at - length, length };
  });
}

const lengthOf = (path: Piece[]) => path.at(-1)!.at + path.at(-1)!.length;

function along({ from, segment, length }: Piece, t: number): Xy {
  if (t >= length) return segment.to;
  if (segment.kind === "line")
    return [
      from[0] + ((segment.to[0] - from[0]) * t) / length,
      from[1] + ((segment.to[1] - from[1]) * t) / length,
    ];
  const [cx, cy] = segment.centre;
  const radius = gap(from, segment.centre);
  const angle =
    Math.atan2(from[1] - cy, from[0] - cx) +
    (segment.dir === "ccw" ? t : -t) / radius;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

function stretch(path: Piece[], a: number, b: number): RegionLoop {
  let start: Xy | undefined;
  const segments: Segment[] = [];
  for (const piece of path) {
    const lo = Math.max(a - piece.at, 0);
    const hi = Math.min(b - piece.at, piece.length);
    if (hi <= lo) continue;
    start ??= along(piece, lo);
    const to = along(piece, hi);
    segments.push(
      piece.segment.kind === "arc" && hi - lo >= PIECE
        ? { ...piece.segment, to }
        : { kind: "line", to },
    );
  }
  return { start: start ?? path[0]!.from, segments };
}

function continues(a: Piece, b: Piece) {
  const [p, q] = [a.segment, b.segment];
  if (p.kind === "arc" || q.kind === "arc")
    return (
      p.kind === "arc" &&
      q.kind === "arc" &&
      p.dir === q.dir &&
      gap(p.centre, q.centre) <= EPSILON
    );
  const [ux, uy] = [p.to[0] - a.from[0], p.to[1] - a.from[1]];
  const [vx, vy] = [q.to[0] - b.from[0], q.to[1] - b.from[1]];
  return (
    Math.abs(ux * vy - uy * vx) <= EPSILON * a.length * b.length &&
    ux * vx + uy * vy > 0
  );
}

function liftedOn(first: Piece, width: number) {
  const { segment, from } = first;
  if (segment.kind === "line") return width;
  const radius = gap(from, segment.centre);
  return width <= 2 * radius
    ? 2 * radius * Math.asin(width / (2 * radius))
    : undefined;
}

function allowed(path: Piece[], width: number, radius: number, drop: number) {
  const length = lengthOf(path);
  const runs: { first: Piece; end: number }[] = [];
  for (const [i, piece] of path.entries()) {
    const run = runs.at(-1);
    if (run && continues(path[i - 1]!, piece))
      run.end = piece.at + piece.length;
    else runs.push({ first: piece, end: piece.at + piece.length });
  }
  return runs.flatMap(({ first, end }): Span[] => {
    const span = liftedOn(first, width);
    if (span === undefined) return [];
    const lo = first.at + radius + span / 2;
    const hi = Math.min(end - radius - span / 2, length - span / 2 - drop);
    return lo <= hi ? [{ lo, hi, lifted: span }] : [];
  });
}

function overlap(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  let [i, j] = [0, 0];
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i]!.lo, b[j]!.lo);
    const hi = Math.min(a[i]!.hi, b[j]!.hi);
    if (lo <= hi) out.push({ lo, hi });
    if (a[i]!.hi < b[j]!.hi) i++;
    else j++;
  }
  return out;
}

function planned(path: Piece[], input: ContourInput, tabs: Tabs): Plan {
  const { count, width, height } = tabs;
  const diameter = input.tool.diameter;
  const length = lengthOf(path);
  const spacing = length / count;
  if (spacing < width + 2 * diameter)
    throw new RangeError(
      `${count} tabs do not fit on the ${Number(length.toFixed(3))} mm path: each lifts over its ${width} mm width plus the ${diameter} mm tool diameter, then ramps down over another tool diameter`,
    );
  const spans = allowed(path, width + diameter, diameter / 2, diameter);
  let phases: Range[] = [{ lo: 0, hi: spacing }];
  for (let i = 0; i < count; i++)
    phases = overlap(
      phases,
      spans.map(({ lo, hi }) => ({
        lo: lo - i * spacing,
        hi: hi - i * spacing,
      })),
    );
  const widest = phases.reduce<Range | undefined>(
    (best, span) =>
      best && best.hi - best.lo >= span.hi - span.lo ? best : span,
    undefined,
  );
  const fail = () =>
    new RangeError(
      `${count} evenly spaced tabs do not fit: each lifted span must lie on one line or arc of the path, ${diameter / 2} mm clear of every corner and of the start point`,
    );
  if (!widest) throw fail();
  const phase = (widest.lo + widest.hi) / 2;
  const placed = Array.from({ length: count }, (_, i): [number, number] => {
    const centre = phase + i * spacing;
    const off = (span: Span) => Math.max(span.lo - centre, 0, centre - span.hi);
    const { lifted: span } = spans.reduce((a, b) => (off(b) < off(a) ? b : a));
    return [centre - span / 2, centre + span / 2];
  });
  for (const [i, [, end]] of placed.entries())
    if (end + diameter > (placed[i + 1]?.[0] ?? length) + EPSILON) throw fail();
  return { top: input.bottom + height, ramp: diameter, spans: placed };
}

function ramp(loop: RegionLoop, from: number, to: number, feed: number) {
  const parts = measured(loop);
  const total = lengthOf(parts);
  return parts.flatMap(({ at, length, segment }, i) => {
    const z =
      i + 1 === parts.length
        ? to
        : from + ((to - from) * (at + length)) / total;
    const moves = pass({ start: loop.start, segments: [segment] }, z, feed);
    for (const move of moves) if (move.kind !== "rapid") move.role = "plunge";
    return moves;
  });
}

function tabbed(
  path: Piece[],
  z: number,
  above: number,
  { top, ramp: run, spans }: Plan,
  { cutFeed, rampFeed }: ContourInput["preset"],
): Motion[] {
  const length = lengthOf(path);
  const moves: Motion[] = [];
  const vertical = (loop: RegionLoop, height: number): Motion => ({
    kind: "feed",
    to: [...(loop.segments.at(-1)?.to ?? loop.start), height],
    feed: cutFeed,
    role: "link",
  });
  let s = 0;
  for (const [start, end] of spans) {
    const before = stretch(path, s, start);
    const over = stretch(path, start, end);
    const down = stretch(path, end, end + run);
    const from = Math.min(above, top);
    moves.push(
      ...pass(before, z, cutFeed),
      vertical(before, top),
      ...pass(over, top, cutFeed),
      ...(from < top ? [vertical(over, from)] : []),
      ...ramp(down, from, z, rampFeed),
      ...pass(reversed(down), z, cutFeed),
    );
    s = end;
  }
  return [...moves, ...pass(stretch(path, s, length), z, cutFeed)];
}

export function contour(input: ContourInput, run: Offset): Section {
  check(input);
  const { setup, stock, tool, preset } = input;
  const top = stock.max[2];
  const levels = depthLevels(top, input.bottom, preset.stepdown);
  const loop = startAt(oriented(offset(input, run), input), input.start);
  const path = measured(loop);
  const plan = input.tabs && planned(path, input, input.tabs);
  const [x, y] = loop.start;
  const above = (height: number): Xyz => [x, y, top + height];
  const moves: Move[] = [
    { kind: "rapid", to: above(setup.safeHeight) },
    { kind: "rapid", to: above(setup.clearance) },
  ];
  for (const [i, z] of levels.entries()) {
    moves.push({
      kind: "feed",
      to: [x, y, z],
      feed: preset.plungeFeed,
      role: "plunge",
    });
    append(
      moves,
      plan && z < plan.top
        ? tabbed(path, z, levels[i - 1] ?? top, plan, preset)
        : pass(loop, z, preset.cutFeed),
    );
    checkMoves(
      `contour at depth level ${i + 1} of ${levels.length}`,
      moves.length,
    );
  }
  moves.push({ kind: "rapid", to: above(setup.safeHeight) });
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "finish",
    spindle: { rpm: preset.rpm, dir: "cw" },
    coolant: preset.coolant,
    moves,
  };
}
