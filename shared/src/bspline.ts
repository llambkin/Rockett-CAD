import { ARC_SEGMENTS, least } from "./curveSampling.js";
import type { SketchFitSpline, SketchPoint, SketchSpline } from "./model.js";
import type { XY } from "./sketchCurves.js";
import { LINEAR_TOL } from "./tolerance.js";

export type BSpline = {
  degree: number;
  poles: XY[];
  weights?: number[];
  knots: number[];
  multiplicities: number[];
  periodic?: boolean;
};

export type Spline = BSpline & { id: string; kind: "spline" };

const MAX_DEGREE = 25;
const PERIOD_TOL = 1e-9;

const whole = (v: number, lo: number, hi: number) =>
  Number.isInteger(v) && v >= lo && v <= hi;
const mod = (i: number, n: number) => ((i % n) + n) % n;

const degreeProblem = (p: number) =>
  whole(p, 1, MAX_DEGREE)
    ? undefined
    : `degree must be a whole number from 1 to ${MAX_DEGREE}`;

export function bsplineProblem(s: BSpline): string | undefined {
  const { degree: p, poles, weights, knots, multiplicities: m } = s;
  if (degreeProblem(p)) return degreeProblem(p);
  if (knots.length < 2) return "needs at least two knots";
  if (m.length !== knots.length) return "needs one multiplicity per knot";
  if (
    !knots.every((k, i) => Number.isFinite(k) && (i === 0 || k > knots[i - 1]!))
  )
    return "knots must be finite and strictly increasing";
  const end = s.periodic ? p : p + 1;
  const inner = (i: number) => i > 0 && i < m.length - 1;
  if (!m.every((v, i) => whole(v, 1, inner(i) ? p : end)))
    return `multiplicities must be whole numbers from 1 to ${p} inside and ${end} at the ends`;
  if (s.periodic && m[0] !== m.at(-1))
    return "a periodic spline needs equal end multiplicities";
  if (!s.periodic && (m[0] !== end || m.at(-1) !== end))
    return `an open spline must be clamped: end multiplicities must be ${end}`;
  const count = m.reduce((a, b) => a + b, 0) - (s.periodic ? m.at(-1)! : p + 1);
  if (poles.length !== count || count < 2)
    return `needs ${count} poles, got ${poles.length}`;
  if (!poles.every((pole) => pole.length === 2 && pole.every(Number.isFinite)))
    return "poles must be finite x, y pairs";
  if (
    weights &&
    (weights.length !== count ||
      !weights.every((w) => Number.isFinite(w) && w > 0))
  )
    return "needs one positive weight per pole";
  return undefined;
}

function frame(s: BSpline) {
  const n = s.poles.length;
  const flat = s.knots.flatMap((k, i) =>
    Array<number>(s.multiplicities[i]!).fill(k),
  );
  const [first, last] = [s.knots[0]!, s.knots.at(-1)!];
  if (!s.periodic)
    return {
      knot: (j: number) => flat[j]!,
      pole: (i: number) => i,
      lo: s.degree,
      at: (u: number) => Math.min(last, Math.max(first, u)),
    };
  const period = last - first;
  return {
    knot: (j: number) => flat[mod(j, n)]! + period * Math.floor(j / n),
    pole: (i: number) => mod(i + s.degree + 1 - s.multiplicities[0]!, n),
    lo: 0,
    at: (u: number) => first + mod(u - first, period),
  };
}

export function bsplinePoint(s: BSpline, u: number): XY {
  const p = s.degree;
  const { knot, pole, lo, at } = frame(s);
  const t = at(u);
  let span = lo;
  while (span < s.poles.length - 1 && knot(span + 1) <= t) span++;
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const i = pole(span - p + j);
    const w = s.weights?.[i] ?? 1;
    const [x, y] = s.poles[i]!;
    return [x * w, y * w, w];
  });
  for (let r = 1; r <= p; r++)
    for (let j = p; j >= r; j--) {
      const i = span - p + j;
      const a = (t - knot(i)) / (knot(i + p + 1 - r) - knot(i));
      d[j] = d[j]!.map((v, c) => (1 - a) * d[j - 1]![c]! + a * v);
    }
  const [x, y, w] = d[p]!;
  return [x! / w!, y! / w!];
}

