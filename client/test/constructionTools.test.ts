import { describe, expect, it } from "vitest";
import { asConstruction, createCircle, createPolygon, createRect, createSlot } from "../src/sketchTools";

const O = { x: 0, y: 0 };

describe("construction mode for every sketch tool", () => {
  it("marks all created points and curves as construction", () => {
    for (const created of [
      createRect(O, { x: 10, y: 5 }),
      createCircle(O, { x: 4, y: 0 }),
      createPolygon(O, { x: 6, y: 0 }, 6),
      createSlot(O, { x: 20, y: 0 }, 3),
    ]) {
      const c = asConstruction(created);
      expect(c.entities.length).toBe(created.entities.length);
      expect(c.entities.every((e) => e.construction === true)).toBe(true);
      // constraints (horizontal/vertical/equal/parallel) are kept
      expect(c.constraints).toEqual(created.constraints);
    }
  });

  it("leaves the original untouched and does not invent entities for snapped points", () => {
    const rect = createRect({ x: 0, y: 0, snapPointId: "existing" }, { x: 10, y: 5 });
    const c = asConstruction(rect);
    expect(rect.entities.some((e) => e.construction)).toBe(false);
    // the first corner reused an existing point, so it is not in the created list
    expect(c.entities.filter((e) => e.kind === "point")).toHaveLength(3);
  });
});
