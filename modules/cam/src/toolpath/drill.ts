import type { Hole } from "../kernel/holes.js";
import type { Cycle, Move, Section, Xy } from "../shared/ir.js";
import type { Box, Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";

type Drill = { tool: Tool; preset: Preset };

export type DrillInput = {
  operationId: string;
  setup: Pick<Setup, "safeHeight" | "clearance">;
  stock: Box;
  holes: Hole[];
  drills: Drill[];
  peck?: number;
};

type Refusal = {
  reason: "noDrill" | "blocked";
  diameter: number;
  points: Xy[];
};

export type DrillResult = { sections: Section[]; refused: Refusal[] };

const MATCH = 0.01;
const LENGTH = 1e-6;

function groups(holes: Hole[]): Hole[][] {
  const found: Hole[][] = [];
  for (const hole of holes) {
    const group = found.find(
      ([first]) => Math.abs(first!.diameter - hole.diameter) <= LENGTH,
    );
    if (group) group.push(hole);
    else {
      const after = found.findIndex(
        ([first]) => first!.diameter > hole.diameter,
      );
      found.splice(after < 0 ? found.length : after, 0, [hole]);
    }
  }
  return found;
}

function nearestFirst(holes: Hole[]): Hole[] {
  const left = [...holes];
  const ordered: Hole[] = [];
  let at: Xy = [0, 0];
  while (left.length) {
    const gap = ({ centre }: Hole) =>
      Math.hypot(centre[0] - at[0], centre[1] - at[1]);
    const next = left.reduce(
      (best, hole, i) => (gap(hole) < gap(left[best]!) ? i : best),
      0,
    );
    const [hole] = left.splice(next, 1);
    ordered.push(hole!);
    at = hole!.centre;
  }
  return ordered;
}

function cycles(input: DrillInput, holes: Hole[], feed: number): Cycle[] {
  const found: Cycle[] = [];
  for (const { centre, top, bottom } of holes) {
    const last = found.at(-1);
    if (
      last &&
      Math.abs(last.top - top) <= LENGTH &&
      Math.abs(last.bottom - bottom) <= LENGTH
    ) {
      last.points.push(centre);
      continue;
    }
    const clear = Math.max(top, input.stock.max[2]) + input.setup.clearance;
    const base = {
      kind: "cycle" as const,
      points: [centre],
      clear,
      top,
      bottom,
      feed,
    };
    found.push(
      input.peck === undefined
        ? { ...base, cycle: "drill" }
        : { ...base, cycle: "peck", peck: input.peck },
    );
  }
  return found;
}

function section(
  input: DrillInput,
  holes: Hole[],
  { tool, preset }: Drill,
): Section {
  const ordered = nearestFirst(holes);
  const safe = input.stock.max[2] + input.setup.safeHeight;
  const [first, last] = [ordered[0]!.centre, ordered.at(-1)!.centre];
  const moves: Move[] = [
    { kind: "rapid", to: [first[0], first[1], safe] },
    ...cycles(input, ordered, preset.plungeFeed),
    { kind: "rapid", to: [last[0], last[1], safe] },
  ];
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "rough",
    spindle: { rpm: preset.rpm, dir: "cw" },
    coolant: preset.coolant,
    moves,
  };
}

export function drill(input: DrillInput): DrillResult {
  if (
    input.peck !== undefined &&
    !(input.peck > 0 && Number.isFinite(input.peck))
  )
    throw new RangeError("peck must be a number above 0");
  const result: DrillResult = { sections: [], refused: [] };
  const refuse = (reason: Refusal["reason"], holes: Hole[]) =>
    result.refused.push({
      reason,
      diameter: holes[0]!.diameter,
      points: nearestFirst(holes).map(({ centre }) => centre),
    });
  for (const holes of groups(input.holes.filter(({ blocked }) => !blocked))) {
    const diameter = holes[0]!.diameter;
    const gap = ({ tool }: Drill) => Math.abs(tool.diameter - diameter);
    const match = input.drills.reduce<Drill | undefined>(
      (best, entry) =>
        entry.tool.kind === "drill" &&
        gap(entry) <= MATCH + LENGTH &&
        !(best && gap(best) <= gap(entry))
          ? entry
          : best,
      undefined,
    );
    if (match) result.sections.push(section(input, holes, match));
    else refuse("noDrill", holes);
  }
  for (const holes of groups(input.holes.filter(({ blocked }) => blocked)))
    refuse("blocked", holes);
  return result;
}
