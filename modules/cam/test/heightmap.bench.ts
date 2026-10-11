import { expect, test } from "vitest";
import { simulateHeightmap } from "../src/client/heightmap.js";
import {
  endOf,
  type Move,
  type Program,
  type Section,
} from "../src/shared/ir.js";
import type { Box } from "../src/shared/setup.js";
import type { Tool } from "../src/shared/tools.js";

const MEDIAN_MS = 5000;
const P95_MS = 6000;
const MOVES = 50_000;
const CELL_MM = 0.5;
const SIDE = 300;
const MARGIN = 1.5;
const REACH = SIDE - 2 * MARGIN;
const SAMPLES = {
  iterations: 10,
  warmupIterations: 2,
  time: 0,
  warmupTime: 0,
  retainSamples: true,
};

const body = {
  name: "",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const tools: (Tool & { number: number })[] = [
  { ...body, id: "flat", number: 1, kind: "flat" },
  { ...body, id: "ball", number: 2, kind: "ball" },
  { ...body, id: "vbit", number: 3, kind: "vbit", tipAngle: 90 },
];

function raster(
  rows: number,
  perRow: number,
  z: (x: number, y: number) => number,
) {
  const moves: Move[] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < perRow; i++) {
      const x = MARGIN + (REACH * (j % 2 ? perRow - 1 - i : i)) / (perRow - 1);
      const y = MARGIN + (REACH * j) / (rows - 1);
      moves.push({
        kind: "feed",
        to: [x, y, z(x, y)],
        feed: 1000,
        role: "cut",
      });
    }
  return moves;
}

function waves(rows: number, arcs: number, z: number) {
  const r = REACH / arcs / 2;
  const moves: Move[] = [];
  for (let j = 0; j < rows; j++) {
    const y = MARGIN + (REACH * j) / (rows - 1);
    moves.push({ kind: "feed", to: [MARGIN, y, z], feed: 600, role: "cut" });
    for (let k = 0; k < arcs; k++)
      moves.push({
        kind: "arc",
        to: [MARGIN + 2 * r * (k + 1), y, z],
        centre: [MARGIN + r * (2 * k + 1), y, z],
        dir: k % 2 ? "ccw" : "cw",
        plane: "xy",
        feed: 600,
        role: "cut",
      });
  }
  return moves;
}

function section(toolId: string, cuts: Move[]): Section {
  const [x, y] = endOf(cuts[0]!, undefined)!;
  return {
    operationId: toolId,
    toolId,
    pass: "rough",
    coolant: "off",
    moves: [{ kind: "rapid", to: [x, y, 5] }, ...cuts],
  };
}

const stock: Box = { min: [0, 0, -20], max: [SIDE, SIDE, 0] };

const program: Program = {
  irVersion: 1,
  units: "mm",
  setupId: "bench",
  offsetIndex: 1,
  tools,
  sections: [
    section(
      "flat",
      raster(100, 100, () => -3),
    ),
    section(
      "ball",
      raster(297, 101, (x, y) => -6 + 2 * Math.sin(x / 20) * Math.cos(y / 30)),
    ),
    section("vbit", waves(100, 99, -1)),
  ],
};

test("cam-heightmap 50,000 moves on 300 by 300 mm at 0.5 mm", async ({
  bench,
}) => {
  expect(program.sections.flatMap(({ moves }) => moves)).toHaveLength(MOVES);
  const result = await bench("cam-heightmap", { async: false }, () => {
    simulateHeightmap(program, stock, CELL_MM);
  }).run(SAMPLES);
  const kept = result.latency.samples ?? [];
  const slowest = Math.max(...kept);
  console.log(
    `cam-heightmap ${MOVES} moves: ${kept.length} samples, median ${result.latency.p50.toFixed(0)} ms, p95 ${slowest.toFixed(0)} ms`,
  );
  expect(kept).toHaveLength(SAMPLES.iterations);
  expect(result.latency.p50).toBeLessThanOrEqual(MEDIAN_MS);
  expect(slowest).toBeLessThanOrEqual(P95_MS);
});
