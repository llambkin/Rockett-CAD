import {
  arcSweep,
  inPlane,
  radii,
  type Move,
  type Plane,
  type Section,
  type Xyz,
} from "../shared/ir.js";
import {
  machineKind,
  spindleRange,
  type MachineProfile,
} from "../shared/machine.js";
import { toolRefusal } from "../shared/operations.js";
import type { Tool } from "../shared/tools.js";
import type { CheckInput, Report } from "./check.js";
import { POSITIONED, steps } from "./checkSweep.js";
import { powerRefusal } from "./format.js";

const AXES = ["X", "Y", "Z"] as const;

const NORMAL: Record<Plane, number> = { xy: 2, zx: 1, yz: 0 };

function toolProblems(
  section: Section,
  s: number,
  tool: Tool | undefined,
  operations: CheckInput["operations"],
  report: Report,
) {
  const operation = operations.find((op) => op.id === section.operationId);
  if (!operation)
    return report("tool", `operation ${section.operationId} is unknown`, s);
  const refusal = toolRefusal(operation.type, tool?.kind);
  if (refusal) report("tool", refusal, s);
}

function spindleProblems(
  section: Section,
  s: number,
  machine: MachineProfile,
  report: Report,
) {
  const { spindle } = section;
  if (!spindle) {
    const m = section.moves.findIndex(
      (move) => move.kind !== "rapid" && POSITIONED.has(move.kind),
    );
    if (m >= 0)
      report("spindle", "the section cuts with no spindle state", s, m);
    return;
  }
  const { rpm } = spindle;
  const { min, max } = spindleRange(machine);
  if (!(rpm > 0 && rpm >= min && rpm <= max))
    report(
      "rpm",
      `${rpm} rpm is outside the machine's ${min} to ${max} rpm`,
      s,
    );
}

const power = (move: Move) => ("power" in move ? move.power : undefined);

function laserProblems(section: Section, s: number, report: Report) {
  if (section.spindle)
    report("laser", "a laser cannot run a spindle operation", s);
  section.moves.forEach((move, m) => {
    const percent = power(move);
    const refusal = percent === undefined ? undefined : powerRefusal(percent);
    if (refusal) report("laser", refusal, s, m);
  });
}

function millProblems(
  section: Section,
  s: number,
  machine: MachineProfile,
  report: Report,
) {
  spindleProblems(section, s, machine, report);
  const m = section.moves.findIndex((move) => power(move) !== undefined);
  if (m >= 0) report("laser", "a mill cannot run a laser operation", s, m);
}

function rates(move: Move, at: Xyz | undefined): Xyz | undefined {
  if (move.kind === "cycle") return [0, 0, move.feed];
  if (!at || (move.kind !== "feed" && move.kind !== "arc")) return undefined;
  if (move.kind === "feed") {
    const d = move.to.map((v, i) => Math.abs(v - at[i]!));
    const length = Math.hypot(...d);
    return length ? (d.map((v) => move.feed * (v / length)) as Xyz) : undefined;
  }
  const rise = Math.abs(
    inPlane(move.to, move.plane)[2] - inPlane(at, move.plane)[2],
  );
  const length = Math.hypot(radii(at, move)[0] * arcSweep(at, move), rise);
  const out: Xyz = [move.feed, move.feed, move.feed];
  out[NORMAL[move.plane]] = length ? move.feed * (rise / length) : 0;
  return out;
}

function feedProblems(
  move: Move,
  at: Xyz | undefined,
  machine: MachineProfile,
  report: Report,
  ...where: [number, number]
) {
  const rate = rates(move, at);
  AXES.forEach((axis, i) => {
    const max = machine[`maxFeed${axis}`];
    if (rate && rate[i]! > max)
      report(
        "feed",
        `${axis} moves at ${Math.round(rate[i]!)} mm/min, over ${max}`,
        ...where,
      );
  });
}

function feedLimits(machine: MachineProfile, report: Report) {
  for (const axis of AXES)
    if (typeof machine[`maxFeed${axis}`] !== "number")
      report(
        "feed",
        `the machine has no max feed for ${axis}, so it is unchecked`,
      );
}

export function sectionProblems(input: CheckInput, report: Report) {
  const { program, machine, operations } = input;
  const tools = new Map(program.tools.map((tool) => [tool.id, tool]));
  const laser = machineKind(machine) === "laser";
  for (const [s, section] of program.sections.entries()) {
    const tool = tools.get(section.toolId);
    toolProblems(section, s, tool, operations, report);
    if (laser) laserProblems(section, s, report);
    else millProblems(section, s, machine, report);
  }
  feedLimits(machine, report);
  for (const { s, m, move, at } of steps(program)) {
    if (move.kind === "raw") report("raw", "raw text is unchecked", s, m);
    feedProblems(move, at, machine, report, s, m);
  }
}
