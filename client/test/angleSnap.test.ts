import { describe, expect, it } from "vitest";
import {
  createLine,
  dimFieldsFor,
  liveDimValues,
  lockedValue,
  pinTypedDims,
  resolveDimCursor,
  snapLineEnd,
  toggleAngleLock,
  type DimField,
  type UV,
} from "../src/sketchTools";
import { LINE_SHORTCUTS } from "../src/shortcuts";

const O = { x: 0, y: 0 };
const polar = (r: number, deg: number): UV => ({
  x: r * Math.cos((deg * Math.PI) / 180),
  y: r * Math.sin((deg * Math.PI) / 180),
});
const lineFields = (): DimField[] => {
  const fields = dimFieldsFor("line");
  if (!fields) throw new Error("no line fields");
  return fields;
};
const angleOf = (p: UV) => (Math.atan2(p.y, p.x) * 180) / Math.PI;

describe("line angle snap and lock", () => {
  it("snaps an end at 37 degrees to 30 with no angle constraint", () => {
    const end = snapLineEnd(O, polar(10, 37));
    expect(end.x).toBeCloseTo(polar(10, 30).x, 9);
    expect(end.y).toBeCloseTo(polar(10, 30).y, 9);
    const placed = pinTypedDims("line", createLine(O, end), lineFields());
    expect(placed.constraints.some((c) => c.type === "lineAngle")).toBe(false);
  });

  it("snaps to exact axes and drops point snaps", () => {
    const end = snapLineEnd(O, { ...polar(10, 94), snapPointId: "p" });
    expect(Object.keys(end)).toEqual(["x", "y"]);
    expect(end.x).toBe(0);
    expect(end.y).toBeCloseTo(10, 9);
  });

  it("combines the snap with a typed length", () => {
    const fields = lineFields();
    fields[0] = { ...fields[0]!, text: "20", locked: true };
    const end = resolveDimCursor(
      "line",
      O,
      snapLineEnd(O, polar(10, 37)),
      fields,
    );
    expect(end.x).toBeCloseTo(polar(20, 30).x, 9);
    expect(end.y).toBeCloseTo(polar(20, 30).y, 9);
  });

  it("locks the angle with A and stores it as lineAngle", () => {
    const fields = lineFields();
    toggleAngleLock(fields, liveDimValues("line", O, polar(10, 37)).angle!);
    const end = resolveDimCursor("line", O, polar(12, 80), fields);
    expect(angleOf(end)).toBeCloseTo(37, 9);
    const placed = pinTypedDims("line", createLine(O, end), fields);
    expect(placed.constraints).toEqual([
      expect.objectContaining({ type: "lineAngle", value: 37 }),
    ]);
  });

  it("unlocks on a second A", () => {
    const fields = lineFields();
    toggleAngleLock(fields, 37);
    toggleAngleLock(fields, 80);
    expect(lockedValue(fields, "angle")).toBeNull();
    expect(fields[1]?.text).toBe("80");
  });

  it("lists both keys for the controls help", () => {
    expect(LINE_SHORTCUTS.map((s) => s.key)).toEqual(["Shift", "A"]);
  });
});