export function endDerivatives(s: BSpline, atStart: boolean): [XY, XY] {
  const p = s.degree;
  const flat = s.knots.flatMap((k, i) =>
    Array<number>(s.multiplicities[i]!).fill(k),
  );
  const order = <T>(v: T[]) => (atStart ? v : v.toReversed());
  const t = atStart ? flat : flat.map((k) => -k).toReversed();
  const poles = order(s.poles);
  const w = order(s.weights ?? s.poles.map(() => 1));
  const H = (i: number) => [w[i]! * poles[i]![0], w[i]! * poles[i]![1], w[i]!];
  const step = (i: number, f: number) =>
    H(i + 1).map((v, c) => (f * (v - H(i)[c]!)) / (t[i + p + 1]! - t[i + 1]!));
  const d1 = step(0, p);
  const d2 =
    p < 2
      ? [0, 0, 0]
      : step(1, p).map(
          (v, c) => ((p - 1) * (v - d1[c]!)) / (t[p + 1]! - t[2]!),
        );
  const [x, y, w0] = H(0) as [number, number, number];
  const c1 = [0, 1].map((c) => (d1[c]! - (d1[2]! * [x, y][c]!) / w0) / w0);
  const c2 = [0, 1].map(
    (c) => (d2[c]! - 2 * d1[2]! * c1[c]! - (d2[2]! * [x, y][c]!) / w0) / w0,
  );
  return [c1, c2] as [XY, XY];
}

export function bsplineParams(s: BSpline, segments: number): number[] {
  const out = [s.knots[0]!];
  for (let i = 1; i < s.knots.length; i++) {
    const [a, b] = [s.knots[i - 1]!, s.knots[i]!];
    for (let j = 1; j <= segments; j++) out.push(a + ((b - a) * j) / segments);
  }
  return out;
}

export function sampleBSpline(s: BSpline, segments = ARC_SEGMENTS): number[] {
  return bsplineParams(s, segments).flatMap((u) => bsplinePoint(s, u));
}

export function bsplineDistance(s: BSpline, x: number, y: number): number {
  const us = bsplineParams(s, ARC_SEGMENTS);
  const gap = (u: number) => {
    const [px, py] = bsplinePoint(s, u);
    return Math.hypot(px - x, py - y);
  };
  const gaps = us.map(gap);
  const best = gaps.indexOf(Math.min(...gaps));
  const period = us.at(-1)! - us[0]!;
  const lo = us[best - 1] ?? (s.periodic ? us.at(-2)! - period : us[0]!);
  const hi = us[best + 1] ?? (s.periodic ? us[1]! + period : us.at(-1)!);
  return Math.min(gaps[best]!, gap(least(gap, lo, hi)));
}

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const apart = (a: XY, b: XY) => Math.hypot(...sub(a, b)) > LINEAR_TOL;

function basisAt(flat: number[], span: number, p: number, u: number) {
  const n = [1];
  const [left, right] = [[0], [0]];
  for (let j = 1; j <= p; j++) {
    left[j] = u - flat[span + 1 - j]!;
    right[j] = flat[span + j]! - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const t = n[r]! / (right[r + 1]! + left[j - r]!);
      n[r] = saved + right[r + 1]! * t;
      saved = left[j - r]! * t;
    }
    n[j] = saved;
  }
  return n;
}

const known = (w: number, h: XY, at: boolean): XY =>
  at ? [w * h[0], w * h[1]] : [0, 0];

