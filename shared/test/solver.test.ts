import { describe, expect, it } from "vitest";
import { editedEntities, solveSketch } from "../src/solver.js";
import { FEATURE_SCHEMAS } from "../src/schema/features.js";
import { parse } from "../src/schema/index.js";
import type { SketchConstraint, SketchEntity } from "../src/model.js";

function pt(id: string, x: number, y: number): SketchEntity {
  return { id, kind: "point", x, y };
}

describe("sketch solver", () => {
  it("solves a dimensioned rectangle to exact size", () => {
    // Rectangle roughly 90x40, dimensioned to 100x50, corner fixed at origin
    const entities: SketchEntity[] = [
      pt("a", 0, 0),
      pt("b", 91, 2),
      pt("c", 88, 41),
      pt("d", -2, 39),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
      { id: "l2", kind: "line", p1: "b", p2: "c" },
      { id: "l3", kind: "line", p1: "c", p2: "d" },
      { id: "l4", kind: "line", p1: "d", p2: "a" },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f", type: "fix", point: "a" },
      { id: "h1", type: "horizontal", line: "l1" },
      { id: "h2", type: "horizontal", line: "l3" },
      { id: "v1", type: "vertical", line: "l2" },
      { id: "v2", type: "vertical", line: "l4" },
      { id: "d1", type: "length", line: "l1", value: 100 },
      { id: "d2", type: "length", line: "l2", value: 50 },
    ];
    const res = solveSketch({ entities, constraints });
    expect(res.converged).toBe(true);
    const P = new Map(
      res.entities.filter((e) => e.kind === "point").map((e: any) => [e.id, e]),
    );
    expect(P.get("a")!.x).toBeCloseTo(0, 6);
    expect(P.get("b")!.x).toBeCloseTo(100, 5);
    expect(P.get("b")!.y).toBeCloseTo(0, 5);
    expect(P.get("c")!.x).toBeCloseTo(100, 5);
    expect(P.get("c")!.y).toBeCloseTo(50, 5);
    expect(P.get("d")!.y).toBeCloseTo(50, 5);
    expect(res.status).toBe("fully_constrained");
    expect(res.dof).toBe(0);
  });

  it("reports partially constrained sketches", () => {
    const entities: SketchEntity[] = [
      pt("a", 0, 0),
      pt("b", 30, 5),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f", type: "fix", point: "a" },
      { id: "d", type: "length", line: "l1", value: 40 },
    ];
    const res = solveSketch({ entities, constraints });
    expect(res.converged).toBe(true);
    expect(res.status).toBe("partially_constrained");
    expect(res.dof).toBe(1); // line direction free
    const b: any = res.entities.find((e) => e.id === "b");
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(40, 5);
  });

  it("detects conflicting constraints", () => {
    const entities: SketchEntity[] = [
      pt("a", 0, 0),
      pt("b", 30, 0),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f1", type: "fix", point: "a" },
      { id: "f2", type: "fix", point: "b" },
      { id: "d", type: "length", line: "l1", value: 50 }, // impossible: both fixed at 30 apart
    ];
    const res = solveSketch({ entities, constraints });
    expect(res.converged).toBe(false);
    expect(res.status).toBe("over_constrained");
  });

  it("solves radius/diameter on circles", () => {
    const entities: SketchEntity[] = [
      pt("c", 10, 10),
      { id: "circ", kind: "circle", center: "c", radius: 3 },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f", type: "fix", point: "c" },
      { id: "d", type: "diameter", entity: "circ", value: 10 },
    ];
    const res = solveSketch({ entities, constraints });
    expect(res.converged).toBe(true);
    const circ: any = res.entities.find((e) => e.id === "circ");
    expect(circ.radius).toBeCloseTo(5, 6);
    expect(res.status).toBe("fully_constrained");
  });

  it("solves tangent line-circle with distance dims", () => {
    const entities: SketchEntity[] = [
      pt("a", 0, 0),
      pt("b", 40, 1),
      pt("c", 20, 12),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
      { id: "circ", kind: "circle", center: "c", radius: 8 },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f1", type: "fix", point: "a" },
      { id: "f2", type: "fix", point: "b" },
      { id: "r", type: "radius", entity: "circ", value: 10 },
      { id: "t", type: "tangent", a: "l1", b: "circ" },
    ];
    const res = solveSketch({ entities, constraints });
    expect(res.converged).toBe(true);
    const c: any = res.entities.find((e) => e.id === "c");
    // distance from center to line ab should equal 10
    const dx = 40,
      dy = 1;
    const len = Math.hypot(dx, dy);
    const dist = Math.abs(dx * c.y - dy * c.x) / len;
    expect(dist).toBeCloseTo(10, 4);
  });

  it("drag pulls a free point while keeping constraints", () => {
    const entities: SketchEntity[] = [
      pt("a", 0, 0),
      pt("b", 20, 0),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f", type: "fix", point: "a" },
      { id: "d", type: "length", line: "l1", value: 20 },
    ];
    const res = solveSketch({
      entities,
      constraints,
      drag: { pointId: "b", x: 0, y: 25 },
    });
    expect(res.converged).toBe(true);
    const b: any = res.entities.find((e) => e.id === "b");
    // b stays on circle radius 20 around origin, near the drag direction
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(20, 4);
    expect(b.y).toBeGreaterThan(10);
  });

  it("solves coincident + midpoint + parallel network", () => {
    const entities: SketchEntity[] = [
      pt("a", 0, 0),
      pt("b", 50, 0),
      pt("m", 10, 10),
      pt("c", 0, 20),
      pt("d", 47, 22),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
      { id: "l2", kind: "line", p1: "c", p2: "d" },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f1", type: "fix", point: "a" },
      { id: "f2", type: "fix", point: "b" },
      { id: "mp", type: "midpoint", point: "m", line: "l1" },
      { id: "par", type: "parallel", a: "l1", b: "l2" },
    ];
    const res = solveSketch({ entities, constraints });
    expect(res.converged).toBe(true);
    const m: any = res.entities.find((e) => e.id === "m");
    expect(m.x).toBeCloseTo(25, 5);
    expect(m.y).toBeCloseTo(0, 5);
    const c: any = res.entities.find((e) => e.id === "c");
    const d: any = res.entities.find((e) => e.id === "d");
    expect(Math.abs(d.y - c.y)).toBeLessThan(1e-4); // parallel to horizontal l1
  });
});

