import type { Move, Section, Xyz } from "../shared/ir.js";
import type { Box, Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";

export type FacingInput = {
  operationId: string;
  setup: Pick<Setup, "safeHeight" | "clearance">;
  stock: Box;
  modelTop: number;
  tool: Tool;
  preset: Preset;
};

const EPSILON = 1e-9;

function steps(length: number, step: number): number {
  return Math.max(1, Math.ceil(length / step - EPSILON));
}

function rows({ stock, tool, preset }: FacingInput): number[] {
  const radius = tool.diameter / 2;
  const stepover = preset.stepoverFraction * tool.diameter;
  if (!(preset.stepoverFraction > 0 && preset.stepoverFraction <= 1))
    throw new RangeError("stepover fraction must be above 0 and at most 1");
  if (!(stepover > 0)) throw new RangeError("tool diameter must be above 0");
  const [, from] = stock.min;
  const count = steps(stock.max[1] - from, stepover);
  return Array.from(
    { length: count },
    (_, k) => from - radius + (k + 1) * stepover,
  );
}

function levels({ stock, modelTop, preset }: FacingInput): number[] {
  const top = stock.max[2];
  if (!(top > modelTop))
    throw new RangeError("stock top must be above the model top");
  if (!(preset.stepdown > 0)) throw new RangeError("stepdown must be above 0");
  const count = steps(top - modelTop, preset.stepdown);
  return Array.from({ length: count }, (_, i) =>
    i + 1 < count ? top - (i + 1) * preset.stepdown : modelTop,
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
  for (const [level, z] of levels(input).entries()) {
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
