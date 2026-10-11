import { suggestFeeds, type Suggestion } from "../feeds/suggest.js";
import type { Hole } from "../kernel/holes.js";
import { intrudes, keepOut } from "../post/checkSweep.js";
import type { Xy } from "../shared/ir.js";
import type { MachineProfile } from "../shared/machine.js";
import type { FaceRef } from "../shared/params.js";
import type { Setup } from "../shared/setup.js";
import { newPreset, type Preset, type Tool } from "../shared/tools.js";
import { drill } from "../toolpath/drill.js";

export type PlanTool = Tool & { presets: Preset[] };

export type Footprint = { min: Xy; max: Xy };

export type PocketFeature = {
  id: string;
  name: string;
  floor: FaceRef;
  z: number;
  width: number;
  cornerRadius: number;
  footprint: Footprint;
};

export type ProfileFeature = {
  id: string;
  name: string;
  face: FaceRef;
  z: number;
  footprint: Footprint;
} & (
  | { side: "outside" }
  | { side: "inside"; opening: number; width: number; cornerRadius: number }
);

export type PlanFeatures = {
  stockTop: number;
  stockOutline: Footprint;
  modelTop: number;
  holes: Hole[];
  pockets: PocketFeature[];
  profiles: ProfileFeature[];
};

export type PlannedFeeds = { presetId: string } | { suggested: Suggestion };

export type PlannedOperation = {
  id: string;
  type: string;
  name: string;
  toolId: string;
  feeds: PlannedFeeds;
  params: Record<string, unknown>;
  prior?: string;
};

export type Unplanned = { feature: string; reason: string };

export type Plan = { operations: PlannedOperation[]; unplanned: Unplanned[] };

type Staged = PlannedOperation & { floor: number };

type Draft = Omit<Staged, "toolId" | "feeds">;

type PlanSetup = Pick<Setup, "material" | "clearance" | "fixtures">;

type Context = {
  stockTop: number;
  unplanned: Unplanned[];
  blocked: (
    feature: string,
    at: Footprint,
    z: number,
    reach?: number,
  ) => boolean;
  flats: (depth: number) => PlanTool[];
  add: (stage: Staged[], feature: string, tool: PlanTool, op: Draft) => boolean;
};

type Pocketable = {
  id: string;
  name: string;
  z: number;
  width: number;
  cornerRadius: number;
  params: Record<string, unknown>;
};

const LENGTH = 1e-6;
const RAMP_ANGLE = 5;
const ENGAGEMENT = 60;
const TABS = { count: 4, width: 6, height: 2 };

const mm = (value: number) => Number(value.toFixed(3));
const shown = ([x, y]: Xy) => `(${mm(x)}, ${mm(y)})`;
const holeName = ({ diameter, centre }: Pick<Hole, "diameter" | "centre">) =>
  `Hole ${mm(diameter)} mm at ${shown(centre)}`;

const largestFirst = (a: Tool, b: Tool) =>
  b.diameter - a.diameter || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const reaches = (tool: Tool, radius: number) =>
  tool.diameter / 2 <= radius + LENGTH;

function context(
  setup: PlanSetup,
  stockTop: number,
  tools: PlanTool[],
  machine: MachineProfile,
): Context {
  const unplanned: Unplanned[] = [];
  const feedsOf = (tool: PlanTool): PlannedFeeds | string => {
    const [preset] = tool.presets;
    if (preset) return { presetId: preset.id };
    if (!setup.material)
      return `${tool.name} has no preset and the setup names no material`;
    try {
      return { suggested: suggestFeeds(tool, setup.material, machine) };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return `${tool.name} has no preset and ${error.message}`;
    }
  };
  return {
    stockTop,
    unplanned,
    blocked(feature, at, z, reach = 0) {
      const hit = setup.fixtures.find((fixture) =>
        intrudes(at, z, keepOut(fixture, setup.clearance, reach)),
      );
      if (hit) unplanned.push({ feature, reason: `blocked by ${hit.name}` });
      return Boolean(hit);
    },
    flats: (depth) =>
      tools
        .filter(
          (tool) =>
            tool.kind === "flat" &&
            tool.centreCutting &&
            tool.fluteLength + LENGTH >= depth,
        )
        .toSorted(largestFirst),
    add(stage, feature, tool, op) {
      const feeds = feedsOf(tool);
      if (typeof feeds === "string") {
        unplanned.push({ feature, reason: feeds });
        return false;
      }
      stage.push({ ...op, toolId: tool.id, feeds });
      return true;
    },
  };
}

