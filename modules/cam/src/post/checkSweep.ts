import {
  endOf,
  inPlane,
  radii,
  type Move,
  type Program,
  type Xy,
  type Xyz,
} from "../shared/ir.js";
import type { Box, Fixture } from "../shared/setup.js";
import type { Tool } from "../shared/tools.js";
import { normalise } from "./normalise.js";

export type Segment = { from: Xyz; to: Xyz; rapid: boolean; grow: number };

export type Step = {
  s: number;
  m: number;
  move: Move;
  at: Xyz | undefined;
  first: boolean;
};

export type Span = Omit<Step, "at"> & { segments: Segment[] };

export type Region = { min: Xy; max: Xy; top: number; reach: number };

export const keepOut = (
  { min, max }: Box,
  clearance: number,
  reach: number,
): Region => ({
  min: [min[0] - clearance, min[1] - clearance],
  max: [max[0] + clearance, max[1] + clearance],
  top: max[2] + clearance,
  reach,
});

export const reachOf = (
  tool: Pick<Tool, "diameter" | "shankDiameter"> | undefined,
) => (tool ? Math.max(tool.diameter, tool.shankDiameter) / 2 : 0);

const EXPAND = {
  id: "rockett.cam.check",
  capabilities: { arcs: false, cycles: false, toolChange: true },
};

const BLANK: Move = { kind: "comment", text: "" };

export const POSITIONED = new Set<Move["kind"]>([
  "rapid",
  "feed",
  "arc",
  "cycle",
]);

export function steps(program: Program): Step[] {
  const out: Step[] = [];
  let at: Xyz | undefined;
  let fresh = true;
  for (const [s, section] of program.sections.entries()) {
    if (program.sections[s - 1]?.toolId !== section.toolId)
      [at, fresh] = [undefined, true];
    for (const [m, move] of section.moves.entries()) {
      const first = fresh && POSITIONED.has(move.kind);
      if (first) fresh = false;
      out.push({ s, m, move, at, first });
      at = endOf(move, at);
    }
  }
  return out;
}

function chordGrow(move: Move, start: Xyz | undefined, from: Xyz, to: Xyz) {
  if (move.kind !== "arc" || !start) return 0;
  const [r0, r1] = radii(start, move);
  const radius = Math.max(r0, r1);
  const [fu, fv] = inPlane(from, move.plane);
  const [tu, tv] = inPlane(to, move.plane);
  const half = Math.min(radius, Math.hypot(tu - fu, tv - fv) / 2);
  return radius - Math.sqrt(radius * radius - half * half) + Math.abs(r0 - r1);
}

export function spans(program: Program): Span[] {
  const walked = steps(program);
  const single = walked.map(({ s, move }) => ({
    ...program.sections[s]!,
    moves: [move.kind === "raw" ? BLANK : move],
  }));
  const expanded = normalise({ ...program, sections: single }, EXPAND, {
    units: "mm",
    toolChange: true,
  }).files.flat();
  return walked.map(({ s, m, move, at: start, first }, k) => {
    let from = start;
    const segments: Segment[] = [];
    for (const each of expanded[k]!.moves) {
      if (each.kind !== "rapid" && each.kind !== "feed") continue;
      const { to } = each;
      const grow = chordGrow(move, start, from ?? to, to);
      segments.push({
        from: from ?? to,
        to,
        rapid: each.kind === "rapid",
        grow,
      });
      from = to;
    }
    return { s, m, move, first, segments };
  });
}

function rectDistance([x, y]: Xy, { min, max }: Region): number {
  return Math.hypot(
    Math.max(min[0] - x, 0, x - max[0]),
    Math.max(min[1] - y, 0, y - max[1]),
  );
}

function distance(p: Xy, q: Xy, region: Region): number {
  const { min, max } = region;
  const d: Xy = [q[0] - p[0], q[1] - p[1]];
  const length = d[0] * d[0] + d[1] * d[1];
  const ts = [0, 1];
  for (const i of [0, 1] as const)
    if (d[i]) ts.push((min[i] - p[i]) / d[i], (max[i] - p[i]) / d[i]);
  const corners: Xy[] = [min, max, [min[0], max[1]], [max[0], min[1]]];
  if (length)
    for (const [x, y] of corners)
      ts.push(((x - p[0]) * d[0] + (y - p[1]) * d[1]) / length);
  return Math.min(
    ...ts.map((t) => {
      const u = Math.max(0, Math.min(1, t));
      return rectDistance([p[0] + u * d[0], p[1] + u * d[1]], region);
    }),
  );
}

export function intrudes(
  { min, max }: Pick<Region, "min" | "max">,
  z: number,
  region: Region,
): boolean {
  const [x, y] = ([0, 1] as const).map((i) =>
    Math.max(region.min[i] - max[i], min[i] - region.max[i]),
  ) as Xy;
  const apart = Math.hypot(Math.max(x, 0), Math.max(y, 0));
  return z < region.top && ((x < 0 && y < 0) || apart < region.reach);
}

export function hits({ from, to, grow }: Segment, region: Region): boolean {
  const top = region.top + grow;
  const [za, zb] = [from[2], to[2]];
  if (za >= top && zb >= top) return false;
  const t = za === zb ? 0 : (top - za) / (zb - za);
  const [ta, tb] = za < top ? (zb < top ? [0, 1] : [0, t]) : [t, 1];
  const at = (u: number): Xy => [
    from[0] + u * (to[0] - from[0]),
    from[1] + u * (to[1] - from[1]),
  ];
  return distance(at(ta), at(tb), region) < region.reach + grow;
}

export function exempt(
  { from, to }: Segment,
  deepest: Map<string, number>,
): boolean {
  if (from[0] !== to[0] || from[1] !== to[1]) return false;
  return (
    to[2] >= from[2] || to[2] >= (deepest.get(`${to[0]},${to[1]}`) ?? Infinity)
  );
}

export const fixturesMet = (
  segments: Segment[],
  fixtures: readonly Fixture[],
  clearance: number,
  reach: number,
) =>
  fixtures.filter((fixture) => {
    const region = keepOut(fixture, clearance, reach);
    return segments.some((segment) => hits(segment, region));
  });
