import { describe, expect, it } from "vitest";
import { bsplinePoint, conicSpline, interpolateFit } from "../src/bspline.js";
import { featureSpec } from "../src/index.js";
import type {
  SketchConstraint,
  SketchEntity,
  SketchFeature,
  SketchPoint,
} from "../src/model.js";
import { curveDistance, sketchCurves, type XY } from "../src/sketchCurves.js";
import { solveSketch } from "../src/solver.js";

const P = (id: string, x: number, y: number): SketchPoint => ({
  id,
  kind: "point",
  x,
  y,
});

function basis(flat: number[], i: number, p: number, u: number): number {
  if (p === 0) {
    const last = flat.at(-1)!;
    const inSpan = flat[i]! <= u && u < flat[i + 1]!;
    const atEnd = u === last && flat[i]! < last && flat[i + 1] === last;
    return inSpan || atEnd ? 1 : 0;
  }
  const left = flat[i + p]! - flat[i]!;
  const right = flat[i + p + 1]! - flat[i + 1]!;
  const a = left ? ((u - flat[i]!) / left) * basis(flat, i, p - 1, u) : 0;
  const b = right
    ? ((flat[i + p + 1]! - u) / right) * basis(flat, i + 1, p - 1, u)
    : 0;
  return a + b;
}

function oracleEval(poles: XY[], flat: number[], p: number, u: number): XY {
  let x = 0;
  let y = 0;
  poles.forEach(([px, py], i) => {
    const n = basis(flat, i, p, u);
    x += n * px;
    y += n * py;
  });
  return [x, y];
}

function gauss(a: number[][], b: XY[]): XY[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]![0], b[i]![1]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(m[r]![c]!) > Math.abs(m[pivot]![c]!)) pivot = r;
    [m[c], m[pivot]] = [m[pivot]!, m[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k < n + 2; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return m.map((row, i) => [row[n]! / m[i]![i]!, row[n + 1]! / m[i]![i]!]);
}

function oracleFit(fit: XY[], [h0, h1]: [XY, XY]) {
  const n = fit.length - 1;
  const chords = fit
    .slice(1)
    .map((q, k) => Math.hypot(q[0] - fit[k]![0], q[1] - fit[k]![1]));
  const total = chords.reduce((s, d) => s + d, 0);
  const params: number[] = [0];
  for (const d of chords) params.push(params.at(-1)! + d / total);
  params[n] = 1;
  const flat = [0, 0, 0, 0, ...params.slice(1, -1), 1, 1, 1, 1];
  const size = n + 3;
  const unit = (j: number): number[] =>
    Array.from({ length: size }, (_, i) => (i === j ? 1 : 0));
  const rows = [unit(0), unit(1)];
  const rhs: XY[] = [fit[0]!, h0];
  for (let k = 1; k < n; k++) {
    rows.push(
      Array.from({ length: size }, (_, i) => basis(flat, i, 3, params[k]!)),
    );
    rhs.push(fit[k]!);
  }
  rows.push(unit(size - 2), unit(size - 1));
  rhs.push(h1, fit[n]!);
  return { poles: gauss(rows, rhs), flat, params };
}

const flatOf = (s: { knots: number[]; multiplicities: number[] }) =>
  s.knots.flatMap((k, i) => Array<number>(s.multiplicities[i]!).fill(k));

const fit: XY[] = [
  [0, 0],
  [10, 6],
  [22, 4],
  [30, -5],
  [41, 2],
];
const handles: [XY, XY] = [
  [3, 5],
  [45, 8],
];

describe("fit-point interpolation", () => {
  it("matches an independent dense interpolation with the handles as end poles", () => {
    const spline = interpolateFit(fit, handles);
    if (typeof spline === "string") throw new Error(spline);
    const oracle = oracleFit(fit, handles);
    expect(spline.degree).toBe(3);
    expect(flatOf(spline)).toHaveLength(oracle.flat.length);
    flatOf(spline).forEach((k, i) =>
      expect(k).toBeCloseTo(oracle.flat[i]!, 12),
    );
    expect(spline.poles).toHaveLength(oracle.poles.length);
    spline.poles.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(oracle.poles[i]![0], 9);
      expect(y).toBeCloseTo(oracle.poles[i]![1], 9);
    });
  });

  it("passes through every fit point and leaves along each tangent handle", () => {
    const spline = interpolateFit(fit, handles);
    if (typeof spline === "string") throw new Error(spline);
    const { flat, params } = oracleFit(fit, handles);
    fit.forEach(([x, y], k) => {
      const [ox, oy] = oracleEval(spline.poles, flat, 3, params[k]!);
      expect(Math.hypot(ox - x, oy - y)).toBeLessThan(1e-9);
      const [sx, sy] = bsplinePoint(spline, params[k]!);
      expect(Math.hypot(sx - x, sy - y)).toBeLessThan(1e-9);
    });
    const h = 1e-5;
    const slope = (u0: number, sign: 1 | -1): XY => {
      const [f0, f1, f2] = [0, 1, 2].map((k) =>
        oracleEval(spline.poles, flat, 3, u0 + sign * k * h),
      ) as [XY, XY, XY];
      const d = (i: 0 | 1) =>
        (sign * (-3 * f0[i] + 4 * f1[i] - f2[i])) / (2 * h);
      return [d(0), d(1)];
    };
    const head = slope(0, 1);
    const tail = slope(1, -1);
    const [u1, un] = [params[1]!, 1 - params[3]!];
    expect(head[0]).toBeCloseTo((3 * (handles[0][0] - fit[0]![0])) / u1, 4);
    expect(head[1]).toBeCloseTo((3 * (handles[0][1] - fit[0]![1])) / u1, 4);
    expect(tail[0]).toBeCloseTo((3 * (fit[4]![0] - handles[1][0])) / un, 4);
    expect(tail[1]).toBeCloseTo((3 * (fit[4]![1] - handles[1][1])) / un, 4);
  });

  it("refuses coincident fit points and a handle on its end", () => {
    expect(
      interpolateFit(
        [
          [0, 0],
          [0, 0],
          [5, 5],
        ],
        handles,
      ),
    ).toMatch(/fit points/);
    expect(interpolateFit([[0, 0]], handles)).toMatch(/two fit points/);
    expect(
      interpolateFit(fit, [
        [0, 0],
        [45, 8],
      ]),
    ).toMatch(/handle/);
  });
});

