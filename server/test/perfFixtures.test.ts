import { beforeAll, expect, it } from "vitest";
import { initKernel } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { manyBodyPart, manyFeaturePart } from "./helpers/perfFixtures.js";

beforeAll(initKernel, 120_000);

function evaluate(doc: ReturnType<typeof manyBodyPart>) {
  const id = `${doc.id}-test`;
  try {
    return engineFor(id).evaluate(doc);
  } finally {
    dropEngine(id);
  }
}

it("builds the same documents on every call", () => {
  expect(manyFeaturePart()).toEqual(manyFeaturePart());
  expect(manyBodyPart()).toEqual(manyBodyPart());
  expect(manyFeaturePart().features).toHaveLength(302);
});

it("evaluates a small many-feature part to one body with no error", () => {
  const { bodies, featureStatuses } = evaluate(manyFeaturePart(4));
  expect(featureStatuses).toHaveLength(14);
  expect(featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
  expect(bodies.map((b) => b.bodyId)).toEqual(["b:base"]);
});

it("evaluates the many-body part to 1,000 bodies with no error", () => {
  const { bodies, featureStatuses } = evaluate(manyBodyPart());
  expect(featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
  expect(bodies).toHaveLength(1000);
}, 300_000);
