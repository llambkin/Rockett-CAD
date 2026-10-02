import { describe, expect, it } from "vitest";
import { featureSpec } from "../src/index.js";
import type {
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchPoint,
} from "../src/model.js";
import { editedEntities, solveSketch } from "../src/solver.js";

const P = (id: string, x: number, y: number): SketchPoint => ({
  id,
  kind: "point",
  x,
  y,
});

const base = (): SketchEntity[] => [
  P("ec", 0, 0),
  P("em", 10, 0),
  P("en", 0, 5),
  { id: "e", kind: "ellipse", center: "ec", major: "em", minor: "en" },
  P("a", -15, 4),
  P("b", 15, 4.5),
  { id: "l", kind: "line", p1: "a", p2: "b" },
  P("q", 3, 3),
  P("oc", 30, 0),
  { id: "o", kind: "circle", center: "oc", radius: 2 },
];

const at = (entities: SketchEntity[], id: string) => {
  const p = entities.find((e) => e.id === id);
  if (p?.kind !== "point") throw new Error(`no point ${id}`);
  return p;
};

function unitFrame(entities: SketchEntity[]) {
  const c = at(entities, "ec");
  const m = at(entities, "em");
  const n = at(entities, "en");
  const [ux, uy, vx, vy] = [m.x - c.x, m.y - c.y, n.x - c.x, n.y - c.y];
  const det = ux * vy - uy * vx;
  return (p: SketchPoint): [number, number] => {
    const [dx, dy] = [p.x - c.x, p.y - c.y];
    return [(dx * vy - dy * vx) / det, (ux * dy - uy * dx) / det];
  };
}

function lineGap(entities: SketchEntity[]): number {
  const local = unitFrame(entities);
  const [p, q] = [local(at(entities, "a")), local(at(entities, "b"))];
  const cross = p[0] * q[1] - p[1] * q[0];
  return Math.abs(cross) / Math.hypot(q[0] - p[0], q[1] - p[1]) - 1;
}

const pointGap = (entities: SketchEntity[]) =>
  Math.hypot(...unitFrame(entities)(at(entities, "q"))) - 1;

function axisCosine(entities: SketchEntity[]): number {
  const [c, m, n] = ["ec", "em", "en"].map((id) => at(entities, id));
  const [ux, uy, vx, vy] = [m!.x - c!.x, m!.y - c!.y, n!.x - c!.x, n!.y - c!.y];
  return (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
}

const tangent: SketchConstraint = { id: "t", type: "tangent", a: "l", b: "e" };
const onEllipse: SketchConstraint = {
  id: "k",
  type: "pointOnCircle",
  point: "q",
  circle: "e",
};

describe("ellipse tangency and coincidence", () => {
  it("makes a crossing line tangent to the ellipse", () => {
    const entities = base();
    expect(lineGap(entities)).toBeLessThan(-0.05);
    const solved = editedEntities([], { entities, constraints: [tangent] });
    expect(Math.abs(lineGap(solved))).toBeLessThan(1e-6);
    expect(Math.abs(axisCosine(solved))).toBeLessThan(1e-6);
  });

  it("puts a point on the ellipse", () => {
    const solved = editedEntities([], {
      entities: base(),
      constraints: [onEllipse],
    });
    expect(Math.abs(pointGap(solved))).toBeLessThan(1e-6);
  });

  for (const [axis, x, y, reach] of [
    ["em", 14, 3, 1e-3],
    ["en", -1, 8, 2],
  ] as const)
    it(`keeps the line tangent while ${axis} is dragged`, () => {
      const constraints = [tangent, onEllipse];
      let entities = editedEntities([], { entities: base(), constraints });
      const from = at(entities, axis);
      for (let i = 1; i <= 10; i++) {
        const dragged = solveSketch({
          entities,
          constraints,
          drag: {
            pointId: axis,
            x: from.x + ((x - from.x) * i) / 10,
            y: from.y + ((y - from.y) * i) / 10,
          },
        });
        expect(dragged.converged).toBe(true);
        entities = dragged.entities;
        expect(Math.abs(lineGap(entities))).toBeLessThan(1e-6);
        expect(Math.abs(pointGap(entities))).toBeLessThan(1e-6);
        expect(Math.abs(axisCosine(entities))).toBeLessThan(1e-6);
      }
      const moved = at(entities, axis);
      expect(Math.hypot(moved.x - from.x, moved.y - from.y)).toBeGreaterThan(1);
      expect(Math.hypot(moved.x - x, moved.y - y)).toBeLessThan(reach);
    });

  it("keeps the ellipse size when a constraint moves the line", () => {
    const solved = editedEntities([], {
      entities: base(),
      constraints: [tangent],
    });
    for (const id of ["ec", "em", "en"]) {
      const [p, q] = [at(solved, id), at(base(), id)];
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-4);
    }
  });
});

describe("ellipse constraint validation", () => {
  const sketch = (constraints: SketchConstraint[]): SketchFeature => ({
    id: "sk",
    type: "sketch",
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: base(),
    constraints,
  });
  const validate = (constraints: SketchConstraint[]) => () =>
    featureSpec("sketch")!.validate(sketch(constraints));

  it("accepts coincident and tangent constraints on an ellipse", () => {
    expect(
      validate([
        tangent,
        onEllipse,
        { id: "c", type: "coincident", a: "ec", b: "q" },
      ]),
    ).not.toThrow();
  });

  for (const c of [
    { id: "x", type: "tangent", a: "o", b: "e" },
    { id: "x", type: "equal", a: "o", b: "e" },
    { id: "x", type: "concentric", a: "o", b: "e" },
    { id: "x", type: "radius", entity: "e", value: 4 },
    { id: "x", type: "diameter", entity: "e", value: 8 },
    { id: "x", type: "pointOnCircle", point: "e", circle: "o" },
    { id: "x", type: "pointOnCircle", point: "e", circle: "e" },
  ] as SketchConstraint[])
    it(`refuses ${c.type} with ${JSON.stringify(c)}`, () => {
      expect(validate([c])).toThrow(/ellipse e/i);
    });
});
