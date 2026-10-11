import data from "./materials.json";
import {
  availableWatts,
  machineRigidity,
  RIGIDITY_OPTIONS,
  spindleRange,
  type MachineProfile,
  type Rigidity,
} from "../shared/machine.js";
import { TOOL_KINDS, type Preset, type Tool } from "../shared/tools.js";

type Band = { from: number; chipload: number };

type Material = { name: string; chart: string; unitPower?: number } & (
  { rpm: number } | { cuttingSpeed: number }
);

const CHARTS: Record<string, Band[]> = data.charts;
const MATERIALS: Record<string, Material> = data.materials;

export const MATERIAL_OPTIONS = Object.entries(MATERIALS).map(
  ([id, { name }]): [string, string] => [id, name],
);

const POWER_SHARE = 0.8;
const MIN_STEPDOWN_FRACTION = 0.1;
const BAND_EDGE = 1e-6;

const RIGIDITY: Record<Rigidity, { chipload: number; stepdown: number }> = {
  light: { chipload: 0.7, stepdown: 0.5 },
  medium: { chipload: 0.9, stepdown: 1 },
  rigid: { chipload: 1, stepdown: 1 },
};

export function rigidityTerms(rigidity: Rigidity) {
  const { chipload, stepdown } = RIGIDITY[rigidity];
  return `takes ${Math.round(chipload * 100)}% of the chart chip load and a stepdown of ${stepdown} x D`;
}

const CHARTED = new Set<Tool["kind"]>(["flat", "bull", "ball"]);

function kindInWords(kind: Tool["kind"]) {
  const label = TOOL_KINDS.find(([id]) => id === kind)![1];
  return `a ${label.replace(/^[A-Z](?=[a-z])/, (first) => first.toLowerCase())}`;
}

export type Feeds = Pick<
  Preset,
  "rpm" | "cutFeed" | "plungeFeed" | "stepdown" | "stepoverFraction"
>;

export type Limit = {
  limit:
    | "rpmMax"
    | "rpmMin"
    | "feedCap"
    | "rpmFloor"
    | "plungeCap"
    | "power"
    | "powerUnchecked"
    | "outsideChart"
    | "rigidity"
    | "ballNose"
    | "preset";
  reason: string;
};

export type Suggestion = Feeds & { limits: Limit[] };

function checkTool(tool: Tool) {
  if (!(Number.isInteger(tool.flutes) && tool.flutes >= 1))
    throw new RangeError("flutes must be a whole number of at least 1");
  if (!(Number.isFinite(tool.diameter) && tool.diameter > 0))
    throw new RangeError("diameter must be above 0 and finite");
  if (!CHARTED.has(tool.kind))
    throw new RangeError(
      `the feed charts cover flat, bull nose and ball nose end mills, not ${kindInWords(tool.kind)}`,
    );
}

function cuttingDiameter(tool: Tool, stepdown: number, limits: Limit[]) {
  if (tool.kind !== "ball" || !(stepdown > 0 && stepdown < tool.diameter / 2))
    return tool.diameter;
  const effective = 2 * Math.sqrt(stepdown * (tool.diameter - stepdown));
  limits.push({
    limit: "ballNose",
    reason: `a ball nose at ${Number(stepdown.toFixed(2))} mm stepdown cuts at its ${effective.toFixed(2)} mm effective diameter`,
  });
  return effective;
}

function chartBand(
  material: Material,
  diameter: number,
  limits: Limit[],
): Band {
  const bands = CHARTS[material.chart] ?? [];
  let band: Band | undefined;
  for (const row of bands) if (row.from - BAND_EDGE <= diameter) band = row;
  if (!band)
    throw new RangeError(
      `a ${diameter} mm tool is smaller than the ${bands[0]?.from} mm the ${material.name} chart starts at`,
    );
  if (band === bands.at(-1) && diameter > band.from + BAND_EDGE)
    limits.push({
      limit: "outsideChart",
      reason: `a ${diameter} mm tool is above the ${band.from} mm the ${material.name} chart ends at; it takes that size's chip load`,
    });
  return band;
}

function spindleSpeed(
  material: Material,
  diameter: number,
  machine: MachineProfile,
  limits: Limit[],
): number {
  const wanted =
    "rpm" in material
      ? material.rpm
      : (material.cuttingSpeed * 1000) / (Math.PI * diameter);
  const { min, max } = spindleRange(machine);
  if (wanted > max) {
    limits.push({
      limit: "rpmMax",
      reason: `the chart asks ${Math.round(wanted)} rpm; the spindle tops out at ${max} rpm`,
    });
    return max;
  }
  if (wanted < min) {
    limits.push({
      limit: "rpmMin",
      reason: `the chart asks ${Math.round(wanted)} rpm; the spindle runs no slower than ${min} rpm`,
    });
    return min;
  }
  return wanted;
}