function planFacing(
  plan: Context,
  { modelTop, stockOutline }: PlanFeatures,
): Staged[] {
  const facing: Staged[] = [];
  if (!(plan.stockTop > modelTop + LENGTH)) return facing;
  const depth = plan.stockTop - modelTop;
  const [tool] = plan.flats(depth);
  if (!tool)
    plan.unplanned.push({
      feature: "Stock top",
      reason: `no flat tool reaches ${mm(depth)} mm deep`,
    });
  else if (
    !plan.blocked("Stock top", stockOutline, modelTop, tool.diameter / 2)
  )
    plan.add(facing, "Stock top", tool, {
      id: "facing",
      type: "rockett.cam.facing",
      name: "Face stock top",
      params: {},
      floor: modelTop,
    });
  return facing;
}

function planHoles(plan: Context, holes: Hole[], tools: PlanTool[]) {
  const drilling: Staged[] = [];
  const pocketables: Pocketable[] = [];
  const drills = tools.filter(({ kind }) => kind === "drill");
  const drilled = drill({
    operationId: "plan",
    setup: { safeHeight: 0, clearance: 0 },
    stock: { min: [0, 0, plan.stockTop], max: [0, 0, plan.stockTop] },
    holes,
    drills: drills.map((tool) => ({
      tool,
      preset: tool.presets[0] ?? newPreset(0, tool.id),
    })),
  });
  const holesAt = ([x, y]: Xy) =>
    holes.filter(
      ({ centre }) =>
        Math.abs(centre[0] - x) <= LENGTH && Math.abs(centre[1] - y) <= LENGTH,
    );
  for (const section of drilled.sections) {
    const points = section.moves.flatMap((move) =>
      move.kind === "cycle" ? move.points : [],
    );
    const tool = drills.find(({ id }) => id === section.toolId)!;
    const gap = ({ diameter }: Hole) => Math.abs(diameter - tool.diameter);
    const { diameter } = holesAt(points[0]!).reduce((best, hole) =>
      gap(hole) < gap(best) ? hole : best,
    );
    const name = `Drill ${points.length} x ${mm(diameter)} mm`;
    plan.add(drilling, name, tool, {
      id: `drill:${mm(diameter)}`,
      type: "rockett.cam.drill",
      name,
      params: { diameter, points },
      floor: 0,
    });
  }
  for (const refused of drilled.refused) {
    if (refused.reason === "blocked") {
      plan.unplanned.push({
        feature: `Holes ${refused.points.length} x ${mm(refused.diameter)} mm`,
        reason: `material stands in the drill column at ${refused.points.map(shown).join(", ")}`,
      });
      continue;
    }
    for (const point of refused.points) {
      const { centre, diameter, top, bottom } = holesAt(point).find(
        ({ diameter: size }) => Math.abs(size - refused.diameter) <= LENGTH,
      )!;
      pocketables.push({
        id: `hole:${mm(centre[0])},${mm(centre[1])}`,
        name: holeName({ centre, diameter }),
        z: bottom,
        width: diameter,
        cornerRadius: diameter / 2,
        params: {
          hole: { centre, diameter, top, bottom },
          rampAngle: RAMP_ANGLE,
        },
      });
    }
  }
  return { drilling, pocketables };
}

