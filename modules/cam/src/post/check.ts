import { validateProgram, type Program } from "../shared/ir.js";
import {
  machineKind,
  validateMachine,
  type MachineProfile,
} from "../shared/machine.js";
import type { Box, Setup, Travel } from "../shared/setup.js";
import { validateTool } from "../shared/tools.js";
import { motionProblems, type Context } from "./checkMotion.js";
import { sectionProblems } from "./checkSections.js";
import type { Units } from "./normalise.js";
import type { Post } from "./schema.js";

export type Rule =
  | "ir"
  | "finite"
  | "units"
  | "machine"
  | "tool"
  | "feed"
  | "rpm"
  | "spindle"
  | "laser"
  | "raw"
  | "entry"
  | "retract"
  | "stock"
  | "fixture"
  | "travel"
  | "termination";

export type Problem = {
  rule: Rule;
  section?: number;
  move?: number;
  reason: string;
};

export type CheckInput = {
  program: Program;
  setup: Setup;
  stock: Box;
  operations: { id: string; type: string }[];
  machine: MachineProfile;
  post: Pick<Post, "templates">;
  units: Units;
};

export type CheckResult = {
  problems: Problem[];
  travel: Travel;
  qualified: boolean;
};

export type Report = (rule: Rule, reason: string, ...at: number[]) => void;

const IR_PATH = /^sections\[(\d+)\](?:\.moves\[(\d+)\])?/;

function irRule(text: string): Rule {
  if (text.endsWith("must be finite")) return "finite";
  return text.endsWith("feed must be greater than 0") ? "feed" : "ir";
}

function irProblems(program: Program, report: Report): boolean {
  const problems = validateProgram(program);
  for (const text of problems) {
    const [, s, m] = IR_PATH.exec(text) ?? [];
    report(irRule(text), text, ...[s, m].filter(Boolean).map(Number));
  }
  return problems.length > 0;
}

function setupNumbers({ setup, stock, machine }: CheckInput): number[] {
  const { wcs } = setup;
  return [
    setup.safeHeight,
    setup.clearance,
    ...stock.min,
    ...stock.max,
    ...setup.fixtures.flatMap((f) => [...f.min, ...f.max]),
    ...(wcs.machine.kind === "known" ? wcs.machine.origin : []),
    ...Object.values(machine).filter((v) => typeof v === "number"),
  ];
}

const inverted = ({ min, max }: Box) => min.some((v, i) => v > max[i]!);

function boxProblems({ setup, stock }: CheckInput, report: Report): boolean {
  const flipped = inverted(stock);
  const bad = setup.fixtures.filter(inverted);
  if (flipped) report("stock", "the stock box has min above max");
  for (const { name } of bad)
    report("fixture", `the ${name} box has min above max`);
  return flipped || bad.length > 0;
}

function termination({ templates }: CheckInput["post"], report: Report) {
  const footer = new Set(templates.footer);
  const missing = [...templates.spindleOff, ...templates.coolantOff].filter(
    (line) => !footer.has(line),
  );
  if (missing.length)
    report("termination", `the post footer never sends ${missing.join(" ")}`);
}

function laserMode(machine: MachineProfile, report: Report) {
  const laser = machineKind(machine) === "laser";
  if (laser && machine.laserMode !== true)
    report(
      "laser",
      "laser mode is not on: send $32=1 to the controller, or the beam stays on along every rapid",
    );
  if (!laser && machine.laserMode === true)
    report(
      "laser",
      "the controller's laser mode ($32) is on for a mill, so it will not wait for the spindle",
    );
}

function contextProblems(input: CheckInput, report: Report) {
  const { program, setup, machine, units } = input;
  if (program.units !== "mm")
    report("units", `the IR is in ${program.units}, not mm`);
  if (units !== machine.units)
    report("units", `output is ${units}, the machine runs ${machine.units}`);
  if (program.setupId !== setup.id)
    report("ir", `program is for setup ${program.setupId}, not ${setup.id}`);
  if (program.offsetIndex !== setup.wcs.offsetIndex)
    report(
      "ir",
      `program work offset ${program.offsetIndex} is not the setup's`,
    );
  if (!(setup.clearance > 0)) report("entry", "clearance must be above 0");
  if (!(setup.safeHeight >= setup.clearance))
    report("entry", "safe height must be at least the clearance");
  for (const text of validateMachine(machine)) report("machine", text);
  laserMode(machine, report);
  for (const tool of program.tools) {
    for (const text of validateTool(tool))
      report("tool", `tool ${tool.id}: ${text}`);
    if (!(tool.shankDiameter > 0))
      report("tool", `tool ${tool.id}: shank diameter must be greater than 0`);
  }
  termination(input.post, report);
}

export function checkProgram(input: CheckInput): CheckResult {
  const problems: Problem[] = [];
  const report: Report = (rule, reason, ...[section, move]) => {
    problems.push({
      rule,
      ...(section === undefined ? {} : { section }),
      ...(move === undefined ? {} : { move }),
      reason,
    });
  };
  const invalid = irProblems(input.program, report);
  const finite = setupNumbers(input).every(Number.isFinite);
  if (!finite)
    report("finite", "setup, stock, fixtures and machine must be finite");
  const boxes = boxProblems(input, report);
  contextProblems(input, report);
  sectionProblems(input, report);
  if (invalid || !finite || boxes || input.program.units !== "mm")
    return { problems, travel: { status: "unverified" }, qualified: false };
  const top = input.stock.max[2];
  const safe = top + input.setup.safeHeight;
  const ctx: Context = {
    ...input,
    safe,
    report,
  };
  const known = input.setup.wcs.machine.kind === "known";
  const travel = motionProblems(
    ctx,
    known && !validateMachine(input.machine).length,
  );
  return {
    problems,
    travel,
    qualified: !problems.length && travel.status === "within",
  };
}
