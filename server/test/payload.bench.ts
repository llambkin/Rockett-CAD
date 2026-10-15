import { beforeAll, expect, test } from "vitest";
import type { EvaluateResult } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { manyBodyPart, record, SAMPLES } from "./helpers/perfFixtures.js";

beforeAll(initKernel, 120_000);

test("evaluate many-body", { timeout: 1_800_000 }, async ({ bench }) => {
  const doc = manyBodyPart();
  const sync = { async: false };
  let runs = 0;
  let result: EvaluateResult | undefined;
  record(
    "evaluate cold many-body",
    await bench("evaluate cold many-body", sync, () => {
      const id = `bench-many-body-${++runs}`;
      result = engineFor(id).evaluate(doc);
      dropEngine(id);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  expect(result?.featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
  expect(result?.bodies).toHaveLength(1000);
  let json = "";
  record(
    "payload bytes many-body",
    await bench("payload bytes many-body", sync, () => {
      json = JSON.stringify(result);
    }).run(SAMPLES),
    SAMPLES.iterations,
  );
  console.log(`payload bytes many-body: ${Buffer.byteLength(json)} bytes`);
});