function planPocket(
  plan: Context,
  pocket: Pocketable,
  roughing: Staged[],
  rests: Staged[][],
) {
  const depth = plan.stockTop - pocket.z;
  const usable = plan.flats(depth);
  const rough = usable.find(({ diameter }) => diameter < pocket.width);
  if (!rough) {
    plan.unplanned.push({
      feature: pocket.name,
      reason: `no flat tool narrower than ${mm(pocket.width)} mm reaches ${mm(depth)} mm deep`,
    });
    return;
  }
  const adaptive = pocket.width >= 2 * rough.diameter;
  let prior = { id: `${pocket.id}:rough`, tool: rough };
  const roughed = plan.add(roughing, pocket.name, rough, {
    id: prior.id,
    type: adaptive ? "rockett.cam.adaptive" : "rockett.cam.pocket",
    name: `${adaptive ? "Adaptive" : "Pocket"}, ${pocket.name}`,
    params: adaptive
      ? { ...pocket.params, engagement: ENGAGEMENT }
      : pocket.params,
    floor: pocket.z,
  });
  if (!roughed) return;
  const feature = `${pocket.name} corners`;
  let pass = 0;
  for (const tool of usable) {
    if (reaches(prior.tool, pocket.cornerRadius)) break;
    if (tool.diameter >= prior.tool.diameter) continue;
    const id = `${pocket.id}:rest${++pass}`;
    const added = plan.add((rests[pass - 1] ??= []), feature, tool, {
      id,
      type: "rockett.cam.pocket",
      name: `Rest, ${feature}`,
      params: pocket.params,
      prior: prior.id,
      floor: pocket.z,
    });
    if (!added) return;
    prior = { id, tool };
  }
  if (!reaches(prior.tool, pocket.cornerRadius))
    plan.unplanned.push({
      feature,
      reason: `radius ${mm(pocket.cornerRadius)} mm: no flat tool of ${mm(2 * pocket.cornerRadius)} mm or less`,
    });
}

function planProfile(
  plan: Context,
  profile: ProfileFeature,
  insides: Staged[],
  outers: Staged[],
) {
  const depth = plan.stockTop - profile.z;
  const usable = plan.flats(depth);
  const outside = profile.side === "outside";
  const tool = outside
    ? usable[0]
    : usable.find(
        (each) =>
          each.diameter < profile.width && reaches(each, profile.cornerRadius),
      );
  if (!tool) {
    plan.unplanned.push({
      feature: profile.name,
      reason: `no flat tool ${outside ? "" : `of ${mm(2 * profile.cornerRadius)} mm or less `}reaches ${mm(depth)} mm deep`,
    });
    return;
  }
  const reach = outside ? tool.diameter / 2 : 0;
  if (plan.blocked(profile.name, profile.footprint, profile.z, reach)) return;
  plan.add(outside ? outers : insides, profile.name, tool, {
    id: profile.id,
    type: "rockett.cam.contour",
    name: outside
      ? `Contour, outer, ${TABS.count} tabs`
      : `Contour, inside, ${profile.name}`,
    params: {
      face: profile.face,
      side: profile.side,
      bottomOffset: 0,
      ...(outside ? { tabs: TABS } : { opening: profile.opening }),
    },
    floor: profile.z,
  });
}

function ordered(stages: Staged[][], manual: boolean): PlannedOperation[] {
  const operations: PlannedOperation[] = [];
  for (const stage of stages) {
    const byFloor = stage.toSorted((a, b) => b.floor - a.floor);
    const spindle = operations.at(-1)?.toolId;
    const tools = [...new Set(byFloor.map(({ toolId }) => toolId))];
    const first = manual && spindle && tools.includes(spindle) ? [spindle] : [];
    for (const toolId of new Set([...first, ...tools]))
      for (const { floor: _floor, ...op } of byFloor)
        if (op.toolId === toolId) operations.push(op);
  }
  return operations;
}

const around = ({ centre: [x, y], diameter }: Hole): Footprint => ({
  min: [x - diameter / 2, y - diameter / 2],
  max: [x + diameter / 2, y + diameter / 2],
});

export function planOperations(
  setup: PlanSetup,
  features: PlanFeatures,
  tools: PlanTool[],
  machine: MachineProfile,
): Plan {
  const plan = context(setup, features.stockTop, tools, machine);
  const facing = planFacing(plan, features);
  const holes = features.holes.filter(
    (hole) => !plan.blocked(holeName(hole), around(hole), hole.bottom),
  );
  const { drilling, pocketables } = planHoles(plan, holes, tools);
  const roughing: Staged[] = [];
  const rests: Staged[][] = [];
  for (const { floor, footprint, ...pocket } of features.pockets)
    if (!plan.blocked(pocket.name, footprint, pocket.z))
      planPocket(
        plan,
        { ...pocket, params: { floor, rampAngle: RAMP_ANGLE } },
        roughing,
        rests,
      );
  for (const pocket of pocketables) planPocket(plan, pocket, roughing, rests);
  const insides: Staged[] = [];
  const outers: Staged[] = [];
  for (const profile of features.profiles)
    planProfile(plan, profile, insides, outers);
  const stages = [facing, drilling, roughing, ...rests, insides, outers];
  const manual = machine.toolChange === "perFile";
  return { operations: ordered(stages, manual), unplanned: plan.unplanned };
}