function feedAtCap(
  tool: Tool,
  chipload: number,
  rpm: number,
  machine: MachineProfile,
  limits: Limit[],
) {
  const cap = Math.min(machine.maxFeedX, machine.maxFeedY);
  const cutFeed = rpm * tool.flutes * chipload;
  if (cutFeed <= cap) return { rpm, cutFeed };
  const slower = cap / (tool.flutes * chipload);
  const { min } = spindleRange(machine);
  if (slower >= min) {
    limits.push({
      limit: "feedCap",
      reason: `the ${cap} mm/min max feed lowers the spindle to ${Math.round(slower)} rpm to keep the chipload`,
    });
    return { rpm: slower, cutFeed: cap };
  }
  limits.push({
    limit: "rpmFloor",
    reason: `the ${cap} mm/min max feed at the ${min} rpm spindle minimum lowers the chipload to ${(cap / (min * tool.flutes)).toFixed(4)} mm`,
  });
  return { rpm: min, cutFeed: cap };
}

function withinPower(
  material: Material,
  tool: Tool,
  machine: MachineProfile,
  feeds: Feeds,
  limits: Limit[],
): Feeds {
  const watts = availableWatts(machine, feeds.rpm);
  if (material.unitPower === undefined || watts === undefined) {
    limits.push({
      limit: "powerUnchecked",
      reason:
        material.unitPower === undefined
          ? `no unit power is shipped for ${material.name}`
          : "the machine has no rated spindle power",
    });
    return feeds;
  }
  const perDepthAndWidth = (material.unitPower * feeds.cutFeed) / 60;
  const budget = POWER_SHARE * watts;
  const cutting =
    perDepthAndWidth * feeds.stepdown * feeds.stepoverFraction * tool.diameter;
  if (cutting <= budget) return feeds;
  const floor = MIN_STEPDOWN_FRACTION * tool.diameter;
  const stepdown = Math.max(floor, (feeds.stepdown * budget) / cutting);
  const stepoverFraction =
    stepdown > floor
      ? feeds.stepoverFraction
      : budget / (perDepthAndWidth * floor * tool.diameter);
  limits.push({
    limit: "power",
    reason: `cutting takes ${Math.round(cutting)} W, above ${POWER_SHARE * 100}% of the ${Math.round(watts)} W the spindle gives at ${Math.round(feeds.rpm)} rpm; stepdown ${stepdown.toFixed(2)} mm, stepover ${Math.round(stepoverFraction * 100)}%`,
  });
  return { ...feeds, stepdown, stepoverFraction };
}

export function suggestFeeds(
  tool: Tool,
  material: string,
  machine: MachineProfile,
  preset: Partial<Feeds> = {},
): Suggestion {
  checkTool(tool);
  const entry = Object.hasOwn(MATERIALS, material)
    ? MATERIALS[material]
    : undefined;
  if (!entry) throw new RangeError(`no feeds for material ${material}`);
  const limits: Limit[] = [];
  const rigidity = machineRigidity(machine);
  const factor = RIGIDITY[rigidity];
  if (rigidity !== "rigid")
    limits.push({
      limit: "rigidity",
      reason: `${RIGIDITY_OPTIONS.find(([id]) => id === rigidity)![1]} rigidity ${rigidityTerms(rigidity)}`,
    });
  const stepdown = tool.diameter * factor.stepdown;
  const diameter = cuttingDiameter(tool, preset.stepdown ?? stepdown, limits);
  const band = chartBand(entry, diameter, limits);
  const speed = spindleSpeed(entry, diameter, machine, limits);
  const chipload = band.chipload * factor.chipload;
  const { rpm, cutFeed } = feedAtCap(tool, chipload, speed, machine, limits);
  let plungeFeed = cutFeed / tool.flutes;
  if (plungeFeed > machine.maxFeedZ) {
    limits.push({
      limit: "plungeCap",
      reason: `the ${machine.maxFeedZ} mm/min Z max feed caps the plunge`,
    });
    plungeFeed = machine.maxFeedZ;
  }
  const feeds = withinPower(
    entry,
    tool,
    machine,
    { rpm, cutFeed, plungeFeed, stepdown, stepoverFraction: 1 },
    limits,
  );
  const set = Object.keys(preset);
  if (set.length)
    limits.push({
      limit: "preset",
      reason: `the preset sets ${set.join(", ")}`,
    });
  return { ...feeds, ...preset, limits };
}
