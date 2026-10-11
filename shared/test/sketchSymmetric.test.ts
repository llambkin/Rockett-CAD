import { describe, expect, it } from "vitest";
import { featureSpec } from "../src/index.js";
import type {
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchPoint,
} from "../src/model.js";
import { solveSketch } from "../src/solver.js";

const P = (id: string, x: number, y: number): SketchPoint => ({
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

type XY = { x: number; y: number };

function mirror(p: XY, a: XY, b: XY): XY {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const foot = { x: a.x + t * dx, y: a.y + t * dy };
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
}

const at = (entities: SketchEntity[], id: string): SketchPoint => {
  const p = entities.find((e) => e.id === id);
  if (p?.kind !== "point") throw new Error(`no point ${id}`);
  return p;
};

const gap = (p: XY, q: XY) => Math.hypot(p.x - q.x, p.y - q.y);

const symmetric = (a: string, b: string, line = "axis"): SketchConstraint => ({
  id: `sym-${a}-${b}`,
  type: "symmetric",
  a,
  b,
  line,
});

const axis = (entities: SketchEntity[]) => [
  at(entities, "l1"),
  at(entities, "l2"),
];

describe("symmetric about a line (PAR-009)", () => {
  it("keeps two points mirrored across a slanted line through a drag", () => {
    let entities: SketchEntity[] = [
      P("l1", 0, 0),
      P("l2", 10, 5),
      L("axis", "l1", "l2"),
      P("a", 2, 6),
      P("b", 7, 1),
    ];
    const constraints: SketchConstraint[] = [
      { id: "f1", type: "fix", point: "l1" },
      { id: "f2", type: "fix", point: "l2" },
      symmetric("a", "b"),
    ];
    const first = solveSketch({ entities, constraints });
    expect(first.converged).toBe(true);
    entities = first.entities;
    const [l1, l2] = axis(entities);
    expect(
      gap(mirror(at(entities, "a"), l1!, l2!), at(entities, "b")),
    ).toBeLessThan(1e-9);
    for (const [x, y] of [
      [-3, 8],
      [-6, 2],
      [4, 12],
    ] as const) {
      const before = { ...at(entities, "b") };
      const step = solveSketch({
        entities,
        constraints,
        drag: { pointId: "a", x, y },
      });
      expect(step.converged).toBe(true);
      entities = step.entities;
      const a = at(entities, "a");
      const b = at(entities, "b");
      expect(gap(mirror(a, l1!, l2!), b)).toBeLessThan(1e-9);
      expect(gap(mirror(b, l1!, l2!), a)).toBeLessThan(1e-9);
      expect(gap(b, before)).toBeGreaterThan(0.1);
    }
    expect(gap(at(entities, "l1"), { x: 0, y: 0 })).toBe(0);
  });

  it("mirrors the line itself when its ends are free", () => {
    const entities: SketchEntity[] = [
      P("l1", 0, -5),
      P("l2", 1, 5),
      L("axis", "l1", "l2"),
      P("a", -4, 0),
      P("b", 3, 1),
    ];
    const constraints: SketchConstraint[] = [
      { id: "fa", type: "fix", point: "a" },
      { id: "fb", type: "fix", point: "b" },
      symmetric("a", "b"),
    ];
    const r = solveSketch({ entities, constraints });
    expect(r.converged).toBe(true);
    const [l1, l2] = axis(r.entities);
    expect(
      gap(mirror(at(r.entities, "a"), l1!, l2!), at(r.entities, "b")),
    ).toBeLessThan(1e-9);
  });

  it("mirrors two circles' centres and equalises their radii", () => {
    const entities: SketchEntity[] = [
      P("l1", 0, 0),
      P("l2", 0, 10),
      L("axis", "l1", "l2"),
      P("c1", -5, 2),
      P("c2", 6, 3),
      { id: "k1", kind: "circle", center: "c1", radius: 2 },
      { id: "k2", kind: "circle", center: "c2", radius: 3 },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f1", type: "fix", point: "l1" },
      { id: "f2", type: "fix", point: "l2" },
      symmetric("k1", "k2"),
    ];
    const r = solveSketch({ entities, constraints });
    expect(r.converged).toBe(true);
    const [l1, l2] = axis(r.entities);
    expect(
      gap(mirror(at(r.entities, "c1"), l1!, l2!), at(r.entities, "c2")),
    ).toBeLessThan(1e-9);
    const radii = r.entities.flatMap((e) =>
      e.kind === "circle" ? [e.radius] : [],
    );
    expect(Math.abs(radii[0]! - radii[1]!)).toBeLessThan(1e-9);
  });

  it("puts each line's mirror on the other line", () => {
    const entities: SketchEntity[] = [
      P("l1", 0, 0),
      P("l2", 0, 10),
      L("axis", "l1", "l2"),
      P("a1", -2, 1),
      P("a2", -6, 8),
      L("la", "a1", "a2"),
      P("b1", 3, 2),
      P("b2", 5, 9),
      L("lb", "b1", "b2"),
    ];
    const constraints: SketchConstraint[] = [
      { id: "f1", type: "fix", point: "l1" },
      { id: "f2", type: "fix", point: "l2" },
      symmetric("la", "lb"),
    ];
    const r = solveSketch({ entities, constraints });
    expect(r.converged).toBe(true);
    const [l1, l2] = axis(r.entities);
    const [b1, b2] = [at(r.entities, "b1"), at(r.entities, "b2")];
    for (const end of ["a1", "a2"]) {
      const m = mirror(at(r.entities, end), l1!, l2!);
      const cross = (b2.x - b1.x) * (m.y - b1.y) - (b2.y - b1.y) * (m.x - b1.x);
      expect(Math.abs(cross) / gap(b1, b2)).toBeLessThan(1e-9);
    }
  });

  it("refuses unlike pairs and a symmetry line that is not a line", () => {
    const entities: SketchEntity[] = [
      P("l1", 0, 0),
      P("l2", 0, 10),
      L("axis", "l1", "l2"),
      P("p", 3, 3),
      P("c", -3, 3),
      { id: "k", kind: "circle", center: "c", radius: 1 },
    ];
    const sketch = (c: SketchConstraint): SketchFeature => ({
      id: "s",
      type: "sketch",
      name: "S",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities,
      constraints: [c],
    });
    const validate = (c: SketchConstraint) => () =>
      featureSpec("sketch")!.validate(sketch(c));
    expect(validate(symmetric("p", "l1"))).not.toThrow();
    expect(validate(symmetric("p", "k"))).toThrow(
      /two points, two lines or two circles or arcs/,
    );
    expect(validate(symmetric("p", "l1", "k"))).toThrow(
      /two points, two lines or two circles or arcs/,
    );
  });
});