const conicPoint = (s: XY, a: XY, e: XY, w: number, t: number): XY => {
  const [b0, b1, b2] = [(1 - t) ** 2, 2 * t * (1 - t) * w, t * t];
  const d = b0 + b1 + b2;
  return [
    (b0 * s[0] + b1 * a[0] + b2 * e[0]) / d,
    (b0 * s[1] + b1 * a[1] + b2 * e[1]) / d,
  ];
};

describe("conic rho", () => {
  const [s, a, e]: [XY, XY, XY] = [
    [0, 0],
    [6, 8],
    [14, 0],
  ];

  it.each([0.2, 0.5, 0.8])(
    "puts the shoulder at rho %s of the way to the apex",
    (rho) => {
      const spline = conicSpline(s, a, e, rho);
      if (typeof spline === "string") throw new Error(spline);
      const [mx, my] = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
      const [x, y] = bsplinePoint(spline, 0.5);
      expect(x).toBeCloseTo(mx + rho * (a[0] - mx), 12);
      expect(y).toBeCloseTo(my + rho * (a[1] - my), 12);
      const w = rho / (1 - rho);
      for (const t of [0.1, 0.3, 0.7, 0.9]) {
        const [ox, oy] = conicPoint(s, a, e, w, t);
        const [cx, cy] = bsplinePoint(spline, t);
        expect(Math.hypot(cx - ox, cy - oy)).toBeLessThan(1e-12);
      }
    },
  );

  it("refuses rho outside 0 to 1 and an apex on the chord", () => {
    expect(conicSpline(s, a, e, 0)).toMatch(/rho/);
    expect(conicSpline(s, a, e, 1)).toMatch(/rho/);
    expect(conicSpline(s, [7, 0], e, 0.5)).toMatch(/apex/);
    expect(conicSpline(s, a, s, 0.5)).toMatch(/ends/);
  });
});

const fitEntities = (): SketchEntity[] => [
  ...fit.map(([x, y], i) => P(`f${i}`, x, y)),
  P("h0", ...handles[0]),
  P("h1", ...handles[1]),
  {
    id: "fs",
    kind: "fitSpline",
    points: ["f0", "f1", "f2", "f3", "f4"],
    handles: ["h0", "h1"],
  },
  P("l1", -10, -3),
  { id: "l", kind: "line", p1: "l1", p2: "f0" },
];