export function interpolateFit(
  fit: XY[],
  [h0, h1]: [XY, XY],
): BSpline | string {
  const n = fit.length - 1;
  if (n < 1) return "needs at least two fit points";
  if (!fit.slice(1).every((q, k) => apart(q, fit[k]!)))
    return "fit points must be apart from their neighbours";
  if (!apart(h0, fit[0]!) || !apart(h1, fit[n]!))
    return "each tangent handle must be apart from its end";
  const chords = fit.slice(1).map((q, k) => Math.hypot(...sub(q, fit[k]!)));
  const total = chords.reduce((a, b) => a + b, 0);
  const u = [0];
  for (const d of chords) u.push(u.at(-1)! + d / total);
  u[n] = 1;
  const flat = [0, 0, 0, 0, ...u.slice(1, -1), 1, 1, 1, 1];
  const rows = u.slice(1, -1).map((uk, i) => {
    const [a, b, c] = basisAt(flat, i + 4, 3, uk) as [number, number, number];
    const [k0, k1] = [known(a, h0, i === 0), known(c, h1, i === n - 2)];
    const q = fit[i + 1]!;
    return { a, b, c, r: [q[0] - k0[0] - k1[0], q[1] - k0[1] - k1[1]] as XY };
  });
  for (let i = 1; i < rows.length; i++) {
    const [row, prev] = [rows[i]!, rows[i - 1]!];
    const f = row.a / prev.b;
    row.b -= f * prev.c;
    row.r = [row.r[0] - f * prev.r[0], row.r[1] - f * prev.r[1]];
  }
  const inner: XY[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const { b, c, r } = rows[i]!;
    const next = inner[0] ?? [0, 0];
    inner.unshift([(r[0] - c * next[0]) / b, (r[1] - c * next[1]) / b]);
  }
  return {
    degree: 3,
    poles: [fit[0]!, h0, ...inner, h1, fit[n]!],
    knots: u,
    multiplicities: u.map((_, i) => (i === 0 || i === n ? 4 : 1)),
  };
}

export function conicSpline(
  start: XY,
  apex: XY,
  end: XY,
  rho: number,
): BSpline | string {
  if (!(rho > 0 && rho < 1)) return "rho must be between 0 and 1";
  if (!apart(start, end)) return "a conic needs two different ends";
  const [c, a] = [sub(end, start), sub(apex, start)];
  if (!(Math.abs(c[0] * a[1] - c[1] * a[0]) / Math.hypot(...c) > LINEAR_TOL))
    return "a conic needs an apex off the line between its ends";
  return {
    degree: 2,
    poles: [start, apex, end],
    weights: [1, rho / (1 - rho), 1],
    knots: [0, 1],
    multiplicities: [3, 3],
  };
}

const CONIC_SHAPE =
  "rho needs a single-span degree 2 spline over three poles with no weights";

const conicShaped = (e: SketchSpline) =>
  !e.weights &&
  !e.periodic &&
  e.degree === 2 &&
  e.poles.length === 3 &&
  e.knots.length === 2 &&
  e.multiplicities.every((m) => m === 3);

function derived(
  e: SketchSpline | SketchFitSpline,
  points: ReadonlyMap<string, SketchPoint>,
): BSpline | string | undefined {
  const at = (ids: string[]) => {
    const found = ids.map((id) => points.get(id));
    return found.every((p) => p !== undefined)
      ? found.map((p): XY => [p.x, p.y])
      : undefined;
  };
  if (e.kind === "fitSpline") {
    const [fit, ends] = [at(e.points), at(e.handles)];
    return fit && ends && interpolateFit(fit, ends as [XY, XY]);
  }
  const poles = at(e.poles);
  if (!poles) return undefined;
  if (e.rho === undefined) {
    const { degree, weights, knots, multiplicities, periodic } = e;
    return {
      degree,
      poles,
      ...(weights && { weights }),
      knots,
      multiplicities,
      ...(periodic && { periodic }),
    };
  }
  if (!conicShaped(e)) return CONIC_SHAPE;
  const [s, a, end] = poles as [XY, XY, XY];
  const conic = conicSpline(s, a, end, e.rho);
  if (typeof conic === "string") return conic;
  const [k0, k1] = e.knots as [number, number];
  return { ...conic, knots: [k0, k1] };
}

