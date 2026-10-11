import { expect, test } from "vitest";
import { dropCutter, indexMesh } from "../src/surface/dropCutter.js";
import { grid, samples, tools } from "./helpers/meshes.js";

const BUDGET_MS = 2000;
const CALLS = 100_000;
const SAMPLES = {
  iterations: 10,
  warmupIterations: 2,
  time: 0,
  warmupTime: 0,
  retainSamples: true,
};

test("dropCutter 100,000 calls on 200,000 triangles", async ({ bench }) => {
  const wave = grid(100, 317, (x, y) => 5 * Math.sin(x / 9) * Math.cos(y / 13));
  expect(wave.indices.length / 3).toBeGreaterThanOrEqual(200_000);
  const surface = indexMesh(wave);
  const tool = tools[1]!;
  const side = samples(-45, 45, 317);
  const result = await bench(
    "dropCutter 100,000 calls on 200,000 triangles",
    { async: false },
    () => {
      let calls = 0;
      for (const y of side)
        for (const x of side) {
          if (calls++ === CALLS) return;
          dropCutter(surface, tool, x, y);
        }
    },
  ).run(SAMPLES);
  const kept = result.latency.samples ?? [];
  console.log(
    `dropCutter ${CALLS} calls: ${kept.length} samples, median ${result.latency.p50.toFixed(0)} ms, slowest ${Math.max(...kept).toFixed(0)} ms`,
  );
  expect(kept).toHaveLength(SAMPLES.iterations);
  expect(result.latency.p50).toBeLessThan(BUDGET_MS);
});