const conicEntities = (rho: number): SketchEntity[] => [
  P("cs", 0, 0),
  P("ca", 6, 8),
  P("ce", 14, 0),
  {
    id: "cn",
    kind: "spline",
    degree: 2,
    poles: ["cs", "ca", "ce"],
    knots: [0, 1],
    multiplicities: [3, 3],
    rho,
  },
  P("m", -10, 2),
  { id: "ml", kind: "line", p1: "m", p2: "cs" },
];

const at = (entities: SketchEntity[], id: string): XY => {
  const p = entities.find((x) => x.id === id);
  if (p?.kind !== "point") throw new Error(id);
  return [p.x, p.y];
};
const sine = (a: XY, b: XY) =>
  (a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b));
const minus = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const tangent = (a: string, b: string): SketchConstraint => ({
  id: `t-${a}-${b}`,
  type: "tangent",
  a,
  b,
});

describe("spline end relations in the solver", () => {
  it("keeps every fit point and handle as a solver unknown", () => {
    const solved = solveSketch({ entities: fitEntities(), constraints: [] });
    expect(solved.dof).toBe(2 * 8);
    const curve = sketchCurves(solved.entities).find((c) => c.id === "fs")!;
    expect(curve.kind).toBe("spline");
    for (let i = 0; i < 5; i++) {
      const [x, y] = at(solved.entities, `f${i}`);
      expect(curveDistance(curve, x, y)).toBeLessThan(1e-9);
    }
  });

  it("holds a fit spline tangent to a line through a fit point drag", () => {
    const constraints = [tangent("fs", "l")];
    const solved = solveSketch({ entities: fitEntities(), constraints });
    expect(solved.converged).toBe(true);
    expect(solved.dof).toBe(2 * 8 - 1);
    const e = solved.entities;
    expect(
      sine(minus(at(e, "h0"), at(e, "f0")), minus(at(e, "l1"), at(e, "f0"))),
    ).toBeCloseTo(0, 6);
    const dragged = solveSketch({
      entities: e,
      constraints,
      drag: { pointId: "f2", x: 22, y: 12 },
    });
    expect(dragged.converged).toBe(true);
    const d = dragged.entities;
    expect(Math.hypot(...minus(at(d, "f2"), [22, 12]))).toBeLessThan(1e-3);
    expect(
      sine(minus(at(d, "h0"), at(d, "f0")), minus(at(d, "l1"), at(d, "f0"))),
    ).toBeCloseTo(0, 6);
    const curve = sketchCurves(d).find((c) => c.id === "fs")!;
    expect(curveDistance(curve, ...at(d, "f2"))).toBeLessThan(1e-9);
  });

  it("holds a conic tangent to a line and keeps its rho through a solve", () => {
    const constraints = [tangent("ml", "cn")];
    const held = solveSketch({ entities: conicEntities(0.3), constraints });
    const solved = solveSketch({
      entities: held.entities,
      constraints,
      drag: { pointId: "ca", x: 7, y: 10 },
    });
    expect(solved.converged).toBe(true);
    const e = solved.entities;
    expect(
      sine(minus(at(e, "ca"), at(e, "cs")), minus(at(e, "m"), at(e, "cs"))),
    ).toBeCloseTo(0, 6);
    expect(Math.hypot(...minus(at(e, "ca"), [7, 10]))).toBeLessThan(0.5);
    expect(e.find((x) => x.id === "cn")).toMatchObject({ rho: 0.3 });
    const curve = sketchCurves(e).find((c) => c.id === "cn")!;
    expect(curve).toMatchObject({ weights: [1, 0.3 / 0.7, 1] });
  });

  it("holds a control spline tangent to an arc at a shared end", () => {
    const entities: SketchEntity[] = [
      P("c", 0, 0),
      P("s", 10, 0),
      P("q", 0, 10),
      { id: "arc", kind: "arc", center: "c", start: "s", end: "q" },
      P("p1", 4, 14),
      P("p2", -6, 18),
      P("p3", -12, 12),
      {
        id: "cs",
        kind: "spline",
        degree: 3,
        poles: ["q", "p1", "p2", "p3"],
        knots: [0, 1],
        multiplicities: [4, 4],
      },
    ];
    const solved = solveSketch({
      entities,
      constraints: [tangent("cs", "arc")],
    });
    expect(solved.converged).toBe(true);
    const e = solved.entities;
    const [d, r] = [
      minus(at(e, "p1"), at(e, "q")),
      minus(at(e, "q"), at(e, "c")),
    ];
    expect(
      (d[0] * r[0] + d[1] * r[1]) / (Math.hypot(...d) * Math.hypot(...r)),
    ).toBeCloseTo(0, 6);
  });

  it("joins two splines tangent through a coincident end", () => {
    const entities: SketchEntity[] = [
      ...fitEntities().filter((x) => x.kind !== "line" && x.id !== "l1"),
      P("j0", 41.5, 2.5),
      P("j1", 50, -6),
      P("j2", 60, 0),
      {
        id: "next",
        kind: "spline",
        degree: 2,
        poles: ["j0", "j1", "j2"],
        knots: [0, 1],
        multiplicities: [3, 3],
      },
    ];
    const constraints: SketchConstraint[] = [
      { id: "co", type: "coincident", a: "f4", b: "j0" },
      tangent("fs", "next"),
    ];
    const solved = solveSketch({ entities, constraints });
    expect(solved.converged).toBe(true);
    const e = solved.entities;
    expect(Math.hypot(...minus(at(e, "f4"), at(e, "j0")))).toBeLessThan(1e-6);
    expect(
      sine(minus(at(e, "h1"), at(e, "f4")), minus(at(e, "j1"), at(e, "j0"))),
    ).toBeCloseTo(0, 6);
  });
});

