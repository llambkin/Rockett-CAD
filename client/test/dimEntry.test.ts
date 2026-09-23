import { describe, expect, it } from "vitest";
import {
  createCircle,
  createLine,
  createRect,
  dimConstraintsFor,
  dimFieldsFor,
  liveDimValues,
  lockedValue,
  resolveDimCursor,
  type DimField,
} from "../src/sketchTools";

const O = { x: 0, y: 0 };
const field = (
  key: DimField["key"],
  text: string,
  locked = true,
): DimField => ({
  key,
  label: key,
  unit: "",
  text,
  locked,
});

describe("typed sizes while drawing", () => {
  it("exposes the right fields per tool", () => {
    expect(dimFieldsFor("line")?.map((f) => f.key)).toEqual([
      "length",
      "angle",
    ]);
    expect(dimFieldsFor("rect")?.map((f) => f.key)).toEqual([
      "width",
      "height",
    ]);
    expect(dimFieldsFor("centerRect")?.map((f) => f.key)).toEqual([
      "width",
      "height",
    ]);
    expect(dimFieldsFor("circle")?.map((f) => f.key)).toEqual(["diameter"]);
    expect(dimFieldsFor("polygon")).toBeNull();
    expect(dimFieldsFor("arc3")).toBeNull();
  });

  it("live values follow the cursor; angles normalise to [0, 360)", () => {
    expect(liveDimValues("line", O, { x: -1, y: 0 }).angle).toBeCloseTo(180);
    expect(liveDimValues("line", O, { x: 0, y: -1 }).angle).toBeCloseTo(270);
    expect(liveDimValues("line", O, { x: 3, y: 4 }).length).toBeCloseTo(5);
    expect(liveDimValues("rect", O, { x: -3, y: 7 })).toEqual({
      width: 3,
      height: 7,
    });
    expect(liveDimValues("centerRect", O, { x: -3, y: 7 })).toEqual({
      width: 6,
      height: 14,
    });
    expect(liveDimValues("circle", O, { x: 0, y: 2 }).diameter).toBeCloseTo(4);
  });

  it("only locked, numeric, positive values count (angles may be zero or negative)", () => {
    expect(lockedValue([field("length", "12", false)], "length")).toBeNull();
    expect(lockedValue([field("length", "abc")], "length")).toBeNull();
    expect(lockedValue([field("length", "-5")], "length")).toBeNull();
    expect(lockedValue([field("length", "12.5")], "length")).toBe(12.5);
    expect(lockedValue([field("angle", "-45")], "angle")).toBe(-45);
    expect(lockedValue([field("angle", "0")], "angle")).toBe(0);
  });

  it("returns the cursor untouched (snap ids intact) when nothing is locked", () => {
    const cursor = { x: 3, y: 4, snapPointId: "p1" };
    expect(resolveDimCursor("line", O, cursor, dimFieldsFor("line")!)).toBe(
      cursor,
    );
    expect(resolveDimCursor("rect", O, cursor, dimFieldsFor("rect")!)).toBe(
      cursor,
    );
  });

  it("line: locked length keeps the cursor direction; locked angle is exact on the axes", () => {
    const l50 = [field("length", "50"), field("angle", "", false)];
    expect(resolveDimCursor("line", O, { x: 3, y: 4 }, l50)).toEqual({
      x: 30,
      y: 40,
    });

    const up = [field("length", "10"), field("angle", "90")];
    expect(
      resolveDimCursor("line", { x: 5, y: 5 }, { x: 9, y: 9 }, up),
    ).toEqual({ x: 5, y: 15 });
    const left = [field("length", "10"), field("angle", "180")];
    expect(
      resolveDimCursor("line", { x: 5, y: 5 }, { x: 9, y: 9 }, left),
    ).toEqual({ x: -5, y: 5 });
    const down = [field("length", "10"), field("angle", "-90")];
    expect(
      resolveDimCursor("line", { x: 5, y: 5 }, { x: 9, y: 9 }, down),
    ).toEqual({ x: 5, y: -5 });

    const diag = [field("length", String(Math.SQRT2)), field("angle", "45")];
    const p = resolveDimCursor("line", O, { x: 9, y: -9 }, diag);
    expect(p.x).toBeCloseTo(1, 9);
    expect(p.y).toBeCloseTo(1, 9);

    // angle locked, length from the cursor
    const angOnly = [field("length", "", false), field("angle", "0")];
    expect(resolveDimCursor("line", O, { x: 3, y: 4 }, angOnly)).toEqual({
      x: 5,
      y: 0,
    });
  });

  it("rect / centreRect: locked sizes keep the side of the cursor", () => {
    const w10 = [field("width", "10"), field("height", "", false)];
    expect(resolveDimCursor("rect", O, { x: -3, y: 7 }, w10)).toEqual({
      x: -10,
      y: 7,
    });
    const both = [field("width", "10"), field("height", "5")];
    expect(resolveDimCursor("rect", O, { x: -3, y: -7 }, both)).toEqual({
      x: -10,
      y: -5,
    });
    // centre rect values are full width/height, so the corner sits at half
    expect(resolveDimCursor("centerRect", O, { x: -3, y: 7 }, both)).toEqual({
      x: -5,
      y: 2.5,
    });
  });

  it("circle: locked diameter sets the radius point along the cursor direction", () => {
    const d8 = [field("diameter", "8")];
    expect(resolveDimCursor("circle", O, { x: 0, y: -1 }, d8)).toEqual({
      x: 0,
      y: -4,
    });
    // cursor on the centre: default direction +X
    expect(resolveDimCursor("circle", O, O, d8)).toEqual({ x: 4, y: 0 });
  });

  it("pins typed sizes onto the created geometry as dimension constraints", () => {
    const rect = createRect(O, { x: 10, y: 5 });
    const rectLines = rect.entities.filter((e) => e.kind === "line");
    const rc = dimConstraintsFor("rect", rect, [
      field("width", "10"),
      field("height", "5"),
    ]);
    expect(rc).toEqual([
      expect.objectContaining({
        type: "length",
        line: rectLines[0].id,
        value: 10,
      }),
      expect.objectContaining({
        type: "length",
        line: rectLines[1].id,
        value: 5,
      }),
    ]);
    // only the typed one is pinned
    expect(
      dimConstraintsFor("rect", rect, [
        field("width", "", false),
        field("height", "5"),
      ]),
    ).toHaveLength(1);

    const line = createLine(O, { x: 30, y: 40 });
    const lc = dimConstraintsFor("line", line, [
      field("length", "50"),
      field("angle", "", false),
    ]);
    expect(lc).toEqual([
      expect.objectContaining({ type: "length", value: 50 }),
    ]);

    const circ = createCircle(O, { x: 4, y: 0 });
    const circleId = circ.entities.find((e) => e.kind === "circle")!.id;
    const cc = dimConstraintsFor("circle", circ, [field("diameter", "8")]);
    expect(cc).toEqual([
      expect.objectContaining({ type: "diameter", entity: circleId, value: 8 }),
    ]);
  });
});
