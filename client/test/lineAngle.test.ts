import { describe, expect, it } from "vitest";
import type { SketchConstraint, SketchEntity } from "@rockett/shared";
import { dimensionLayout } from "../src/dimensionLayout";
import {
  createLine,
  dimensionKey,
  dimensionValue,
  lineDimensions,
  pinTypedDims,
  type DimField,
} from "../src/sketchTools";

const O = { x: 0, y: 0 };
const typed = (key: DimField["key"], text: string): DimField => ({
  key,
  label: key,
  unit: "",
  text,
  locked: true,
});
const lineOf = (created: { entities: SketchEntity[] }) => {
  const line = created.entities.find((e) => e.kind === "line");
  if (!line) throw new Error("no line");
  return line;
};

describe("typed line angle", () => {
  it("turns a typed L 10 and angle 30 into both constraints", () => {
    const created = createLine(O, { x: 8.6603, y: 5 });
    const pinned = pinTypedDims("line", created, [
      typed("length", "10"),
      typed("angle", "30"),
    ]);
    const line = lineOf(created).id;
    expect(pinned.constraints).toEqual([
      expect.objectContaining({ type: "length", line, value: 10 }),
      expect.objectContaining({ type: "lineAngle", line, value: 30 }),
    ]);
  });

  it("stores the angle in (-180, 180] and replaces an axis lock", () => {
    const down = createLine(O, { x: 0, y: -10 });
    expect(down.constraints).toEqual([
      expect.objectContaining({ type: "vertical" }),
    ]);
    expect(
      pinTypedDims("line", down, [typed("angle", "270")]).constraints,
    ).toEqual([expect.objectContaining({ type: "lineAngle", value: -90 })]);
    const back = createLine(O, { x: -10, y: 0 });
    expect(
      pinTypedDims("line", back, [typed("angle", "-180")]).constraints,
    ).toEqual([expect.objectContaining({ type: "lineAngle", value: 180 })]);
  });
});

describe("line dimension editor", () => {
  const entities: SketchEntity[] = [
    { id: "a", kind: "point", x: 1, y: 1 },
    { id: "b", kind: "point", x: 1, y: -9 },
    { id: "l1", kind: "line", p1: "a", p2: "b" },
  ];

  it("creates missing length and angle at their current values", () => {
    const vertical: SketchConstraint = {
      id: "v",
      type: "vertical",
      line: "l1",
    };
    const out = lineDimensions("l1", entities, [vertical]);
    expect(out.constraints).toEqual([
      expect.objectContaining({ id: out.lengthId, type: "length", value: 10 }),
      expect.objectContaining({
        id: out.angleId,
        type: "lineAngle",
        value: -90,
      }),
    ]);
  });

  it("reuses the dimensions a line already has", () => {
    const existing: SketchConstraint[] = [
      { id: "len", type: "length", line: "l1", value: 12 },
      { id: "ang", type: "lineAngle", line: "l1", value: -90 },
    ];
    const out = lineDimensions("l1", entities, existing);
    expect(out).toEqual({
      constraints: existing,
      lengthId: "len",
      angleId: "ang",
    });
  });

  it("parses edited values per dimension type", () => {
    const angle: SketchConstraint = {
      id: "ang",
      type: "lineAngle",
      line: "l1",
      value: 0,
    };
    const length: SketchConstraint = {
      id: "len",
      type: "length",
      line: "l1",
      value: 1,
    };
    expect(dimensionValue(angle, "-45")).toBe(-45);
    expect(dimensionValue(angle, "270")).toBe(-90);
    expect(dimensionValue(angle, "x")).toBeNull();
    expect(dimensionValue(length, "-3")).toBeNull();
    expect(dimensionValue(length, "7.5")).toBe(7.5);
    expect(dimensionKey(angle)).not.toBe(dimensionKey(length));
  });

  it("labels the angle against a +X reference at the line start", () => {
    const layout = dimensionLayout(
      { id: "ang", type: "lineAngle", line: "l1", value: 90 },
      new Map([
        ["a", { x: 1, y: 1 }],
        ["b", { x: 1, y: 11 }],
      ]),
      new Map([["l1", { p1: "a", p2: "b" }]]),
      new Map(),
    );
    if (!layout) throw new Error("no layout");
    expect(layout.reference).toEqual([
      { x: 1, y: 1 },
      { x: 6, y: 1 },
    ]);
    expect(layout.label.x - 1).toBeCloseTo((10 / 3) * Math.SQRT1_2, 10);
    expect(layout.label.y - 1).toBeCloseTo((10 / 3) * Math.SQRT1_2, 10);
    expect(layout.attachment).toEqual(layout.label);
  });
});
