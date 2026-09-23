import { describe, expect, it } from "vitest";
import type { Vec3 } from "@rockett/shared";
import { byPosition, suffixDuplicates } from "../src/geometry/naming.js";

describe("suffixDuplicates", () => {
  it("keeps a singleton base and suffixes duplicates by x, then y, then z", () => {
    const at = new Map<string, Vec3>([
      ["a", [1, 0, 0]],
      ["b", [0, 1, 0]],
      ["c", [0, 0, 9]],
      ["d", [5, 5, 5]],
    ]);
    const groups = new Map([
      ["e[x|y]", ["a", "b", "c"]],
      ["e[y|z]", ["d"]],
    ]);
    const named = suffixDuplicates(groups, (id) => at.get(id)!);
    expect(named).toEqual([
      ["c", "e[x|y]~1"],
      ["b", "e[x|y]~2"],
      ["a", "e[x|y]~3"],
      ["d", "e[y|z]"],
    ]);
  });

  it("breaks an x and y tie on z", () => {
    expect(byPosition([0, 1, 3], [0, 1, 5])).toBeLessThan(0);
    expect(byPosition([0, 1, 5], [0, 1, 3])).toBeGreaterThan(0);
    expect(byPosition([0, 1, 5], [0, 1, 5])).toBe(0);
  });
});