const line = (x: number, y: number): SketchEntity[] => [
  pt("a", 0, 0),
  pt("b", x, y),
  { id: "l1", kind: "line", p1: "a", p2: "b" },
];
const held = (value: number): SketchConstraint[] => [
  { id: "f", type: "fix", point: "a" },
  { id: "len", type: "length", line: "l1", value: 10 },
  { id: "ang", type: "lineAngle", line: "l1", value },
];
const end = (entities: SketchEntity[]) => {
  const b = entities.find((e) => e.id === "b");
  if (b?.kind !== "point") throw new Error("end point missing");
  return b;
};

describe("line angle constraint", () => {
  it("drives a line to its angle from the +X axis", () => {
    const res = solveSketch({ entities: line(9, 2), constraints: held(30) });
    expect(res.converged).toBe(true);
    expect(end(res.entities).x).toBeCloseTo(8.6603, 4);
    expect(end(res.entities).y).toBeCloseTo(5, 4);
    expect(res.status).toBe("fully_constrained");
    expect(res.dof).toBe(0);
  });

  it("flips a line drawn at 0 degrees to 180", () => {
    const res = solveSketch({ entities: line(10, 0), constraints: held(180) });
    expect(res.converged).toBe(true);
    expect(end(res.entities).x).toBeCloseTo(-10, 4);
    expect(end(res.entities).y).toBeCloseTo(0, 4);
  });

  it("keeps the residual continuous across the 180 degree wrap", () => {
    const rad = (-179 * Math.PI) / 180;
    const res = solveSketch({
      entities: line(10 * Math.cos(rad), 10 * Math.sin(rad)),
      constraints: held(180),
    });
    expect(res.converged).toBe(true);
    expect(end(res.entities).x).toBeCloseTo(-10, 4);
    expect(end(res.entities).y).toBeCloseTo(0, 4);
  });

  it("counts one degree of freedom and reports a conflict", () => {
    const free = solveSketch({
      entities: line(9, 2),
      constraints: [
        { id: "f", type: "fix", point: "a" },
        { id: "ang", type: "lineAngle", line: "l1", value: -45 },
      ],
    });
    expect(free.status).toBe("partially_constrained");
    expect(free.dof).toBe(1);
    const b = end(free.entities);
    expect(b.y / b.x).toBeCloseTo(-1, 6);
    expect(b.x).toBeGreaterThan(0);

    const clash = solveSketch({
      entities: line(9, 2),
      constraints: [...held(30), { id: "h", type: "horizontal", line: "l1" }],
    });
    expect(clash.converged).toBe(false);
    expect(clash.status).toBe("over_constrained");
  });
});

