import { expect, it } from "vitest";
import { dimensionLayout } from "../src/dimensionLayout";

it.each([false, true])(
  "attaches a dragged length label to its line even when reversed: %s",
  (reversed) => {
    const pts = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 9.7, y: 0 }],
    ]);
    const lines = new Map([
      ["line", { p1: reversed ? "b" : "a", p2: reversed ? "a" : "b" }],
    ]);
    const layout = dimensionLayout(
      {
        id: "dim",
        type: "length",
        line: "line",
        value: 9.7,
        labelOffset: [-2, -3],
      },
      pts,
      lines,
      new Map(),
    )!;
    expect(layout.attachment).toEqual({ x: 4.85, y: 0 });
    expect(layout.label).toEqual({ x: 4.85, y: reversed ? -2.5 : 2.5 });
    pts.set("b", { x: 20, y: 0 });
    expect(
      dimensionLayout(
        { id: "dim", type: "length", line: "line", value: 20 },
        pts,
        lines,
        new Map(),
      )!.attachment,
    ).toEqual({ x: 10, y: 0 });
  },
);

it("attaches a radius leader to the circle while preserving the label position", () => {
  const layout = dimensionLayout(
    { id: "dim", type: "radius", entity: "circle", value: 10 },
    new Map([["center", { x: 3, y: 4 }]]),
    new Map(),
    new Map([["circle", { center: "center", radius: 10 }]]),
  )!;
  expect(
    Math.hypot(layout.attachment.x - 3, layout.attachment.y - 4),
  ).toBeCloseTo(10, 10);
  expect(layout.label).toEqual({ x: 10.5, y: 11.5 });
});
