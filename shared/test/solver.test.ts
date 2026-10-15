import { describe, expect, it } from "vitest";
import { solveSketch } from "../src/solver.js";
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