describe("damped steps", () => {
  it("makes a circle tangent to an arc whose centres share an axis", () => {
    const res = solveSketch({
      entities: [
        pt("c0", 0, 0),
        { id: "o1", kind: "circle", center: "c0", radius: 10 },
        pt("c1", 20, 0),
        pt("s", 25, 0),
        pt("t", 20, 5),
        { id: "r1", kind: "arc", center: "c1", start: "s", end: "t" },
      ],
      constraints: [{ id: "tan", type: "tangent", a: "o1", b: "r1" }],
    });
    expect(res.converged).toBe(true);
  });
});

const squares = (count: number, skew: number): SketchEntity[] =>
  Array.from({ length: count }, (_, k): SketchEntity[] => [
    pt(`${k}:0`, 20 * k, 0),
    pt(`${k}:1`, 20 * k + 10, 0),
    pt(`${k}:2`, 20 * k + 10 + skew, 10),
    pt(`${k}:3`, 20 * k, 10),
    ...[0, 1, 2, 3].map((i): SketchEntity => ({
      id: `${k}:l${i}`,
      kind: "line",
      p1: `${k}:${i}`,
      p2: `${k}:${(i + 1) % 4}`,
    })),
  ]).flat();
const squareConstraints = (count: number): SketchConstraint[] =>
  Array.from({ length: count }, (_, k): SketchConstraint[] => [
    { id: `${k}:h0`, type: "horizontal", line: `${k}:l0` },
    { id: `${k}:v1`, type: "vertical", line: `${k}:l1` },
    { id: `${k}:h2`, type: "horizontal", line: `${k}:l2` },
    { id: `${k}:v3`, type: "vertical", line: `${k}:l3` },
  ]).flat();
const outside = (entities: SketchEntity[], square: number) =>
  entities.filter((e) => !e.id.startsWith(`${square}:`));
const at = (entities: SketchEntity[], id: string) => {
  const p = entities.find((e) => e.id === id);
  if (p?.kind !== "point") throw new Error(`point ${id} missing`);
  return p;
};

