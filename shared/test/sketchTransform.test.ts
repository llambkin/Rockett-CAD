import { describe, expect, it } from "vitest";
import {
  boundConstraintIds,
  copySketchSelection,
  createEmptyDocument,
  editedEntities,
  movedBindings,
  resolveDocumentParameters,
  FixedEntityError,
  moveSketchSelection,
  solveSketch,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type SketchPoint,
} from "../src/index.js";

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

const rect: SketchEntity[] = [
  P("a", 0, 0),
  P("b", 102, 0),
  P("c", 102, 60),
  P("d", 0, 60),
  L("bottom", "a", "b"),
  L("right", "b", "c"),
  L("top", "c", "d"),
  L("left", "d", "a"),
];
const rectConstraints: SketchConstraint[] = [
  { id: "hb", type: "horizontal", line: "bottom" },
  { id: "ht", type: "horizontal", line: "top" },
  { id: "vr", type: "vertical", line: "right" },
  { id: "vl", type: "vertical", line: "left" },
  { id: "width", type: "length", line: "bottom", value: 102 },
  { id: "height", type: "length", line: "right", value: 60 },
];
const lines = ["bottom", "right", "top", "left"];
const move = { dx: 10, dy: 5, angle: 30, pivot: null, copy: false, bound: [] };

const point = (entities: SketchEntity[], id: string) =>
  entities.find((e) => e.id === id) as SketchPoint;
const centre = (entities: SketchEntity[], ids: string[]) => {
  const ps = ids.map((id) => point(entities, id));
  return {
    x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
    y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  };
};
const dof = (entities: SketchEntity[], constraints: SketchConstraint[]) =>
  solveSketch({ entities, constraints }).dof;

