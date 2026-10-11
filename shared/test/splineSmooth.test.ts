import { describe, expect, it } from "vitest";
import { bsplinePoint, interpolateFit, type BSpline } from "../src/bspline.js";
import { featureSpec } from "../src/index.js";
import type {
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchPoint,
  SketchSpline,
} from "../src/model.js";
import type { XY } from "../src/sketchCurves.js";
import { solveSketch } from "../src/solver.js";

const P = (id: string, x: number, y: number): SketchPoint => ({
  id,
  kind: "point",
  x,
  y,
});

const xy = (entities: SketchEntity[], id: string): XY => {
  const p = entities.find((e) => e.id === id);
  if (p?.kind !== "point") throw new Error(`no point ${id}`);
  return [p.x, p.y];
};

function circleThrough([a, b, c]: XY[]): XY {
  const [bx, by, cx, cy] = [
    b![0] - a![0],
    b![1] - a![1],
    c![0] - a![0],
    c![1] - a![1],
  ];
  const d = 2 * (bx * cy - by * cx);
  const [b2, c2] = [bx * bx + by * by, cx * cx + cy * cy];
  return [a![0] + (cy * b2 - by * c2) / d, a![1] + (bx * c2 - cx * b2) / d];
}

function curvatureAt(s: BSpline, u: number, toward: 1 | -1): XY {
  const estimate = (h: number): XY => {
    const pts = [0, 1, 2].map((k) => bsplinePoint(s, u + toward * k * h));
    const o = circleThrough(pts);
    const [vx, vy] = [o[0] - pts[0]![0], o[1] - pts[0]![1]];
    const r2 = vx * vx + vy * vy;
    return [vx / r2, vy / r2];
  };
  const span = s.knots.at(-1)! - s.knots[0]!;
  const h = 1e-3 * span;
  const [k1, k2, k4] = [estimate(h), estimate(h / 2), estimate(h / 4)];
  return [0, 1].map((i) => (8 * k4[i]! - 6 * k2[i]! + k1[i]!) / 3) as XY;
}

const spline = (
  id: string,
  poles: string[],
  knots: number[],
  mults: number[],
): SketchSpline => ({
  id,
  kind: "spline",
  degree: 3,
  poles,
  knots,
  multiplicities: mults,
});

const curveOf = (entities: SketchEntity[], e: SketchSpline): BSpline => ({
  degree: e.degree,
  poles: e.poles.map((id) => xy(entities, id)),
  knots: e.knots,
  multiplicities: e.multiplicities,
});

const A = spline("A", ["a0", "a1", "a2", "a3", "j"], [0, 0.5, 1], [4, 1, 4]);
const B = spline("B", ["j", "b1", "b2", "b3"], [0, 2], [4, 4]);

const smooth = (a: string, b: string): SketchConstraint => ({
  id: `g2-${a}-${b}`,
  type: "smooth",
  a,
  b,
});

const unit = ([x, y]: XY): XY => [x / Math.hypot(x, y), y / Math.hypot(x, y)];
const crossOf = (p: XY, q: XY) => p[0] * q[1] - p[1] * q[0];
const sub = (p: XY, q: XY): XY => [p[0] - q[0], p[1] - q[1]];

