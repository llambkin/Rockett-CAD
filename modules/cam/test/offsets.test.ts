import { describe, expect, it } from "vitest";
import {
  offsetLoops,
  subtractLoops,
  type Loop,
} from "../src/toolpath/geometry";

function square(x: number, y: number, size: number): Loop {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

function area(loops: Loop[]): number {
  return loops.reduce(
    (sum, loop) =>
      sum +
      loop.reduce((twice, a, i) => {
        const b = loop[(i + 1) % loop.length]!;
        return twice + a.x * b.y - b.x * a.y;
      }, 0) /
        2,
    0,
  );
}

describe("toolpath geometry", () => {
  it("offsets a 20 mm square inward by 2 mm to 256 mm2", () => {
    const loops = offsetLoops([square(0, 0, 20)], -2);
    expect(loops).toHaveLength(1);
    expect(Math.abs(area(loops) - 256)).toBeLessThan(1e-6);
    for (const point of loops[0]!) {
      expect(point.x).toBeGreaterThanOrEqual(2);
      expect(point.x).toBeLessThanOrEqual(18);
    }
  });

  it("offsets outward with round corners", () => {
    const grown = area(offsetLoops([square(0, 0, 20)], 2));
    expect(Math.abs(grown - (560 + 4 * Math.PI))).toBeLessThan(0.1);
  });

  it("subtracts an island from a region", () => {
    const region = subtractLoops([square(0, 0, 20)], [square(8, 8, 4)]);
    expect(region).toHaveLength(2);
    expect(Math.abs(area(region) - 384)).toBeLessThan(1e-6);
  });

  it("offsets around an island", () => {
    const region = subtractLoops([square(0, 0, 20)], [square(8, 8, 4)]);
    const loops = offsetLoops(region, -2);
    expect(loops).toHaveLength(2);
    expect(area(loops)).toBeLessThan(256 - 16 - 4 * 8);
  });

  it("returns nothing when the offset closes the loop", () => {
    expect(offsetLoops([square(0, 0, 20)], -10)).toEqual([]);
  });

  it("rejects coordinates that are not finite", () => {
    expect(() =>
      offsetLoops(
        [
          [
            { x: 0, y: 0 },
            { x: Number.NaN, y: 1 },
            { x: 1, y: 1 },
          ],
        ],
        1,
      ),
    ).toThrow(RangeError);
  });
});
