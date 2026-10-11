import { fixturesMet, keepOut, reachOf } from "./checkSweep.js";
import {
  endOf,
  type Move,
  type Program,
  type Section,
  type Xy,
  type Xyz,
} from "../shared/ir.js";
import type { Box, Fixture, Setup } from "../shared/setup.js";
import { spinsUp } from "../shared/time.js";

export type LinkInput = {
  setup: Pick<Setup, "clearance" | "fixtures">;
  stock: Pick<Box, "max">;
  spinUpSeconds?: number | undefined;
};

export type Lift = { z: number; fixture?: Fixture };

const CUTS = new Set<Move["kind"]>(["feed", "arc", "cycle"]);

export function liftOver(
  from: Xy,
  to: Xy,
  reach: number,
  { setup, stock }: Pick<LinkInput, "setup" | "stock">,
): Lift {
  const { clearance, fixtures } = setup;
  const z = stock.max[2] + clearance;
  const path = { from: [...from, z] as Xyz, to: [...to, z] as Xyz };
  const met = fixturesMet(
    [{ ...path, rapid: true, grow: 0 }],
    fixtures,
    clearance,
    reach,
  );
  return met.reduce<Lift>(
    (lift, fixture) => {
      const { top } = keepOut(fixture, clearance, reach);
      return top > lift.z ? { z: top, fixture } : lift;
    },
    { z },
  );
}

function lastCut(moves: Move[]) {
  const i = moves.findLastIndex((move) => CUTS.has(move.kind));
  const at = i < 0 ? undefined : endOf(moves[i]!, undefined);
  return at && { i, at };
}

function firstCut(moves: Move[]) {
  const i = moves.findIndex((move) => CUTS.has(move.kind));
  const head = moves.slice(0, Math.max(i, 0));
  const opening = head.findLast((move) => move.kind === "rapid");
  return opening && { i, at: opening.to };
}

const rapid = (to: Xyz): Move => ({ kind: "rapid", to });

const notRapid = (move: Move) => move.kind !== "rapid";

const same = (p: Xyz, q: Xyz) => p.every((v, k) => v === q[k]);

function join(
  before: Section,
  section: Section,
  input: LinkInput,
  reach: number,
) {
  const end = lastCut(before.moves);
  const start = firstCut(section.moves);
  if (!end || !start) return undefined;
  const [a, b] = [end.at, start.at];
  const lift = liftOver([a[0], a[1]], [b[0], b[1]], reach, input);
  const top: Xyz = [a[0], a[1], Math.max(lift.z, a[2])];
  const over: Xyz = [b[0], b[1], top[2]];
  return {
    tail: [
      ...before.moves.slice(0, end.i + 1),
      ...before.moves.slice(end.i + 1).filter(notRapid),
      ...(same(top, a) ? [] : [rapid(top)]),
    ],
    head: [
      ...section.moves.slice(0, start.i).filter(notRapid),
      ...[over, b].filter((p, i) => !same(p, i ? over : top)).map(rapid),
      ...section.moves.slice(start.i),
    ],
  };
}

export function linked(program: Program, input: LinkInput): Program {
  const tools = new Map(program.tools.map((tool) => [tool.id, tool]));
  const sections: Section[] = [];
  for (const [s, section] of program.sections.entries()) {
    const original = program.sections[s - 1];
    const before = sections.at(-1);
    let moves = section.moves;
    if (before && original?.toolId === section.toolId) {
      const joined = join(
        before,
        section,
        input,
        reachOf(tools.get(section.toolId)),
      );
      if (joined) {
        sections[sections.length - 1] = { ...before, moves: joined.tail };
        moves = joined.head;
      }
    }
    const seconds = input.spinUpSeconds;
    if (seconds && spinsUp(original, section))
      moves = [{ kind: "dwell", seconds }, ...moves];
    sections.push({ ...section, moves });
  }
  return { ...program, sections };
}
