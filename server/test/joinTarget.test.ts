import { beforeAll, expect, it } from "vitest";
import type { ExtrudeFeature } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { box, evaluateTimeline, xSpans } from "./helpers/dumpNames.js";

beforeAll(initKernel, 120_000);

const BOXES = {
  left: () => box("left", 0, 0, 10, 10, 10),
  right: () => box("right", 20, 0, 10, 10, 10),
};

function spansAfter(
  order: (keyof typeof BOXES)[],
  operation: ExtrudeFeature["operation"],
) {
  const result = evaluateTimeline("join-target", [
    ...order.flatMap((key) => BOXES[key]()),
    ...box("tool", 8, -5, 14, 20, 10, operation),
  ]);
  expect(result.featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
  return xSpans(result);
}

it.each([
  [
    "join",
    { "b:left": [0, 22], "b:right": [20, 30] },
    { "b:left": [0, 10], "b:right": [8, 30] },
  ],
  [
    "intersect",
    { "b:left": [8, 10], "b:right": [20, 30] },
    { "b:left": [0, 10], "b:right": [20, 22] },
  ],
] as const)(
  "%s over both boxes lands on the first, so swapping them upstream moves it",
  (operation, leftFirst, rightFirst) => {
    expect(spansAfter(["left", "right"], operation)).toEqual(leftFirst);
    expect(spansAfter(["right", "left"], operation)).toEqual(rightFirst);
  },
);

it("cut over both boxes trims both in either order", () => {
  const trimmed = { "b:left": [0, 8], "b:right": [22, 30] };

  expect(spansAfter(["left", "right"], "cut")).toEqual(trimmed);
  expect(spansAfter(["right", "left"], "cut")).toEqual(trimmed);
});
