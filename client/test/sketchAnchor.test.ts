import { describe, expect, it } from "vitest";
import {
  detectProfiles,
  solveSketch,
  type SketchEntity,
  type SketchConstraint,
} from "@rockett/shared";
import {
  createRect,
  createCenterRect,
  type Created,
  type UV,
} from "../src/sketchTools";

function resize(
  created: Created,
  width: number,
  height: number,
  extra: SketchEntity[] = [],
  constraints: SketchConstraint[] = [],
) {
  const sides = created.entities.filter(
    (e) => e.kind === "line" && !e.construction,
  );
  const result = solveSketch({
    entities: [...extra, ...created.entities],
    constraints: [
      ...constraints,
      ...created.constraints,
      { id: "width", type: "length", line: sides[0].id, value: width },
      { id: "height", type: "length", line: sides[1].id, value: height },
    ],
  });
  expect(result.converged).toBe(true);
  return result.entities;
}

function point(entities: SketchEntity[], id: string) {
  const p = entities.find((e) => e.id === id);
  if (!p || p.kind !== "point") throw new Error("Missing point");
  return p;
}

describe("rectangle starting anchors", () => {
  it.each<UV>([
    { x: 25, y: 10, snapKind: "midpoint" },
    { x: 25, y: 10, snapKind: "point" },
    { x: 0, y: 0, snapKind: "origin" },
  ])(
    "keeps a snapped corner at $snapKind when dimensions change and reopen",
    (anchor) => {
      const rect = createRect(anchor, { x: anchor.x + 12, y: anchor.y + 8 });
      const side = rect.entities.find((e) => e.kind === "line")!;
      if (side.kind !== "line") throw new Error("Missing side");
      for (const [w, h] of [
        [40, 15],
        [7, 30],
        [23, 9],
      ]) {
        rect.entities = resize(JSON.parse(JSON.stringify(rect)), w, h);
        expect(point(rect.entities, side.p1).x).toBeCloseTo(anchor.x, 7);
        expect(point(rect.entities, side.p1).y).toBeCloseTo(anchor.y, 7);
      }
    },
  );

  it("keeps a centre rectangle centred on a sketch midpoint and follows its reference", () => {
    const rect = createCenterRect(
      { x: 25, y: 10, snapMidLineId: "ref", snapKind: "midpoint" },
      { x: 31, y: 14 },
    );
    const source: SketchEntity[] = [
      { id: "a", kind: "point", x: 0, y: 10, external: true },
      { id: "b", kind: "point", x: 50, y: 10, external: true },
      { id: "ref", kind: "line", p1: "a", p2: "b", construction: true },
    ];
    const sides = rect.entities.filter(
      (e) => e.kind === "line" && !e.construction,
    );
    for (const endX of [50, 70]) {
      (source[1] as { x: number }).x = endX;
      const solved = resize(rect, 30, 12, source);
      const a = point(solved, sides[0].p1),
        c = point(solved, sides[1].p2);
      expect((a.x + c.x) / 2).toBeCloseTo(endX / 2, 7);
      expect((a.y + c.y) / 2).toBeCloseTo(10, 7);
      const profiles = detectProfiles(solved);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].area).toBeCloseTo(360, 5);
    }
  });

  it("resizes a centre rectangle symmetrically about a face midpoint", () => {
    const rect = createCenterRect(
      { x: 25, y: 10, snapKind: "midpoint" },
      { x: 31, y: 14 },
    );
    const solved = resize(rect, 30, 12);
    const outline = rect.entities.filter(
      (e) => e.kind === "line" && !e.construction,
    );
    const corner = point(solved, outline[0].p1);
    const opposite = point(solved, outline[1].p2);
    expect(corner.x).toBeCloseTo(10, 7);
    expect(corner.y).toBeCloseTo(4, 7);
    expect(opposite.x).toBeCloseTo(40, 7);
    expect(opposite.y).toBeCloseTo(16, 7);
  });

  it("leaves unsnapped rectangles free to move", () => {
    const rect = createRect({ x: 11, y: 7 }, { x: 21, y: 17 });
    expect(solveSketch(rect).dof).toBe(4);
  });

  it("retains the opposite corner's connection when a rectangle ends on another edge", () => {
    const source: SketchEntity[] = [
      { id: "a", kind: "point", x: 0, y: 0, external: true },
      { id: "b", kind: "point", x: 20, y: 0, external: true },
      { id: "edge", kind: "line", p1: "a", p2: "b", construction: true },
    ];
    const rect = createRect(
      { x: 0, y: -2.2 },
      { x: 9.7, y: 0, snapLineId: "edge", snapKind: "curve" },
    );
    const lines = rect.entities.filter((e) => e.kind === "line");
    const solved = resize(rect, 12, 5, source);
    expect(point(solved, lines[1].p2).y).toBeCloseTo(0, 8);
  });
});
