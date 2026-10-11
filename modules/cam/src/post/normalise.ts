import {
  arcStep,
  arcSweep,
  endOf,
  inPlane,
  pecks,
  radii,
  validateProgram,
  type Arc,
  type Cycle,
  type Move,
  type Plane,
  type Program,
  type Section,
  type Xy,
  type Xyz,
} from "../shared/ir.js";
import { MM_PER_INCH } from "../shared/tools.js";
import type { Post } from "./schema.js";

export type Units = "mm" | "inch";

type Target = Pick<Post, "id" | "capabilities" | "toolChangeDefault">;

export type NormaliseOptions = { units: Units; toolChange?: boolean };

export type NormalisedProgram = {
  postId: string;
  toolChange: boolean;
  units: Units;
  setupId: string;
  offsetIndex: number;
  tools: Program["tools"];
  files: Section[][];
};

const PATH_TOLERANCE = 0.005;
const QUARTER = Math.PI / 2;
const EPSILON = 1e-9;

function fromPlane([u, v, w]: Xyz, plane: Plane): Xyz {
  if (plane === "xy") return [u, v, w];
  return plane === "zx" ? [v, w, u] : [w, u, v];
}

function quadrantCuts(start: number, sweep: number, ccw: boolean): number[] {
  const first = ccw
    ? (Math.floor(start / QUARTER) + 1) * QUARTER - start
    : start - (Math.ceil(start / QUARTER) - 1) * QUARTER;
  const cuts = [0];
  for (let t = first; t < sweep - EPSILON; t += QUARTER)
    if (t > EPSILON) cuts.push(t);
  return [...cuts, sweep];
}

type Feed = Extract<Move, { kind: "feed" }>;

export function expandArc(
  from: Xyz,
  arc: Arc,
  tolerance = PATH_TOLERANCE,
): Feed[] {
  const { to, centre, dir, plane, ...motion } = arc;
  const [cu, cv] = inPlane(centre, plane);
  const [su, sv, sw] = inPlane(from, plane);
  const ew = inPlane(to, plane)[2];
  const [r0, r1] = radii(from, arc);
  const sweep = arcSweep(from, arc);
  const sign = dir === "ccw" ? 1 : -1;
  const start = Math.atan2(sv - cv, su - cu);
  const step = arcStep(Math.max(r0, r1), tolerance);
  const cuts = quadrantCuts(start, sweep, dir === "ccw");
  const angles = cuts.slice(1).flatMap((end, i) => {
    const begin = cuts[i]!;
    const n = Math.ceil((end - begin) / step);
    return Array.from(
      { length: n },
      (_, k) => begin + ((end - begin) * (k + 1)) / n,
    );
  });
  const pointAt = (t: number): Xyz => {
    const f = t / sweep;
    const r = r0 + (r1 - r0) * f;
    const a = start + sign * t;
    return fromPlane(
      [cu + r * Math.cos(a), cv + r * Math.sin(a), sw + (ew - sw) * f],
      plane,
    );
  };
  const segment = (end: Xyz): Feed => ({ ...motion, kind: "feed", to: end });
  return [...angles.slice(0, -1).map(pointAt), to].map(segment);
}

function same(a: Xyz, b: Xyz | undefined): boolean {
  return b !== undefined && a.every((v, i) => v === b[i]);
}

function travel(at: Xyz | undefined, x: number, y: number, clear: number) {
  const z = at ? Math.max(at[2], clear) : clear;
  const path: Xyz[] = at
    ? [
        [at[0], at[1], z],
        [x, y, z],
        [x, y, clear],
      ]
    : [[x, y, clear]];
  return path
    .filter((p, i) => !same(p, i ? path[i - 1] : at))
    .map((to): Move => ({ kind: "rapid", to }));
}

function expandCycle(at: Xyz | undefined, cycle: Cycle): Move[] {
  const { clear, feed } = cycle;
  const count = pecks(cycle);
  const depths = Array.from({ length: count }, (_, i) =>
    i < count - 1 && cycle.cycle === "peck"
      ? cycle.top - (i + 1) * cycle.peck
      : cycle.bottom,
  );
  const moves: Move[] = [];
  let from = at;
  for (const [x, y] of cycle.points) {
    moves.push(...travel(from, x, y, clear));
    let reached = clear;
    for (const [i, depth] of depths.entries()) {
      if (i)
        moves.push(
          { kind: "rapid", to: [x, y, clear] },
          { kind: "rapid", to: [x, y, reached] },
        );
      moves.push({ kind: "feed", to: [x, y, depth], feed, role: "plunge" });
      reached = depth;
    }
    if (cycle.dwell) moves.push({ kind: "dwell", seconds: cycle.dwell });
    moves.push({ kind: "rapid", to: [x, y, clear] });
    from = [x, y, clear];
  }
  return moves;
}

function scale(move: Move, divisor: number): Move {
  const xyz = ([x, y, z]: Xyz): Xyz => [x / divisor, y / divisor, z / divisor];
  if (move.kind === "rapid") return { ...move, to: xyz(move.to) };
  if (move.kind === "feed")
    return { ...move, to: xyz(move.to), feed: move.feed / divisor };
  if (move.kind === "arc")
    return {
      ...move,
      to: xyz(move.to),
      centre: xyz(move.centre),
      feed: move.feed / divisor,
    };
  if (move.kind !== "cycle") return move;
  const scaled = {
    ...move,
    points: move.points.map(([x, y]): Xy => [x / divisor, y / divisor]),
    clear: move.clear / divisor,
    top: move.top / divisor,
    bottom: move.bottom / divisor,
    feed: move.feed / divisor,
  };
  return scaled.cycle === "peck"
    ? { ...scaled, peck: scaled.peck / divisor }
    : scaled;
}

function expand(move: Move, at: Xyz | undefined, post: Target, path: string) {
  if (move.kind === "raw" && move.post !== post.id)
    throw new Error(`${path} raw is for post ${move.post}, not ${post.id}`);
  const { arcs } = post.capabilities;
  if (move.kind === "arc" && at && arcs !== true && move.plane !== arcs)
    return expandArc(at, move);
  if (move.kind === "cycle" && !post.capabilities.cycles)
    return expandCycle(at, move);
  return [move];
}

function byTool(sections: Section[]): Section[][] {
  const files: Section[][] = [];
  for (const section of sections) {
    const last = files.at(-1);
    if (last?.[0]?.toolId === section.toolId) last.push(section);
    else files.push([section]);
  }
  return files;
}

export function normalise(
  program: Program,
  post: Target,
  options: NormaliseOptions,
): NormalisedProgram {
  const problems = validateProgram(program);
  if (problems.length) throw new Error(problems.join("\n"));
  const toolChange =
    options.toolChange ??
    post.toolChangeDefault ??
    post.capabilities.toolChange;
  if (toolChange && !post.capabilities.toolChange)
    throw new Error(`post ${post.id} does not support tool changes`);
  const divisor = options.units === "inch" ? MM_PER_INCH : 1;
  let at: Xyz | undefined;
  const sections = program.sections.map((section, s) => ({
    ...section,
    moves: section.moves.flatMap((move, m) => {
      const out = expand(move, at, post, `sections[${s}].moves[${m}]`);
      at = endOf(move, at);
      return out.map((each) => scale(each, divisor));
    }),
  }));
  return {
    postId: post.id,
    toolChange,
    units: options.units,
    setupId: program.setupId,
    offsetIndex: program.offsetIndex,
    tools: program.tools,
    files: toolChange ? [sections] : byTool(sections),
  };
}
