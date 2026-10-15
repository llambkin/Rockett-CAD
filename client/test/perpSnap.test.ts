import { describe, expect, it } from "vitest";
import type { SketchEntity } from "@rockett/shared";
import {
  createLine,
  dimFieldsFor,
  perpendicularSnap,
  rayLineIntersection,
  resolveDimCursor,
  type DimField,
} from "../src/sketchTools";

describe("landing a direction-locked line on another line", () => {
  it("returns the exact crossing of the ray with the segment", () => {
    // vertical ray up from (5, 0) meets the horizontal line y = 8
    expect(
      rayLineIntersection(
        { x: 5, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 8 },
        { x: 20, y: 8 },
      ),
    ).toEqual({ x: 5, y: 8 });
    // 45° ray meets a vertical line
    const h = rayLineIntersection(
      { x: 0, y: 0 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      { x: 10, y: -5 },
      { x: 10, y: 30 },
    )!;
    expect(h.x).toBeCloseTo(10, 9);
    expect(h.y).toBeCloseTo(10, 9);
  });

  it("rejects parallel lines, crossings behind the start, and misses beyond the segment ends", () => {
    expect(
      rayLineIntersection(
        { x: 5, y: 0 },
        { x: 0, y: 1 },
        { x: 7, y: 0 },
        { x: 7, y: 9 },
      ),
    ).toBeNull();
    expect(
      rayLineIntersection(
        { x: 5, y: 0 },
        { x: 0, y: -1 },
        { x: 0, y: 8 },
        { x: 20, y: 8 },
      ),
    ).toBeNull();
    expect(
      rayLineIntersection(
        { x: 25, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 8 },
        { x: 20, y: 8 },
      ),
    ).toBeNull();
    // ... unless within the slack (closing onto a line's end from just outside)
    expect(
      rayLineIntersection(
        { x: 20.5, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 8 },
        { x: 20, y: 8 },
        1,
      ),
    ).toEqual({ x: 20.5, y: 8 });
  });

  it("a perpendicular snap combined with a line hit keeps both constraints in createLine", () => {
    const end = { x: 10, y: 8, snapLineId: "top", snapPerpLineId: "ref" };
    const created = createLine({ x: 10, y: 0, snapPointId: "a" }, end);
    expect(created.constraints.map((c) => c.type).sort()).toEqual([
      "pointOnLine",
      "vertical",
    ]);
    // vertical because the coordinates are axis-exact; a slanted case keeps perpendicular
    const slanted = createLine(
      { x: 10, y: 10, snapPointId: "a" },
      { x: 3, y: 17, snapLineId: "top", snapPerpLineId: "ref" },
    );
    expect(slanted.constraints.map((c) => c.type).sort()).toEqual([
      "perpendicular",
      "pointOnLine",
    ]);
  });
});

const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (id: string, p1: string, p2: string): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
});

// a 45° reference line from the origin to (10, 10)
const diag = [P("o", 0, 0), P("a", 10, 10), L("ref", "o", "a")];
// an axis-aligned reference (horizontal)
const horiz = [P("o", 0, 0), P("a", 10, 0), L("ref", "o", "a")];
/** cursor 10 mm from the reference's far end (10, 10) at `d` degrees */
const deg = (d: number, r = 10) => ({
  x: 10 + r * Math.cos((d * Math.PI) / 180),
  y: 10 + r * Math.sin((d * Math.PI) / 180),
});

