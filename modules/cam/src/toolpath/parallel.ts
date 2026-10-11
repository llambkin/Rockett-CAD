import { CHORD_FRACTION } from "../kernel/surfaceMesh.js";
import type { Move, Section, Xyz } from "../shared/ir.js";
import { toolRefusal } from "../shared/operations.js";
import type { Box, Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";
import {
  dropCutter,
  indexMesh,
  type IndexedMesh,
  type Mesh,
} from "../surface/dropCutter.js";
import { stepoverOf, type Loop } from "./geometry.js";

export type ParallelInput = {
  operationId: string;
  setup: Pick<Setup, "safeHeight" | "clearance" | "tolerance">;
  stock: Box;
  mesh: Mesh;
  boundary: Loop[];
  angle: number;
  tool: Tool;
  preset: Preset;
};

export const MAX_SAMPLES = 1_000_000;

export type Budget = ReturnType<typeof dropBudget>;

type Frame = { cos: number; sin: number };
type Pass = { v: number; from: number; to: number };
type Sample = { u: number; at: Xyz };

const EPSILON = 1e-9;

export function dropBudget(what: string) {
  let used = 0;
  const budget = {
    what,
    need(count: number) {
      if (used + count > MAX_SAMPLES)
        throw new RangeError(
          `${budget.what} passes the limit of ${MAX_SAMPLES.toLocaleString("en")} drop cutter samples`,
        );
    },
    drop(mesh: IndexedMesh, tool: Tool, x: number, y: number) {
      budget.need(1);
      used++;
      return dropCutter(mesh, tool, x, y);
    },
  };
  return budget;
}

export function checkParallel({
  setup,
  tool,
  preset,
  angle,
}: Pick<ParallelInput, "setup" | "tool" | "preset" | "angle">) {
  const refusal = toolRefusal("rockett.cam.parallel", tool.kind);
  if (refusal) throw new RangeError(refusal);
  const radius = tool.diameter / 2;
  if (!(radius > 0)) throw new RangeError("tool diameter must be above 0");
  if (!(setup.tolerance > 0 && setup.tolerance < radius))
    throw new RangeError("tolerance must be above 0 and below the tool radius");
  if (!(setup.clearance >= 0 && setup.safeHeight >= setup.clearance))
    throw new RangeError("safe height must be at least the clearance");
  const stepover = stepoverOf(preset, tool);
  if (!Number.isFinite(angle)) throw new RangeError("angle must be finite");
  const budget = setup.tolerance * (1 - CHORD_FRACTION);
  return {
    budget,
    chord: 2 * Math.sqrt(budget * (2 * radius - budget)),
    stepover,
  };
}

function inFrame({ x, y }: Loop[number], frame: Frame): [number, number] {
  return [x * frame.cos + y * frame.sin, y * frame.cos - x * frame.sin];
}

function crossings(boundary: Loop[], frame: Frame, v: number): number[] {
  const out: number[] = [];
  for (const loop of boundary)
    loop.forEach((p, i) => {
      const [pu, pv] = inFrame(p, frame);
      const q = loop[(i + 1) % loop.length]!;
      const [qu, qv] = inFrame(q, frame);
      if (pv <= v === qv <= v) return;
      const u = pu + ((v - pv) / (qv - pv)) * (qu - pu);
      const at = out.findIndex((w) => w > u);
      out.splice(at < 0 ? out.length : at, 0, u);
    });
  return out;
}

function passes(
  boundary: Loop[],
  frame: Frame,
  stepover: number,
  budget: Budget,
): Pass[] {
  let [low, high] = [Infinity, -Infinity];
  for (const p of boundary.flat()) {
    const v = inFrame(p, frame)[1];
    [low, high] = [Math.min(low, v), Math.max(high, v)];
  }
  if (!(Number.isFinite(high - low) && high >= low))
    throw new RangeError("boundary needs finite loops");
  const middle = (low + high) / 2;
  const reach = Math.ceil((high - low) / 2 / stepover - EPSILON) - 1;
  budget.need(2 * reach + 1);
  const out: Pass[] = [];
  for (let k = -reach; k <= reach; k++) {
    const v = middle + k * stepover;
    const row = crossings(boundary, frame, v).flatMap((from, i, all) =>
      i % 2 === 0 && all[i + 1]! - from > EPSILON
        ? [{ v, from, to: all[i + 1]! }]
        : [],
    );
    if (k % 2 === 0) out.push(...row);
    else
      for (let i = row.length - 1; i >= 0; i--)
        out.push({ v, from: row[i]!.to, to: row[i]!.from });
  }
  if (!out.length) throw new RangeError("boundary has no pass inside it");
  return out;
}

function sampler(
  input: ParallelInput,
  mesh: IndexedMesh,
  frame: Frame,
  budget: Budget,
) {
  return (pass: Pass, u: number): Sample => {
    const x = u * frame.cos - pass.v * frame.sin;
    const y = u * frame.sin + pass.v * frame.cos;
    return { u, at: [x, y, budget.drop(mesh, input.tool, x, y)] };
  };
}

function runs(
  pass: Pass,
  drop: (pass: Pass, u: number) => Sample,
  limits: { budget: number; chord: number },
  segments: number,
): Xyz[][] {
  const samples: Sample[] = [];
  const fits = (a: Sample, b: Sample) => {
    const across = Math.abs(b.u - a.u);
    if (across <= limits.budget) return true;
    const [za, zb] = [a.at[2], b.at[2]];
    if (za === -Infinity || zb === -Infinity) return za === zb;
    return Math.hypot(across, zb - za) <= limits.chord;
  };
  const refine = (a: Sample, b: Sample): void => {
    if (fits(a, b)) {
      samples.push(b);
      return;
    }
    const mid = drop(pass, (a.u + b.u) / 2);
    refine(a, mid);
    refine(mid, b);
  };
  let last = drop(pass, pass.from);
  samples.push(last);
  for (let i = 1; i <= segments; i++) {
    const next = drop(pass, pass.from + ((pass.to - pass.from) * i) / segments);
    refine(last, next);
    last = next;
  }
  const out: Xyz[][] = [[]];
  for (const { at } of samples)
    if (at[2] === -Infinity) out.push([]);
    else out.at(-1)!.push(at);
  return out.filter((run) => run.length > 1);
}

export function parallel(input: ParallelInput): Section {
  const { setup, stock, tool, preset } = input;
  const limits = checkParallel(input);
  if (!input.mesh.indices.length) throw new RangeError("mesh has no triangles");
  const turn = (input.angle * Math.PI) / 180;
  const frame = { cos: Math.cos(turn), sin: Math.sin(turn) };
  const budget = dropBudget("parallel");
  const rows = passes(input.boundary, frame, limits.stepover, budget);
  const counts = rows.map((pass) =>
    Math.max(
      1,
      Math.ceil(Math.abs(pass.to - pass.from) / limits.chord - EPSILON),
    ),
  );
  budget.need(counts.reduce((sum, n) => sum + n + 1, 0));
  const mesh = indexMesh(input.mesh);
  const top = stock.max[2];
  let part = -Infinity;
  for (let i = 2; i < mesh.points.length; i += 3)
    part = Math.max(part, mesh.points[i]!);
  if (part > top)
    throw new RangeError("stock top must not be below the part top");
  const plane = top + setup.clearance;
  const drop = sampler(input, mesh, frame, budget);
  const cuts = rows.flatMap((pass, n) => runs(pass, drop, limits, counts[n]!));
  if (!cuts.length) throw new RangeError("no surface lies inside the boundary");
  const moves: Move[] = [];
  const first = cuts[0]![0]!;
  moves.push({
    kind: "rapid",
    to: [first[0], first[1], top + setup.safeHeight],
  });
  for (const run of cuts) {
    const [start, end] = [run[0]!, run.at(-1)!];
    moves.push(
      { kind: "rapid", to: [start[0], start[1], plane] },
      { kind: "feed", to: start, feed: preset.plungeFeed, role: "plunge" },
      ...run.slice(1).map((to): Move => ({
        kind: "feed",
        to,
        feed: preset.cutFeed,
        role: "cut",
      })),
      {
        kind: "feed",
        to: [end[0], end[1], plane],
        feed: preset.cutFeed,
        role: "link",
      },
    );
  }
  const last = cuts.at(-1)!.at(-1)!;
  moves.push({ kind: "rapid", to: [last[0], last[1], top + setup.safeHeight] });
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "finish",
    spindle: { rpm: preset.rpm, dir: "cw" },
    coolant: preset.coolant,
    moves,
  };
}
