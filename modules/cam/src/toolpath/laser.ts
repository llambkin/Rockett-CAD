import type { RegionLoop } from "../kernel/regions.js";
import { powerRefusal } from "../post/format.js";
import type { Static } from "typebox";
import type { Move, Section } from "../shared/ir.js";
import type { laserParams } from "../shared/params.js";
import {
  PIECE,
  append,
  checkCut,
  checkMoves,
  chorded,
  covers,
  gap,
  lines,
  offsetLoops,
  pass,
  steps,
  type Cut,
  type Loop,
} from "./geometry.js";

type Beam = Omit<Static<typeof laserParams>, "face">;

export type LaserInput = Omit<Cut, "bottom"> &
  Beam & { operationId: string; profiles: RegionLoop[] };

const SIGN: Record<Beam["side"], number> = { outside: 1, inside: -1, on: 0 };

const endOf = (loop: RegionLoop) => loop.segments.at(-1)?.to ?? loop.start;

const closed = (loop: RegionLoop) => gap(endOf(loop), loop.start) <= PIECE;

type Profile = { loop: RegionLoop; points: Loop; depth: number };

function ordered(profiles: RegionLoop[]) {
  const open = profiles.filter((loop) => !closed(loop));
  const shut = profiles.filter(closed).map((loop) => ({
    loop,
    points: chorded(loop),
  }));
  const depth = shut.map(
    (inner) =>
      shut.filter(
        (outer) => outer !== inner && covers([outer.points], [inner.points]),
      ).length,
  );
  const nested: Profile[] = [];
  for (let d = Math.max(0, ...depth); d >= 0; d--)
    for (const [i, profile] of shut.entries())
      if (depth[i] === d) nested.push({ ...profile, depth: d });
  return { open, nested };
}

function kerfed(
  { loop, points, depth }: Profile,
  { side, tool }: LaserInput,
): RegionLoop {
  const distance = (SIGN[side] * (depth % 2 ? -1 : 1) * tool.diameter) / 2;
  if (!distance) return loop;
  const found = offsetLoops([points], distance);
  const what = `${side} offset by half the ${tool.diameter} mm kerf`;
  if (!found.length)
    throw new RangeError(
      `${what} leaves no path: a profile is narrower than the kerf`,
    );
  if (found.length > 1)
    throw new RangeError(
      `${what} splits a profile into ${found.length} loops: the kerf does not fit everywhere`,
    );
  return lines(found[0]!);
}

function bottomOf({ stock, passes, zStep = 0 }: LaserInput): number {
  const drop = (passes - 1) * zStep;
  const bottom = stock.max[2] - drop;
  if (steps(drop, stock.max[2] - stock.min[2]) > 1)
    throw new RangeError(
      `pass ${passes} of ${passes} at Z ${bottom} is below the stock bottom at ${stock.min[2]}`,
    );
  return bottom;
}

export function laser(input: LaserInput): Section {
  const { setup, stock, tool, preset, power, feed, passes, zStep = 0 } = input;
  const refusal = powerRefusal(power);
  if (refusal) throw new RangeError(refusal);
  checkCut("laser", { ...input, bottom: bottomOf(input) });
  const { open, nested } = ordered(input.profiles);
  const paths = [
    ...open.map((loop) => ({ loop, shut: false })),
    ...nested.map((profile) => ({ loop: kerfed(profile, input), shut: true })),
  ];
  const [first] = paths;
  if (!first) throw new RangeError("laser has no profile to cut");
  const top = stock.max[2];
  const clear = top + setup.clearance;
  const moves: Move[] = [
    { kind: "rapid", to: [...first.loop.start, top + setup.safeHeight] },
  ];
  for (const { loop, shut } of paths)
    for (let p = 0; p < passes; p++) {
      const z = top - p * zStep;
      if (p === 0 || !shut)
        moves.push({ kind: "rapid", to: [...loop.start, clear] });
      moves.push({
        kind: "feed",
        to: [...loop.start, z],
        feed: preset.plungeFeed,
        role: "plunge",
      });
      const cuts = pass(loop, z, feed);
      for (const move of cuts) if (move.kind !== "rapid") move.power = power;
      append(moves, cuts);
      if (p + 1 === passes || !shut)
        moves.push({ kind: "rapid", to: [...endOf(loop), clear] });
      checkMoves(`laser at pass ${p + 1} of ${passes}`, moves.length);
    }
  const last = endOf(paths.at(-1)!.loop);
  moves.push({ kind: "rapid", to: [...last, top + setup.safeHeight] });
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "finish",
    coolant: preset.coolant,
    moves,
  };
}