describe("perpendicular snapping while drawing lines", () => {
  it("snaps a line within 4° of a right angle onto the exact perpendicular, keeping its length", () => {
    // 135° is perpendicular to the 45° reference; 137.5° is 2.5° off
    const r = perpendicularSnap(
      { x: 10, y: 10, snapPointId: "a" },
      deg(137.5),
      diag,
    );
    expect(r).not.toBeNull();
    expect(r!.snapKind).toBe("perpendicular");
    expect(r!.snapPerpLineId).toBe("ref");
    const dx = r!.x - 10,
      dy = r!.y - 10;
    expect(Math.hypot(dx, dy)).toBeCloseTo(10, 9);
    // exactly perpendicular to (1,1)
    expect(dx + dy).toBeCloseTo(0, 9);
    // on the cursor's side (up-left)
    expect(dx).toBeLessThan(0);
    expect(dy).toBeGreaterThan(0);
  });

  it("leaves custom angles alone outside the band", () => {
    expect(
      perpendicularSnap({ x: 10, y: 10, snapPointId: "a" }, deg(141), diag),
    ).toBeNull();
    expect(
      perpendicularSnap({ x: 10, y: 10, snapPointId: "a" }, deg(100), diag),
    ).toBeNull();
    // the other perpendicular direction (315°) also snaps
    expect(
      perpendicularSnap({ x: 10, y: 10, snapPointId: "a" }, deg(312), diag)
        ?.snapPerpLineId,
    ).toBe("ref");
  });

  it("only considers lines that end at the start point", () => {
    // start somewhere unrelated, same direction: no reference line touches it
    expect(
      perpendicularSnap({ x: 50, y: 0 }, { x: 40, y: 10.5 }, diag),
    ).toBeNull();
    // coincident coordinates (no snapPointId) still count as touching
    expect(
      perpendicularSnap({ x: 0, y: 0 }, { x: -7, y: 7.3 }, diag)
        ?.snapPerpLineId,
    ).toBe("ref");
  });

  it("ignores lines too short to have a direction", () => {
    expect(
      perpendicularSnap(
        { x: 10, y: 10, snapPointId: "a" },
        { x: 10.01, y: 9.99 },
        diag,
        0.5,
      ),
    ).toBeNull();
  });

  it("makes axis-aligned results exact so the vertical/horizontal auto-constraint applies instead", () => {
    const r = perpendicularSnap(
      { x: 10, y: 0, snapPointId: "a" },
      { x: 10.4, y: 8 },
      horiz,
    );
    expect(r!.snapKind).toBe("perpendicular");
    expect(r!.x).toBe(10); // exact, not 10 + ε
    expect(r!.y).toBeCloseTo(Math.hypot(0.4, 8), 9);
    expect(r!.snapPerpLineId).toBeUndefined();
    const created = createLine({ x: 10, y: 0, snapPointId: "a" }, r!);
    expect(created.constraints.map((c) => c.type)).toEqual(["vertical"]);
  });

  it("createLine pins the snap with a perpendicular constraint", () => {
    const end = perpendicularSnap(
      { x: 10, y: 10, snapPointId: "a" },
      deg(137.5),
      diag,
    )!;
    const created = createLine({ x: 10, y: 10, snapPointId: "a" }, end);
    const line = created.entities.find((e) => e.kind === "line")!;
    expect(created.constraints).toEqual([
      expect.objectContaining({ type: "perpendicular", a: "ref", b: line.id }),
    ]);
  });

  it("survives a typed length but not a typed angle", () => {
    const end = perpendicularSnap(
      { x: 10, y: 10, snapPointId: "a" },
      deg(137.5),
      diag,
    )!;
    const f = (
      key: DimField["key"],
      text: string,
      locked: boolean,
    ): DimField => ({ key, label: key, unit: "", text, locked });
    const lenOnly = resolveDimCursor("line", { x: 10, y: 10 }, end, [
      f("length", "20", true),
      f("angle", "", false),
    ]);
    expect(lenOnly.snapPerpLineId).toBe("ref");
    expect(Math.hypot(lenOnly.x - 10, lenOnly.y - 10)).toBeCloseTo(20, 9);
    const angle = resolveDimCursor("line", { x: 10, y: 10 }, end, [
      f("length", "", false),
      f("angle", "120", true),
    ]);
    expect(angle.snapPerpLineId).toBeUndefined();
    expect(dimFieldsFor("line")).toHaveLength(2);
  });
});
