import type { Coolant, Tool } from "./tools.js";

export type Xyz = [number, number, number];
export type Xy = [number, number];
export type Role = "cut" | "plunge" | "link";
export type Plane = "xy" | "zx" | "yz";

export type Arc = {
  kind: "arc";
  to: Xyz;
  centre: Xyz;
  dir: "cw" | "ccw";
  plane: Plane;
  feed: number;
  role: Role;
  power?: number;
};

export type Cycle = {
  kind: "cycle";
  points: Xy[];
  clear: number;
  top: number;
  bottom: number;
  dwell?: number;
  feed: number;
} & ({ cycle: "drill" } | { cycle: "peck"; peck: number });

export type Move =
  | { kind: "rapid"; to: Xyz }
  | { kind: "feed"; to: Xyz; feed: number; role: Role; power?: number }
  | Arc
  | Cycle
  | { kind: "dwell"; seconds: number }
  | { kind: "comment"; text: string }
  | { kind: "stop"; optional: boolean }
  | { kind: "raw"; post: string; text: string };

export type Section = {
  operationId: string;
  toolId: string;
  pass: "rough" | "finish";
  spindle?: { rpm: number; dir: "cw" | "ccw" };
  coolant: Coolant;
  moves: Move[];
};

export type Program = {
  irVersion: 1;
  units: "mm";
  setupId: string;
  offsetIndex: number;
  tools: (Tool & { number: number })[];
  sections: Section[];
};

export type ProgramStats = { cutLength: number; seconds: number };

const ARC_TOLERANCE = 1e-4;
const TAU = 2 * Math.PI;

function nonFinite(value: unknown, path: string): string[] {
  if (typeof value === "number")
    return Number.isFinite(value) ? [] : [`${path} must be finite`];
  if (Array.isArray(value))
    return value.flatMap((item, i) => nonFinite(item, `${path}[${i}]`));
  if (typeof value === "object" && value !== null)
    return Object.entries(value).flatMap(([key, item]) =>
      nonFinite(item, path ? `${path}.${key}` : key),
    );
  return [];
}

export function inPlane([x, y, z]: Xyz, plane: Plane): Xyz {
  if (plane === "xy") return [x, y, z];
  return plane === "zx" ? [z, x, y] : [y, z, x];
}

export function radii(from: Xyz, arc: Arc): [number, number] {
  const [cu, cv] = inPlane(arc.centre, arc.plane);
  const [su, sv] = inPlane(from, arc.plane);
  const [eu, ev] = inPlane(arc.to, arc.plane);
  return [Math.hypot(su - cu, sv - cv), Math.hypot(eu - cu, ev - cv)];
}

export function arcSweep(from: Xyz, arc: Arc): number {
  const [cu, cv] = inPlane(arc.centre, arc.plane);
  const [su, sv] = inPlane(from, arc.plane);
  const [eu, ev] = inPlane(arc.to, arc.plane);
  const turn = Math.atan2(ev - cv, eu - cu) - Math.atan2(sv - cv, su - cu);
  return Math.hypot(eu - su, ev - sv) <= ARC_TOLERANCE
    ? TAU
    : (((arc.dir === "ccw" ? turn : -turn) % TAU) + TAU) % TAU;
}

function arcLength(from: Xyz, arc: Arc): number {
  const rise = inPlane(arc.to, arc.plane)[2] - inPlane(from, arc.plane)[2];
  return Math.hypot(radii(from, arc)[0] * arcSweep(from, arc), rise);
}

export function endOf(move: Move, at: Xyz | undefined): Xyz | undefined {
  if (move.kind === "rapid" || move.kind === "feed" || move.kind === "arc")
    return move.to;
  if (move.kind !== "cycle") return at;
  const last = move.points.at(-1);
  return last ? [last[0], last[1], move.clear] : at;
}

function* walk(program: Program) {
  let at: Xyz | undefined;
  for (const [s, section] of program.sections.entries())
    for (const [m, move] of section.moves.entries()) {
      yield { move, at, path: `sections[${s}].moves[${m}]` };
      at = endOf(move, at);
    }
}

function moveProblems(move: Move, at: Xyz | undefined, path: string) {
  const problems: string[] = [];
  if ("feed" in move && move.feed <= 0)
    problems.push(`${path}.feed must be greater than 0`);
  if (move.kind === "cycle" && move.cycle === "peck" && move.peck <= 0)
    problems.push(`${path}.peck must be greater than 0`);
  if (move.kind !== "arc") return problems;
  if (!at) return [...problems, `${path} arc has no start point`];
  const [start, end] = radii(at, move);
  if (Math.abs(start - end) > ARC_TOLERANCE)
    problems.push(
      `${path} arc start and end radii differ by more than 1e-4 mm`,
    );
  return problems;
}

export function validateProgram(program: Program): string[] {
  const tools = new Set(program.tools.map((tool) => tool.id));
  return [
    ...nonFinite(program, ""),
    ...program.sections
      .map((section, s) => ({ section, s }))
      .filter(({ section }) => !tools.has(section.toolId))
      .map(
        ({ section, s }) =>
          `sections[${s}].toolId ${section.toolId} is unknown`,
      ),
    ...[...walk(program)].flatMap(({ move, at, path }) =>
      moveProblems(move, at, path),
    ),
  ];
}

function distance(a: Xyz | undefined, b: Xyz): number {
  return a ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : 0;
}

export function pecks(move: Cycle): number {
  return move.cycle === "peck"
    ? Math.max(1, Math.ceil((move.top - move.bottom) / move.peck))
    : 1;
}

function cycleTotals(move: Cycle, at: Xyz | undefined) {
  let rapid = 0;
  let from = at;
  const depth = move.clear - move.bottom;
  const steps = pecks(move);
  const retracts =
    move.cycle === "peck"
      ? 2 * (steps - 1) * (move.clear - move.top) +
        move.peck * (steps - 1) * steps
      : 0;
  for (const [x, y] of move.points) {
    const above: Xyz = [x, y, from ? from[2] : move.clear];
    rapid += distance(from, above) + distance(above, [x, y, move.clear]);
    rapid += retracts + depth;
    from = [x, y, move.clear];
  }
  const count = move.points.length;
  return {
    rapid,
    feed: count * depth,
    seconds: count * (move.dwell ?? 0),
  };
}

export function programStats(
  program: Program,
  rapidFeed: number,
): ProgramStats {
  let cutLength = 0;
  let minutes = 0;
  let seconds = 0;
  for (const { move, at } of walk(program)) {
    if (move.kind === "rapid") minutes += distance(at, move.to) / rapidFeed;
    if (move.kind === "dwell") seconds += move.seconds;
    if (move.kind === "feed" || move.kind === "arc") {
      const length =
        move.kind === "arc" && at ? arcLength(at, move) : distance(at, move.to);
      cutLength += length;
      minutes += length / move.feed;
    }
    if (move.kind === "cycle") {
      const totals = cycleTotals(move, at);
      cutLength += totals.feed;
      minutes += totals.feed / move.feed + totals.rapid / rapidFeed;
      seconds += totals.seconds;
    }
  }
  return { cutLength, seconds: minutes * 60 + seconds };
}
