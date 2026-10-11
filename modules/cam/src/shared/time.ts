import { expandArc } from "../post/normalise.js";
import {
  endOf,
  profileOf,
  type Move,
  type Program,
  type Section,
  type Xyz,
} from "./ir.js";
import type { MachineProfile } from "./machine.js";

export type SectionTime = { seconds: number; motion: number; cruise: number };
export type CycleTime = { seconds: number; sections: SectionTime[] };

type Block = {
  section: number;
  length: number;
  speed: number;
  accel: number;
  entry: number;
};

const ARC_TOLERANCE = 0.002;
const MIN_SPEED = 1 / 60;
const STRAIGHT = 0.999999;
const LIMITS = ["accelX", "accelY", "accelZ", "junctionDeviation"] as const;

const byAxis = (max: Xyz, unit: Xyz) =>
  Math.min(...unit.map((u, i) => (u === 0 ? Infinity : Math.abs(max[i]! / u))));

const sameSpindle = (a: Section["spindle"], b: Section["spindle"]) =>
  a?.rpm === b?.rpm && a?.dir === b?.dir;

const changes = (before: Section | undefined, section: Section) =>
  !before ||
  before.toolId !== section.toolId ||
  !sameSpindle(before.spindle, section.spindle);

export const spinsUp = (before: Section | undefined, section: Section) =>
  section.spindle !== undefined && changes(before, section);

const share = (profile: number) => (6 - profile) / 5;

export const byAcceleration = ({ motion, cruise }: SectionTime) =>
  motion - cruise > cruise;

function trapezoid({ length, speed, accel }: Block, u2: number, w2: number) {
  const v2 = speed * speed;
  const up = (v2 - u2) / (2 * accel);
  const down = (v2 - w2) / (2 * accel);
  const [u, w] = [Math.sqrt(u2), Math.sqrt(w2)];
  if (up + down <= length) {
    const cruise = (length - up - down) / speed;
    return { seconds: (2 * speed - u - w) / accel + cruise, cruise };
  }
  const peak = Math.sqrt((2 * accel * length + u2 + w2) / 2);
  return { seconds: (2 * peak - u - w) / accel, cruise: 0 };
}

function plan(run: Block[], times: SectionTime[]) {
  run.reduceRight((exit, block) => {
    block.entry = Math.min(block.entry, exit + 2 * block.accel * block.length);
    return block.entry;
  }, 0);
  run.forEach((block, i) => {
    const next = run[i + 1];
    if (next)
      next.entry = Math.min(
        next.entry,
        block.entry + 2 * block.accel * block.length,
      );
    const { seconds, cruise } = trapezoid(block, block.entry, next?.entry ?? 0);
    const time = times[block.section]!;
    time.seconds += seconds;
    time.motion += seconds;
    time.cruise += cruise;
  });
}

type Limits = { accel: Xyz; rates: Xyz; deviation: number };

function limitsOf(machine: MachineProfile): Limits {
  const missing = LIMITS.filter((key) => machine[key] === undefined);
  if (missing.length)
    throw new Error(`a time estimate needs ${missing.join(", ")}`);
  return {
    accel: [machine.accelX!, machine.accelY!, machine.accelZ!],
    rates: [machine.maxFeedX, machine.maxFeedY, machine.maxFeedZ],
    deviation: machine.junctionDeviation!,
  };
}

function junction({ accel, deviation }: Limits, before: Xyz, unit: Xyz) {
  const cos = -before.reduce((sum, b, i) => sum + b * unit[i]!, 0);
  if (cos > STRAIGHT) return 0;
  if (cos < -STRAIGHT) return Infinity;
  const turn = unit.map((u, i) => u - before[i]!) as Xyz;
  const size = Math.hypot(...turn);
  const along = byAxis(accel, turn.map((t) => t / size) as Xyz);
  const sinHalf = Math.sqrt(0.5 * (1 - cos));
  return (along * deviation * sinHalf) / (1 - sinHalf);
}

type Previous = { unit: Xyz; speed: number } | undefined;

function blockOf(
  limits: Limits,
  section: number,
  [from, to]: [Xyz, Xyz],
  feed: number | undefined,
  scale: number,
  previous: Previous,
) {
  const delta = to.map((v, i) => v - from[i]!) as Xyz;
  const length = Math.hypot(...delta);
  if (length === 0) return undefined;
  const unit = delta.map((d) => d / length) as Xyz;
  const rapid = byAxis(limits.rates, unit) / 60;
  const speed = Math.max(Math.min((feed ?? Infinity) / 60, rapid), MIN_SPEED);
  const entry = previous
    ? Math.min(
        speed ** 2,
        previous.speed ** 2,
        junction(limits, previous.unit, unit) * scale,
      )
    : 0;
  const block: Block = {
    section,
    length,
    speed,
    accel: byAxis(limits.accel, unit) * scale,
    entry,
  };
  return { block, unit };
}

export function estimateTime(
  program: Pick<Program, "sections">,
  machine: MachineProfile,
): CycleTime {
  const limits = limitsOf(machine);
  const profiles = machine.accelerationProfiles === true;
  const times = program.sections.map(() => ({
    seconds: 0,
    motion: 0,
    cruise: 0,
  }));
  let run: Block[] = [];
  let previous: Previous;
  let at: Xyz | undefined;
  const stop = () => {
    plan(run, times);
    run = [];
    previous = undefined;
  };
  const line = (section: number, to: Xyz, scale: number, feed?: number) => {
    const made =
      at && blockOf(limits, section, [at, to], feed, scale, previous);
    if (!made) return;
    run.push(made.block);
    previous = { unit: made.unit, speed: made.block.speed };
  };
  const move = (section: number, item: Move) => {
    if (item.kind === "cycle")
      throw new Error("drill cycles are not timed yet");
    const scale = profiles
      ? share(profileOf(item, program.sections[section]!) ?? 1)
      : 1;
    if (item.kind === "rapid") line(section, item.to, scale);
    if (item.kind === "feed") line(section, item.to, scale, item.feed);
    if (item.kind === "arc" && at)
      for (const piece of expandArc(at, item, ARC_TOLERANCE)) {
        line(section, piece.to, scale, piece.feed);
        at = piece.to;
      }
    if (item.kind === "dwell" || item.kind === "stop") stop();
    if (item.kind === "dwell") times[section]!.seconds += item.seconds;
  };

  program.sections.forEach((section, s) => {
    const before = program.sections[s - 1];
    if (changes(before, section) || before?.coolant !== section.coolant) stop();
    if (spinsUp(before, section))
      times[s]!.seconds += machine.spinUpSeconds ?? 0;
    for (const item of section.moves) {
      move(s, item);
      at = endOf(item, at);
    }
  });
  stop();
  return {
    seconds: times.reduce((sum, time) => sum + time.seconds, 0),
    sections: times,
  };
}
