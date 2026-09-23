import { beforeAll, expect, test } from "vitest";
import { createEmptyDocument, type EvaluateResult } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { readImport } from "../src/geometry/importers.js";
import { record, SAMPLES, SLOW_SAMPLES } from "./helpers/perfFixtures.js";
import { largeStepFixture } from "./helpers/stepFixture.js";

const BOXES = 355;

beforeAll(initKernel, 120_000);

test("large STEP", { timeout: 3_600_000 }, async ({ bench }) => {
  const data = largeStepFixture(BOXES),
    bytes = Buffer.byteLength(data, "utf8");
  console.log(`large STEP fixture: ${BOXES} boxes, ${bytes} bytes`);
  expect(bytes).toBeGreaterThan(20_000_000);
  expect(bytes).toBeLessThan(30_000_000);
  const feature = {
    id: "step",
    type: "importStep" as const,
    name: "Large.step",
    suppressed: false,
    filename: "Large.step",
    data,
  };
  const doc = {
    ...createEmptyDocument("bench-large-step", "Large STEP"),
    features: [feature],
    timelinePosition: 1,
  };
  const sync = { async: false };
  let result: EvaluateResult | undefined;
  record(
    "import large STEP",
    await bench("import large STEP", sync, () => {
      dropEngine(doc.id);
      readImport(feature).delete();
      result = engineFor(doc.id).evaluate(doc);
    }).run(SLOW_SAMPLES),
    SLOW_SAMPLES.iterations,
  );
  expect(result?.featureStatuses).toEqual([
    { featureId: "step", status: "ok" },
  ]);
  expect(result?.bodies).toHaveLength(BOXES);
  const engine = engineFor(doc.id);
  record(
    "evaluate noop large STEP",
    await bench("evaluate noop large STEP", sync, () => {
      engine.evaluate(doc);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  dropEngine(doc.id);
});
