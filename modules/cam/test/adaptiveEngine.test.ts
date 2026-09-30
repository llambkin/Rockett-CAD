import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  adaptiveClear,
  type AdaptiveInput,
} from "../src/toolpath/adaptiveEngine";
import type { Loop } from "../src/toolpath/geometry";

const engine = new WebAssembly.Module(
  readFileSync(new URL("../wasm/adaptive/adaptive.wasm", import.meta.url)),
);

function rectangle(x: number, y: number, width: number, height: number): Loop {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

const pocket: AdaptiveInput = {
  stock: [rectangle(-10, -10, 60, 50)],
  region: [rectangle(0, 0, 40, 30)],
  cleared: [],
  operation: "clearingInside",
  toolDiameter: 10,
  stepOverFactor: 0.2,
  tolerance: 0.1,
  stockToLeave: 0,
  helixRampTargetDiameter: 0,
  helixRampMinDiameter: 0,
  forceInsideOut: true,
  finishingProfile: true,
  keepToolDownDistRatio: 3,
};

describe("adaptive engine", () => {
  it.each([
    { x: 0, y: 0, tolerance: 0.1 },
    { x: 10_000, y: -20_000, tolerance: 0.001 },
  ])(
    "clears a 40 by 30 mm pocket at $x, $y with tolerance $tolerance",
    ({ x: offsetX, y: offsetY, tolerance }) => {
      const regions = adaptiveClear(engine, {
        ...pocket,
        stock: [rectangle(offsetX - 10, offsetY - 10, 60, 50)],
        region: [rectangle(offsetX, offsetY, 40, 30)],
        tolerance,
      });

      expect(regions).toHaveLength(1);
      const [region] = regions;
      expect(region!.warnings).toEqual([]);
      expect(region!.clearedArea).toBeGreaterThan(0);

      const cuts = region!.paths.filter((path) => path.motion === "cut");
      expect(cuts.length).toBeGreaterThan(0);
      for (const path of region!.paths) {
        for (const { x, y } of path.points) {
          expect(x - offsetX).toBeGreaterThanOrEqual(5 - 0.01);
          expect(x - offsetX).toBeLessThanOrEqual(35 + 0.01);
          expect(y - offsetY).toBeGreaterThanOrEqual(5 - 0.01);
          expect(y - offsetY).toBeLessThanOrEqual(25 + 0.01);
        }
      }

      const closed = cuts.filter((path) => {
        const first = path.points[0]!;
        const last = path.points.at(-1)!;
        return (
          path.points.length > 3 &&
          Math.hypot(first.x - last.x, first.y - last.y) < 0.01
        );
      });
      expect(closed.length).toBeGreaterThan(0);
    },
  );

  it("rejects coordinates that are not finite", () => {
    expect(() =>
      adaptiveClear(engine, {
        ...pocket,
        region: [[...rectangle(0, 0, 40, 30), { x: Number.NaN, y: 1 }]],
      }),
    ).toThrow(RangeError);
  });
});
