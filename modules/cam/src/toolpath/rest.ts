import type { Section } from "../shared/ir.js";
import type { Tool } from "../shared/tools.js";
import {
  PIECE,
  checkCut,
  intersectLoops,
  offsetLoops,
  stepoverOf,
  subtractLoops,
  unionLoops,
  type Loop,
} from "./geometry.js";
import {
  SKIN,
  clearRegion,
  flatFloor,
  provenCleared,
  type PocketInput,
} from "./pocket.js";

export type Prior = Pick<
  PocketInput,
  "operationId" | "tool" | "preset" | "boundary" | "islands" | "bottom"
>;

export type RestInput = PocketInput & { prior: Prior };

export type Rest =
  { section: Section } | { section: undefined; reason: string };

export type RestOperation = { id: string; prior: string };

export type SetupOperation = {
  id: string;
  type?: string;
  suppressed?: boolean;
};

export type PriorStatus<O> =
  { status: "fresh"; prior: O } | { status: "stale"; reason: string };

const POCKET = "rockett.cam.pocket";
const FINE = 1e-4;

const regionOf = ({ boundary, islands }: Pick<Prior, "boundary" | "islands">) =>
  subtractLoops([boundary], islands);

const opening = (loops: Loop[], radius: number) =>
  offsetLoops(offsetLoops(loops, -radius, FINE), radius, FINE);

export function leftover(region: Loop[], prior: Prior): Loop[] {
  const opened = opening(regionOf(prior), prior.tool.diameter / 2);
  return opening(subtractLoops(region, opened), PIECE / 2);
}

const cornerOf = (tool: Tool) => (tool.kind === "bull" ? tool.cornerRadius : 0);

export function rest(input: RestInput): Rest {
  checkCut("pocket", input);
  const { prior, tool, preset } = input;
  if (!(tool.diameter < prior.tool.diameter))
    throw new RangeError(
      `a rest pass needs a tool smaller than the ${prior.tool.diameter} mm tool of ${prior.operationId}`,
    );
  if (input.bottom < prior.bottom)
    throw new RangeError(
      `the rest floor at ${input.bottom} is below the floor at ${prior.bottom} of ${prior.operationId}`,
    );
  const region = regionOf(input);
  const beyond = (cleared: Loop[]) =>
    opening(subtractLoops(region, cleared), SKIN);
  const near = (loops: Loop[], by: number) =>
    loops.length ? intersectLoops(region, offsetLoops(loops, by)) : [];
  const cleared = provenCleared(regionOf(prior), prior.tool.diameter / 2);
  const left = unionLoops([...leftover(region, prior), ...beyond(cleared)]);
  const corner = cornerOf(prior.tool);
  const below = prior.bottom + corner;
  const floor = input.bottom < below ? flatFloor(prior, corner) : undefined;
  const fillet = floor ? unionLoops([...left, ...beyond(floor)]) : [];
  if (!left.length && !fillet.length)
    return {
      section: undefined,
      reason: `${prior.operationId} leaves no material for the ${tool.diameter} mm tool`,
    };
  return {
    section: clearRegion(input, {
      region,
      target: near(left, tool.diameter + stepoverOf(preset, tool)),
      cleared,
      ...(floor && {
        floor: { below, target: near(fillet, tool.diameter), cleared: floor },
      }),
    }),
  };
}

export function restPrior<O extends SetupOperation>(
  setup: { operations?: O[] },
  operation: RestOperation,
  fresh: (prior: O) => boolean,
): PriorStatus<O> {
  const operations = setup.operations ?? [];
  const at = operations.findIndex(({ id }) => id === operation.prior);
  const prior = operations[at];
  const named = `prior ${operation.prior}`;
  if (!prior) return { status: "stale", reason: `${named} is missing` };
  if (at >= operations.findIndex(({ id }) => id === operation.id))
    return { status: "stale", reason: `${named} is not earlier in the setup` };
  if (prior.type !== POCKET)
    return { status: "stale", reason: `${named} is not a pocket` };
  if (prior.suppressed)
    return { status: "stale", reason: `${named} is suppressed` };
  if (!fresh(prior)) return { status: "stale", reason: `${named} is stale` };
  return { status: "fresh", prior };
}