const sketch = (
  entities: SketchEntity[],
  constraints: SketchConstraint[] = [],
): SketchFeature => ({
  id: "sk",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities,
  constraints,
});

const validate = (f: SketchFeature) => () => featureSpec("sketch")!.validate(f);

const swap = (entities: SketchEntity[], id: string, change: object) =>
  entities.map((x) =>
    x.id === id ? ({ ...x, ...change } as SketchEntity) : x,
  );

describe("spline validation", () => {
  it("accepts fit splines, conics and tangents at shared ends", () => {
    expect(validate(sketch(fitEntities(), [tangent("fs", "l")]))).not.toThrow();
    expect(
      validate(sketch(conicEntities(0.6), [tangent("ml", "cn")])),
    ).not.toThrow();
  });

  it("refuses malformed and degenerate splines without changing them", () => {
    const cases: [SketchEntity[], RegExp][] = [
      [swap(fitEntities(), "f1", { x: 0, y: 0 }), /fit points/],
      [swap(fitEntities(), "h0", { x: 0, y: 0 }), /handle/],
      [swap(fitEntities(), "fs", { points: ["f0"] }), /two fit points/],
      [
        swap(fitEntities(), "fs", { handles: ["h0", "gone"] }),
        /Missing endpoint/,
      ],
      [swap(conicEntities(0.5), "cn", { rho: 1 }), /rho/],
      [swap(conicEntities(0.5), "cn", { rho: -0.2 }), /rho/],
      [swap(conicEntities(0.5), "cn", { weights: [1, 1, 1] }), /rho/],
      [swap(conicEntities(0.5), "cn", { degree: 3 }), /rho/],
      [swap(conicEntities(0.5), "ca", { x: 7, y: 0 }), /apex/],
    ];
    for (const [entities, error] of cases) {
      const f = sketch(entities);
      const before = structuredClone(f);
      expect(validate(f)).toThrow(error);
      expect(f).toEqual(before);
    }
  });

  it("refuses a tangent without a shared end and other relations on the curve", () => {
    const apart = [...swap(fitEntities(), "l", { p2: "l2" }), P("l2", -20, 9)];
    expect(validate(sketch(apart, [tangent("fs", "l")]))).toThrow(/shared end/);
    expect(
      validate(
        sketch(fitEntities(), [{ id: "e", type: "equal", a: "fs", b: "l" }]),
      ),
    ).toThrow(/fitSpline fs/);
    expect(
      validate(
        sketch(fitEntities(), [
          { id: "c", type: "pointOnCircle", point: "l1", circle: "fs" },
        ]),
      ),
    ).toThrow(/fitSpline fs/);
  });
});
