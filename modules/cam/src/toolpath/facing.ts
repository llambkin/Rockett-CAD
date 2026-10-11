import type { Move, Section, Xyz } from "../shared/ir.js";
import { toolRefusal } from "../shared/operations.js";
import type { Box, Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";
import { checkMoves, depthLevels, stepoverOf, steps } from "./geometry.js";

export type FacingInput = {
  operationId: string;
  setup: Pick<Setup, "safeHeight" | "clearance">;
  stock: Box;
  modelTop: number;
  tool: Tool;
  preset: Preset;
};

function rows({ stock, tool, preset }: FacingInput): number[] {
  const refusal = toolRefusal("rockett.cam.facing", tool.kind);
  if (refusal) throw new RangeError(refusal);
  const radius = tool.diameter / 2;
  const stepover = stepoverOf(preset, tool);
  if (!(stepover > 0)) throw new RangeError("tool diameter must be above 0");
  const [, from] = stock.min;
  const count = steps(stock.max[1] - from, stepover);
  return Array.from(
    { length: count },
    (_, k) => from - radius + (k + 1) * stepover,
  );
}

export function facing(input: FacingInput): Section {
  const { stock, tool, preset, setup } = input;
  const radius = tool.diameter / 2;
  const ends = [stock.min[0] - radius, stock.max[0] + radius];
  const ys = rows(input);
  const top = stock.max[2];
  const start: Xyz = [ends[0]!, ys[0]!, top + setup.safeHeight];
  const moves: Move[] = [
    { kind: "rapid", to: start },
    { kind: "rapid", to: [start[0], start[1], top + setup.clearance] },
  ];
  let side = 0;
  let at = start;
  const levels = depthLevels(top, input.modelTop, preset.stepdown);
  for (const [level, z] of levels.entries()) {
    for (let row = 0; row < ys.length; row++) {
      const y = ys[level % 2 ? ys.length - 1 - row : row]!;
      const x = ends[side]!;
      moves.push(
        row
          ? { kind: "feed", to: [x, y, z], feed: preset.cutFeed, role: "link" }
          : {
              kind: "feed",
              to: [x, y, z],
              feed: preset.plungeFeed,
              role: "plunge",
            },
      );
      side = 1 - side;
      at = [ends[side]!, y, z];
      moves.push({ kind: "feed", to: at, feed: preset.cutFeed, role: "cut" });
    }
    checkMoves(
      `facing at depth level ${level + 1} of ${levels.length}`,
      moves.length,
    );
  }
  moves.push({ kind: "rapid", to: [at[0], at[1], top + setup.safeHeight] });
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "rough",
    spindle: { rpm: preset.rpm, dir: "cw" },
    coolant: preset.coolant,
    moves,
  };
}