export function splineCurve(
  e: SketchSpline | SketchFitSpline,
  points: ReadonlyMap<string, SketchPoint>,
): Spline[] {
  const s = derived(e, points);
  return s && typeof s !== "string" ? [{ id: e.id, kind: "spline", ...s }] : [];
}

export function splineProblem(
  e: SketchSpline | SketchFitSpline,
  points: ReadonlyMap<string, SketchPoint>,
): string | undefined {
  const s = derived(e, points);
  return typeof s === "string" ? s : s && bsplineProblem(s);
}

function runs(values: number[]): [number[], number[]] {
  const knots: number[] = [];
  const mults: number[] = [];
  for (const v of values) {
    if (v === knots.at(-1)) mults[mults.length - 1]!++;
    else {
      knots.push(v);
      mults.push(1);
    }
  }
  return [knots, mults];
}

const near = (a: number, b: number, tol: number) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a));

export function bsplineFromFlat(
  degree: number,
  poles: XY[],
  weights: number[] | undefined,
  flat: number[],
): BSpline | string {
  const p = degree;
  if (degreeProblem(p)) return degreeProblem(p)!;
  const size = poles.length + p + 1;
  if (flat.length !== size)
    return `needs ${size} knots for ${poles.length} poles of degree ${p}, got ${flat.length}`;
  if (flat.some((k, i) => i > 0 && !(k >= flat[i - 1]!)))
    return "knots must not decrease";
  if (weights && weights.length !== poles.length)
    return "needs one weight per pole";
  const clamped =
    flat.slice(0, p + 1).every((k) => k === flat[0]) &&
    flat.slice(-p - 1).every((k) => k === flat.at(-1));
  const spline = clamped
    ? clampedForm(p, poles, weights, flat)
    : periodicForm(p, poles, weights, flat);
  return typeof spline === "string"
    ? spline
    : (bsplineProblem(spline) ?? spline);
}

function clampedForm(
  p: number,
  poles: XY[],
  weights: number[] | undefined,
  flat: number[],
) {
  const [knots, multiplicities] = runs(flat);
  return {
    degree: p,
    poles,
    ...(weights && { weights }),
    knots,
    multiplicities,
  };
}

function periodicForm(
  p: number,
  poles: XY[],
  weights: number[] | undefined,
  flat: number[],
): BSpline | string {
  const n = poles.length - p;
  const period = flat[p + n]! - flat[p]!;
  const repeats =
    n > 1 &&
    poles.slice(n).every(([x, y], j) => {
      const [x0, y0] = poles[j]!;
      return Math.hypot(x - x0, y - y0) <= LINEAR_TOL;
    }) &&
    (weights ?? [])
      .slice(n)
      .every((w, j) => near(w, weights![j]!, PERIOD_TOL)) &&
    flat.slice(n).every((k, i) => near(k - flat[i]!, period, PERIOD_TOL));
  if (!repeats)
    return "an open spline must be clamped; only a closed one whose last poles repeat its first converts to periodic";
  const [knots, mults] = runs(flat.slice(p, p + n + 1));
  const front = mults[0]!;
  mults[0] = mults[mults.length - 1] = front + mults.at(-1)! - 1;
  const shift = (j: number) => (j + front - 1) % n;
  return {
    degree: p,
    poles: poles.slice(0, n).map((_, j) => poles[shift(j)]!),
    ...(weights && {
      weights: weights.slice(0, n).map((_, j) => weights[shift(j)]!),
    }),
    knots,
    multiplicities: mults,
    periodic: true,
  };
}