describe("smooth (G2) at spline joins (PAR-009)", () => {
  it("keeps two splines curvature continuous at a shared end through a pole drag", () => {
    let entities: SketchEntity[] = [
      P("a0", -30, 0),
      P("a1", -22, 9),
      P("a2", -14, 4),
      P("a3", -6, 6),
      P("j", 0, 0),
      P("b1", 6, -5),
      P("b2", 14, 3),
      P("b3", 22, -2),
      A,
      B,
    ];
    const constraints: SketchConstraint[] = [
      { id: "fj", type: "fix", point: "j" },
      { id: "fa", type: "fix", point: "a0" },
      { id: "fb", type: "fix", point: "b3" },
      { id: "fa1", type: "fix", point: "a1" },
      { id: "fb2", type: "fix", point: "b2" },
      smooth("A", "B"),
    ];
    const check = () => {
      const [ca, cb] = [curveOf(entities, A), curveOf(entities, B)];
      const ta = unit(sub(xy(entities, "a3"), xy(entities, "j")));
      const tb = unit(sub(xy(entities, "b1"), xy(entities, "j")));
      expect(Math.abs(crossOf(ta, tb))).toBeLessThan(1e-8);
      expect(ta[0] * tb[0] + ta[1] * tb[1]).toBeLessThan(0);
      const ka = curvatureAt(ca, 1, -1);
      const kb = curvatureAt(cb, 0, 1);
      expect(Math.hypot(ka[0], ka[1]), "join curvature").toBeGreaterThan(1e-3);
      expect(Math.hypot(ka[0] - kb[0], ka[1] - kb[1])).toBeLessThan(1e-6);
    };
    const first = solveSketch({ entities, constraints });
    expect(first.converged).toBe(true);
    entities = first.entities;
    check();
    for (const [x, y] of [
      [-14, 12],
      [-10, 16],
    ] as const) {
      const before = curvatureAt(curveOf(entities, B), 0, 1);
      const [x0, y0] = xy(entities, "a2");
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const drag = {
          pointId: "a2",
          x: x0 + (x - x0) * t,
          y: y0 + (y - y0) * t,
        };
        const step = solveSketch({ entities, constraints, drag });
        expect(step.converged).toBe(true);
        entities = step.entities;
        check();
      }
      const after = curvatureAt(curveOf(entities, B), 0, 1);
      expect(
        Math.hypot(after[0] - before[0], after[1] - before[1]),
      ).toBeGreaterThan(1e-4);
    }
  });

  it("brings a spline's end curvature to its arc's at a shared end", () => {
    const C = spline("C", ["s0", "s1", "s2", "j"], [0, 1], [4, 4]);
    const entities: SketchEntity[] = [
      P("o", 0, 10),
      P("e", 10, 10),
      P("j", 0, 0),
      { id: "arc", kind: "arc", center: "o", start: "j", end: "e" },
      P("s0", -20, 4),
      P("s1", -14, -3),
      P("s2", -6, 1),
      C,
    ];
    const constraints: SketchConstraint[] = [
      { id: "fo", type: "fix", point: "o" },
      { id: "fj", type: "fix", point: "j" },
      { id: "fe", type: "fix", point: "e" },
      { id: "fs", type: "fix", point: "s0" },
      smooth("C", "arc"),
    ];
    const r = solveSketch({ entities, constraints });
    expect(r.converged).toBe(true);
    const k = curvatureAt(curveOf(r.entities, C), 1, -1);
    expect(Math.hypot(k[0] - 0, k[1] - 0.1)).toBeLessThan(1e-6);
  });

  it("flattens a fit spline's end where it meets a line", () => {
    const entities: SketchEntity[] = [
      P("q0", 0, 0),
      P("q1", 8, 6),
      P("q2", 16, 2),
      P("h0", 3, 4),
      P("h1", 13, -2),
      {
        id: "fs",
        kind: "fitSpline",
        points: ["q0", "q1", "q2"],
        handles: ["h0", "h1"],
      },
      P("t", 30, 0),
      { id: "l", kind: "line", p1: "q2", p2: "t" },
    ];
    const constraints: SketchConstraint[] = [
      { id: "f0", type: "fix", point: "q0" },
      { id: "f1", type: "fix", point: "q1" },
      { id: "f2", type: "fix", point: "q2" },
      { id: "ft", type: "fix", point: "t" },
      smooth("fs", "l"),
    ];
    const r = solveSketch({ entities, constraints });
    expect(r.converged).toBe(true);
    const fit = interpolateFit(
      ["q0", "q1", "q2"].map((id) => xy(r.entities, id)),
      [xy(r.entities, "h0"), xy(r.entities, "h1")],
    );
    if (typeof fit === "string") throw new Error(fit);
    const k = curvatureAt(fit, 1, -1);
    expect(Math.hypot(...k)).toBeLessThan(1e-6);
  });

  it("needs a spline joined at its end", () => {
    const entities: SketchEntity[] = [
      P("a", 0, 0),
      P("b", 10, 0),
      P("c", 10, 10),
      { id: "l1", kind: "line", p1: "a", p2: "b" },
      { id: "l2", kind: "line", p1: "b", p2: "c" },
      P("j", 30, 0),
      P("s1", 34, 4),
      P("s2", 38, 0),
      { ...spline("S", ["j", "s1", "s2"], [0, 1], [3, 3]), degree: 2 },
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
    expect(validate(smooth("l1", "l2"))).toThrow(/smooth needs a spline/);
    expect(validate(smooth("S", "l1"))).toThrow(/shared end/);
  });
});