describe("connected components", () => {
  it("drags one line in a 5,000-entity sketch and moves only its component", () => {
    const entities = squares(625, 0.5);
    expect(entities).toHaveLength(5000);
    const res = solveSketch({
      entities,
      constraints: squareConstraints(625),
      drag: { pointId: "7:1", x: 160, y: -4 },
    });
    expect(outside(res.entities, 7)).toEqual(outside(entities, 7));
    const [p0, p1, p2] = ["7:0", "7:1", "7:2"].map((id) =>
      at(res.entities, id),
    );
    expect(p1!.y).toBeLessThan(-1);
    expect(p1!.y - p0!.y).toBeCloseTo(0, 6);
    expect(p2!.x - p1!.x).toBeCloseTo(0, 6);
  });

  it("solves only the components an edit touches", () => {
    const entities = squares(3, 0.5);
    const before = squareConstraints(3);
    const after = editedEntities(before, {
      entities,
      constraints: [
        ...before,
        { id: "0:len", type: "length", line: "0:l0", value: 12 },
      ],
    });
    expect(outside(after, 0)).toEqual(outside(entities, 0));
    expect(at(after, "0:1").x - at(after, "0:0").x).toBeCloseTo(12, 6);
  });

  it("validates a sketch past the old entity, constraint and offset counts", () => {
    const entities = squares(1251, 0);
    const ids = entities.map((e) => e.id);
    const offsets = ids.slice(0, 1001).map((id, i) => ({
      id: `o${i}`,
      distance: 1,
      sourceIds: [id],
      entityIds: i === 0 ? ids : [id],
      joinTolerance: 0,
    }));
    const sketch = {
      id: "sk",
      name: "Sketch",
      suppressed: false,
      type: "sketch",
      plane: { kind: "origin", plane: "XY" },
      entities,
      constraints: squareConstraints(1251),
      offsets,
    };
    expect(parse(FEATURE_SCHEMAS.sketch, sketch)).toBe(sketch);
  });
});

const add = (
  sketch: { entities: SketchEntity[]; constraints: SketchConstraint[] },
  c: SketchConstraint,
) =>
  editedEntities(sketch.constraints, {
    entities: sketch.entities,
    constraints: [...sketch.constraints, c],
  });
const width = (side: string): SketchConstraint => ({
  id: `w${side}`,
  type: "length",
  line: side,
  value: 10,
});

describe("redundant constraints (CUST-082)", () => {
  const crossing = (rise: number) => ({
    entities: [
      pt("a", 0, 0),
      pt("b", 100, 0),
      pt("c", 0, -rise),
      pt("d", 100, rise),
      pt("p", 50, 0),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
      { id: "l2", kind: "line", p1: "c", p2: "d" },
    ] as SketchEntity[],
    constraints: [
      ...["a", "b", "c", "d"].map((point): SketchConstraint => ({
        id: `f${point}`,
        type: "fix",
        point,
      })),
      { id: "on1", type: "pointOnLine", point: "p", line: "l1" },
    ] as SketchConstraint[],
  });
  const onSecond: SketchConstraint = {
    id: "on2",
    type: "pointOnLine",
    point: "p",
    line: "l2",
  };

  it("refuses a second horizontal on a horizontal line", () => {
    expect(() =>
      add(
        { entities: squares(2, 0), constraints: squareConstraints(2) },
        { id: "h", type: "horizontal", line: "1:l0" },
      ),
    ).toThrow("Horizontal would over-constrain the sketch.");
  });

  it("refuses a point on a line it already lies on through a collinear line", () => {
    expect(() => add(crossing(0), onSecond)).toThrow(
      "Point on line would over-constrain the sketch.",
    );
  });

  it("accepts a point on a line crossing at a shallow angle", () => {
    expect(() => add(crossing(0.05), onSecond)).not.toThrow();
  });

  it("does not judge an existing redundant dimension again when only its label moves", () => {
    const fixed: SketchConstraint[] = [
      ...squareConstraints(1),
      { id: "f", type: "fix", point: "0:0" },
      width("0:l0"),
      width("0:l1"),
    ];
    expect(() =>
      editedEntities([...fixed, width("0:l2")], {
        entities: squares(1, 0),
        constraints: [...fixed, { ...width("0:l2"), labelOffset: [1, 2] }],
      }),
    ).not.toThrow();
    expect(() =>
      editedEntities(fixed, {
        entities: squares(1, 0),
        constraints: [...fixed, width("0:l2")],
      }),
    ).toThrow("Length 10 mm would over-constrain the sketch.");
  });
});