describe("moveSketchSelection", () => {
  it("moves a constrained rectangle 10, 5 mm and 30 degrees, centred there, keeping its constraints", () => {
    const result = moveSketchSelection(rect, rectConstraints, lines, move);

    expect(result.removedConstraints).toBe(0);
    expect(result.constraints.map((c) => c.id)).toEqual(
      rectConstraints.map((c) => c.id),
    );
    const c = centre(result.entities, ["a", "b", "c", "d"]);
    expect(c.x).toBeCloseTo(61, 9);
    expect(c.y).toBeCloseTo(35, 9);
    const a = point(result.entities, "a"),
      b = point(result.entities, "b");
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(
      30,
      9,
    );
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(102, 9);
    expect(result.constraints.find((k) => k.id === "hb")).toMatchObject({
      type: "lineAngle",
      line: "bottom",
    });
    expect(
      editedEntities(rectConstraints, {
        entities: result.entities,
        constraints: result.constraints,
      }),
    ).toEqual(result.entities);
    expect(
      solveSketch({
        entities: result.entities,
        constraints: result.constraints,
      }).converged,
    ).toBe(true);
    expect(dof(result.entities, result.constraints)).toBe(
      dof(rect, rectConstraints),
    );
  });

  it("keeps horizontal and vertical on a pure move and swaps them at 90 degrees", () => {
    const moved = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: 0,
    });
    expect(moved.constraints).toEqual(rectConstraints);
    const turned = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: 90,
    });
    expect(turned.constraints.find((k) => k.id === "hb")).toMatchObject({
      type: "vertical",
    });
    expect(turned.constraints.find((k) => k.id === "vr")).toMatchObject({
      type: "horizontal",
    });
  });

  it("keeps horizontal and vertical at 180 degrees and swaps them at -90", () => {
    const half = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: 180,
    });
    expect(half.constraints).toEqual(rectConstraints);
    const back = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      angle: -90,
    });
    expect(back.constraints.map((k) => k.type)).toEqual([
      "vertical",
      "vertical",
      "horizontal",
      "horizontal",
      "length",
      "length",
    ]);
  });

  it("swaps an x distance to y at 90 degrees", () => {
    const width: SketchConstraint = {
      id: "dx",
      type: "distance",
      a: "a",
      b: "b",
      axis: "x",
      value: 102,
    };
    const result = moveSketchSelection(rect, [width], lines, {
      ...move,
      angle: 90,
    });
    expect(result.constraints).toEqual([{ ...width, axis: "y" }]);
  });

  it("drops a parameter-bound angle a rotation would change, and the document resolves in place", () => {
    const constraints: SketchConstraint[] = [
      { id: "ab", type: "lineAngle", line: "bottom", value: 0 },
      ...rectConstraints.slice(1),
    ];
    const doc = createEmptyDocument("proj", "doc");
    const saved: SketchFeature = {
      id: "s1",
      type: "sketch",
      name: "Sketch1",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: rect,
      constraints,
    };
    doc.features = [saved];
    doc.timelinePosition = 1;
    doc.parameterBindings = [
      { featureId: "s1", path: "/constraints/0/value", expression: "0 deg" },
    ];
    const bound = boundConstraintIds(doc.parameterBindings, saved);
    expect(bound).toEqual(["ab"]);

    const result = moveSketchSelection(rect, constraints, lines, {
      ...move,
      bound,
    });
    expect(result.removedConstraints).toBe(1);
    expect(result.constraints.map((c) => c.id)).not.toContain("ab");

    const draft = { ...saved, ...result };
    const bindings = movedBindings(doc.parameterBindings, saved, draft);
    const resolved = resolveDocumentParameters({
      ...doc,
      features: [draft],
      parameterBindings: bindings,
    }).features[0] as SketchFeature;
    const solved = solveSketch(resolved);
    expect(solved.converged).toBe(true);
    const a = point(solved.entities, "a"),
      b = point(solved.entities, "b");
    expect((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toBeCloseTo(
      30,
      6,
    );
  });

  it("rotates about a picked point", () => {
    const result = moveSketchSelection(rect, rectConstraints, lines, {
      dx: 0,
      dy: 0,
      angle: 90,
      pivot: { x: 0, y: 0 },
      copy: false,
      bound: [],
    });
    expect(point(result.entities, "b").x).toBeCloseTo(0, 9);
    expect(point(result.entities, "b").y).toBeCloseTo(102, 9);
  });

  it("Copy leaves the original and adds a second rectangle with its own constraints", () => {
    const result = moveSketchSelection(rect, rectConstraints, lines, {
      ...move,
      copy: true,
    });

    expect(result.entities.slice(0, rect.length)).toEqual(rect);
    expect(result.constraints.slice(0, rectConstraints.length)).toEqual(
      rectConstraints,
    );
    const added = result.entities.slice(rect.length);
    const copies = result.constraints.slice(rectConstraints.length);
    expect(added.filter((e) => e.kind === "line")).toHaveLength(4);
    expect(added.filter((e) => e.kind === "point")).toHaveLength(4);
    expect(copies).toHaveLength(rectConstraints.length);
    const old = new Set(rect.map((e) => e.id));
    const fresh = new Set(added.map((e) => e.id));
    for (const k of copies) {
      expect(rectConstraints.some((r) => r.id === k.id)).toBe(false);
      for (const ref of Object.values(k).filter(
        (v): v is string => typeof v === "string" && old.has(v),
      ))
        expect(fresh.has(ref)).toBe(true);
    }
    expect(
      editedEntities(rectConstraints, {
        entities: result.entities,
        constraints: result.constraints,
      }),
    ).toEqual(result.entities);
    expect(dof(result.entities, result.constraints)).toBe(
      2 * dof(rect, rectConstraints),
    );
  });

  it("drops a coincident to an unselected point and counts it", () => {
    const entities = [P("p1", 0, 0), P("p2", 10, 0), L("l", "p1", "p2")];
    const constraints: SketchConstraint[] = [
      { id: "h", type: "horizontal", line: "l" },
      { id: "on", type: "coincident", a: "p1", b: "u" },
    ];
    const result = moveSketchSelection(
      [...entities, P("u", 0, 0)],
      constraints,
      ["l"],
      { ...move, angle: 0 },
    );
    expect(result.removedConstraints).toBe(1);
    expect(result.constraints.map((c) => c.id)).toEqual(["h"]);
    expect(point(result.entities, "u")).toEqual(P("u", 0, 0));
    expect(point(result.entities, "p1")).toMatchObject({ x: 10, y: 5 });
  });

  it("leaves unselected curves where they were when they share a moved point", () => {
    const result = moveSketchSelection(rect, rectConstraints, ["bottom"], {
      ...move,
      angle: 0,
    });
    const right = result.entities.find((e) => e.id === "right")!;
    expect(right.kind === "line" && right.p1).not.toBe("b");
    const corner = point(result.entities, (right as { p1: string }).p1);
    expect(corner).toMatchObject({ x: 102, y: 0 });
    expect(point(result.entities, "b")).toMatchObject({ x: 112, y: 5 });
  });

  it("refuses to move a fixed line, naming it, and still copies it", () => {
    const entities = [P("p1", 0, 0), P("p2", 10, 0), L("l", "p1", "p2")];
    const constraints: SketchConstraint[] = [
      { id: "f", type: "fix", point: "p1" },
    ];
    let error: unknown;
    try {
      moveSketchSelection(entities, constraints, ["l"], move);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(FixedEntityError);
    expect(error).toMatchObject({ entityId: "l", reason: "fixed" });
    const copied = moveSketchSelection(entities, constraints, ["l"], {
      ...move,
      copy: true,
    });
    expect(copied.entities.slice(0, 3)).toEqual(entities);
    expect(copied.entities).toHaveLength(6);
    expect(copied.constraints).toEqual(constraints);
  });
});

it("refuses to move a projected line and copies it as plain geometry", () => {
  const entities: SketchEntity[] = [
    { id: "p1", kind: "point", x: 0, y: 0, external: true },
    { id: "p2", kind: "point", x: 10, y: 0, external: true },
    {
      id: "l",
      kind: "line",
      p1: "p1",
      p2: "p2",
      external: true,
      projection: { kind: "edge", bodyId: "b", edgeName: "e" },
    },
  ];
  expect(() => moveSketchSelection(entities, [], ["l"], move)).toThrow(
    expect.objectContaining({ entityId: "l", reason: "reference" }),
  );
  const copied = moveSketchSelection(entities, [], ["l"], {
    ...move,
    copy: true,
  });
  for (const e of copied.entities.slice(3)) {
    expect(e.external).toBeUndefined();
    expect("projection" in e).toBe(false);
  }
});

const C = (id: string, center: string, radius: number): SketchEntity => ({
  id,
  kind: "circle",
  center,
  radius,
});
const hole = [P("o", 10, 5), C("hole", "o", 2)];
const holeRadius: SketchConstraint[] = [
  { id: "r", type: "radius", entity: "hole", value: 2 },
];
const circles = (entities: SketchEntity[]) =>
  entities.flatMap((e) => (e.kind === "circle" ? [e] : []));
const centres = (entities: SketchEntity[]) =>
  circles(entities).map((c) => {
    const { x, y } = point(entities, c.center);
    return [Math.round(x * 1e9) / 1e9 + 0, Math.round(y * 1e9) / 1e9 + 0];
  });
const along = (entities: SketchEntity[], line: string) => {
  const l = entities.find((e) => e.id === line) as { p1: string; p2: string };
  const [a, b] = [point(entities, l.p1), point(entities, l.p2)];
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
};

describe("copySketchSelection", () => {
  it("mirrors a circle at (10, 5) across the Y axis line to (-10, 5)", () => {
    const axis = [
      P("y0", 0, 0),
      P("y1", 0, 10),
      { ...L("axis", "y0", "y1"), construction: true },
    ];
    const entities = [...hole, ...axis];
    const result = copySketchSelection(entities, holeRadius, ["hole"], {
      kind: "mirror",
      line: "axis",
    });

    expect(result.entities.slice(0, entities.length)).toEqual(entities);
    expect(centres(result.entities)).toEqual([
      [10, 5],
      [-10, 5],
    ]);
    const [, copy] = circles(result.entities);
    expect(copy!.radius).toBe(2);
    expect(result.constraints).toEqual([
      ...holeRadius,
      {
        id: expect.not.stringMatching(/^r$/),
        type: "radius",
        entity: copy!.id,
        value: 2,
      },
    ]);
  });

  it("swaps a mirrored arc's ends so it stays the mirror image", () => {
    const entities: SketchEntity[] = [
      P("c", 10, 0),
      P("s", 15, 0),
      P("e", 10, 5),
      { id: "arc", kind: "arc", center: "c", start: "s", end: "e" },
      P("y0", 0, 0),
      P("y1", 0, 10),
      L("axis", "y0", "y1"),
    ];
    const result = copySketchSelection(entities, [], ["arc"], {
      kind: "mirror",
      line: "axis",
    });
    const copy = result.entities.at(-1)!;
    if (copy.kind !== "arc") throw new Error("expected an arc");
    expect(point(result.entities, copy.start)).toMatchObject({ x: -10, y: 5 });
    expect(point(result.entities, copy.end)).toMatchObject({ x: -15, y: 0 });
  });

  it("mirrors line directions across a slanted line", () => {
    const entities = [
      P("a", 0, 0),
      P("b", 10, 0),
      L("flat", "a", "b"),
      P("c", 0, 5),
      P("d", 10 * Math.cos(Math.PI / 9), 5 + 10 * Math.sin(Math.PI / 9)),
      L("tilt", "c", "d"),
      P("m0", 0, -20),
      P("m1", 10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6) - 20),
      L("mirror", "m0", "m1"),
    ];
    const constraints: SketchConstraint[] = [
      { id: "h", type: "horizontal", line: "flat" },
      { id: "dx", type: "distance", a: "a", b: "b", axis: "x", value: 10 },
      { id: "t", type: "lineAngle", line: "tilt", value: 20 },
      { id: "ty", type: "lineAngle", line: "tilt", axis: "y", value: -70 },
    ];
    const result = copySketchSelection(
      entities,
      constraints,
      ["flat", "tilt"],
      {
        kind: "mirror",
        line: "mirror",
      },
    );

    expect(result.removedConstraints).toBe(1);
    const copies = result.constraints.slice(constraints.length);
    expect(copies.map((c) => [c.type, "value" in c ? c.value : null])).toEqual([
      ["lineAngle", expect.closeTo(60, 9)],
      ["lineAngle", expect.closeTo(40, 9)],
      ["lineAngle", expect.closeTo(-50, 9)],
    ]);
    const [flat, tilt] = result.entities
      .slice(entities.length)
      .filter((e) => e.kind === "line");
    expect(along(result.entities, flat!.id)).toBeCloseTo(60, 9);
    expect(along(result.entities, tilt!.id)).toBeCloseTo(40, 9);
  });

  it("makes a 3 by 2 rect pattern at 20 and 15 mm: 6 circles on the grid", () => {
    const result = copySketchSelection(hole, holeRadius, ["hole"], {
      kind: "rect",
      first: { axis: "x", count: 3, spacing: 20 },
      second: { axis: "y", count: 2, spacing: 15 },
    });

    expect(centres(result.entities)).toEqual([
      [10, 5],
      [30, 5],
      [50, 5],
      [10, 20],
      [30, 20],
      [50, 20],
    ]);
    const radii = result.constraints.filter((c) => c.type === "radius");
    expect(new Set(radii.map((c) => c.type === "radius" && c.entity))).toEqual(
      new Set(circles(result.entities).map((c) => c.id)),
    );
    expect(dof(result.entities, result.constraints)).toBe(
      6 * dof(hole, holeRadius),
    );
  });

  it("patterns along a sketch line", () => {
    const entities = [...hole, P("a", 0, 0), P("b", 3, 4), L("dir", "a", "b")];
    const result = copySketchSelection(entities, [], ["hole"], {
      kind: "rect",
      first: { axis: { line: "dir" }, count: 2, spacing: 10 },
      second: null,
    });
    expect(centres(result.entities)).toEqual([
      [10, 5],
      [16, 13],
    ]);
  });

  it("makes 6 circular copies over 360 degrees, 60 degrees apart at the same radius", () => {
    const result = copySketchSelection(hole, holeRadius, ["hole"], {
      kind: "circ",
      centre: { x: 0, y: 0 },
      count: 6,
      angle: 360,
    });

    const at = centres(result.entities);
    expect(at).toHaveLength(6);
    const turns = at.map(([x, y]) => Math.atan2(y!, x!) - Math.atan2(5, 10));
    turns.forEach((t, k) => {
      expect(Math.hypot(...at[k]!)).toBeCloseTo(Math.hypot(10, 5), 9);
      expect(Math.cos(t - (k * Math.PI) / 3)).toBeCloseTo(1, 9);
    });
  });

  it("spreads a partial circular pattern from first to last", () => {
    const result = copySketchSelection(hole, [], ["hole"], {
      kind: "circ",
      centre: { x: 10, y: 0 },
      count: 3,
      angle: 180,
    });
    expect(centres(result.entities)).toEqual([
      [10, 5],
      [5, 0],
      [10, -5],
    ]);
  });

  it("refuses a quantity that is not a whole number above 1 and an oversized pattern", () => {
    const grid = (count: number, second = 1) =>
      copySketchSelection(hole, [], ["hole"], {
        kind: "rect",
        first: { axis: "x", count, spacing: 5 },
        second: { axis: "y", count: second, spacing: 5 },
      });
    expect(() => grid(1)).toThrow("Set a quantity above 1.");
    expect(() => grid(2.5)).toThrow("whole number");
    expect(() => grid(30, 30)).toThrow("at most 500 copies");
  });
});
