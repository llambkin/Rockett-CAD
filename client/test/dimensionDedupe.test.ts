import { describe, expect, it } from "vitest";
import type { SketchConstraint } from "@rockett/shared";
import {
  dedupeDimensions,
  dimensionKey,
  findExistingDimension,
} from "../src/sketchTools";

const len = (id: string, line: string, value: number): SketchConstraint => ({
  id,
  type: "length",
  line,
  value,
});
const dia = (id: string, entity: string, value: number): SketchConstraint => ({
  id,
  type: "diameter",
  entity,
  value,
});
const dist = (
  id: string,
  a: string,
  b: string,
  value: number,
): SketchConstraint => ({ id, type: "distance", a, b, axis: null, value });
const horizontal: SketchConstraint = {
  id: "h",
  type: "horizontal",
  line: "l1",
};

describe("duplicate dimensions", () => {
  it("keys dimensions by what they measure, ignoring order and value", () => {
    expect(dimensionKey(len("a", "l1", 5))).toBe(
      dimensionKey(len("b", "l1", 9)),
    );
    expect(dimensionKey(dist("a", "p1", "p2", 5))).toBe(
      dimensionKey(dist("b", "p2", "p1", 7)),
    );
    expect(dimensionKey(len("a", "l1", 5))).not.toBe(
      dimensionKey(len("b", "l2", 5)),
    );
    expect(
      dimensionKey({ id: "r", type: "radius", entity: "c1", value: 2 }),
    ).toBe(dimensionKey(dia("d", "c1", 4)));
    expect(dimensionKey(horizontal)).toBeNull();
  });

  it("finds the existing dimension the tool should edit instead of adding", () => {
    const cs = [horizontal, len("a", "l1", 24.4), dia("d", "c1", 10)];
    expect(findExistingDimension(cs, len("new", "l1", 0))?.id).toBe("a");
    expect(findExistingDimension(cs, len("new", "l2", 0))).toBeUndefined();
    // a constraint never matches itself
    expect(findExistingDimension(cs, cs[1])).toBeUndefined();
  });

  it("collapses stacked dimensions, keeping the edited one and everything else", () => {
    const cs = [
      len("a", "l1", 24.4),
      horizontal,
      len("b", "l1", 24.4),
      len("c", "l1", 23.306),
      len("d", "l2", 30),
      dist("e", "p1", "p2", 4),
      dist("f", "p2", "p1", 5),
    ];
    expect(dedupeDimensions(cs, "c").map((c) => c.id)).toEqual([
      "h",
      "c",
      "d",
      "e",
    ]);
    // without a preferred id the first occurrence wins
    expect(dedupeDimensions(cs).map((c) => c.id)).toEqual(["a", "h", "d", "e"]);
  });
});
