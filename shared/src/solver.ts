/**
 * Parametric sketch constraint solver.
 *
 * Approach: every constraint contributes one or more residual functions
 * r_i(x) where x is the vector of free sketch variables (point coordinates
 * and circle radii). We minimise Σ r_i² with Levenberg–Marquardt using a
 * numeric Jacobian. Constraint satisfaction ⇔ all residuals ≈ 0.
 *
 * Degrees of freedom are reported from the rank of the Jacobian at the
 * solution: dof = numVars − rank(J).
 *
 * This module is dependency-free and runs identically in the browser
 * (interactive dragging) and on the server (authoritative regeneration).
 */

import type {
  SketchArc,
  SketchCircle,
  SketchConstraint,
  SketchEntity,
  SketchLine,
  SketchPoint,
  SketchSolveStatus,
} from "./model.js";

export interface SolveInput {
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  /**
   * Optional drag target: pulls a point toward (x, y) with a weak residual
   * so the sketch follows the mouse while hard constraints hold.
   */
  drag?: { pointId: string; x: number; y: number };
}

export interface SolveResult {
  /** Entities with updated point coordinates / radii. Same order as input. */
  entities: SketchEntity[];
  status: SketchSolveStatus;
  /** Remaining degrees of freedom (0 when fully constrained). */
  dof: number;
  /** True when all constraint residuals converged below tolerance. */
  converged: boolean;
  /** Max absolute residual after solving (mm / rad scale). */
  maxResidual: number;
}

const CONV_TOL = 1e-8;
const CONFLICT_TOL = 1e-4;
const MAX_ITER = 120;
const DRAG_WEIGHT = 0.02;

type Residual = (x: Float64Array) => number;

interface Problem {
  x0: Float64Array;
  residuals: Residual[];
  /** residuals contributed by real constraints (excludes drag pulls) */
  hardCount: number;
  apply: (x: Float64Array, entities: SketchEntity[]) => void;
  numVars: number;
}

function buildProblem(input: SolveInput): Problem {
  const points = new Map<string, SketchPoint>();
  const lines = new Map<string, SketchLine>();
  const circles = new Map<string, SketchCircle>();
  const arcs = new Map<string, SketchArc>();
  for (const e of input.entities) {
    if (e.kind === "point") points.set(e.id, e);
    else if (e.kind === "line") lines.set(e.id, e);
    else if (e.kind === "circle") circles.set(e.id, e);
    else if (e.kind === "arc") arcs.set(e.id, e);
  }

  const fixedPoints = new Set<string>();
  for (const c of input.constraints) {
    if (c.type === "fix") fixedPoints.add(c.point);
  }
  for (const p of points.values()) {
    if (p.external) fixedPoints.add(p.id);
  }

  // Variable layout
  const vars: number[] = [];
  const pointVarIndex = new Map<string, number>(); // -1 → fixed
  const radiusVarIndex = new Map<string, number>();
  for (const p of points.values()) {
    if (fixedPoints.has(p.id)) {
      pointVarIndex.set(p.id, -1);
    } else {
      pointVarIndex.set(p.id, vars.length);
      vars.push(p.x, p.y);
    }
  }
  for (const c of circles.values()) {
    if (c.external) {
      radiusVarIndex.set(c.id, -1);
    } else {
      radiusVarIndex.set(c.id, vars.length);
      vars.push(c.radius);
    }
  }

  const px = (id: string) => {
    const p = points.get(id);
    if (!p) throw new SolverModelError(`unknown point ${id}`);
    const vi = pointVarIndex.get(id)!;
    if (vi < 0) {
      const fx = p.x;
      return () => fx;
    }
    return (x: Float64Array) => x[vi]!;
  };
  const py = (id: string) => {
    const p = points.get(id)!;
    const vi = pointVarIndex.get(id)!;
    if (vi < 0) {
      const fy = p.y;
      return () => fy;
    }
    return (x: Float64Array) => x[vi + 1]!;
  };
  const radius = (id: string) => {
    const c = circles.get(id);
    if (c) {
      const vi = radiusVarIndex.get(id)!;
      if (vi < 0) {
        const r = c.radius;
        return () => r;
      }
      return (x: Float64Array) => x[vi]!;
    }
    const a = arcs.get(id);
    if (a) {
      // Arc radius derived from center–start distance.
      const cx = px(a.center),
        cy = py(a.center),
        sx = px(a.start),
        sy = py(a.start);
      return (x: Float64Array) => Math.hypot(sx(x) - cx(x), sy(x) - cy(x));
    }
    throw new SolverModelError(`entity ${id} has no radius`);
  };

  /** Center accessor for circle or arc. */
  const centerOf = (id: string): { cx: Residual; cy: Residual } => {
    const c = circles.get(id) ?? arcs.get(id);
    if (!c) throw new SolverModelError(`entity ${id} is not a circle/arc`);
    const centerId = c.kind === "circle" ? c.center : c.center;
    return { cx: px(centerId), cy: py(centerId) };
  };

  const lineEnds = (id: string) => {
    const l = lines.get(id);
    if (!l) throw new SolverModelError(`unknown line ${id}`);
    return { x1: px(l.p1), y1: py(l.p1), x2: px(l.p2), y2: py(l.p2) };
  };

  const residuals: Residual[] = [];

  // Implicit residual: arc start & end are equidistant from center.
  for (const a of arcs.values()) {
    const cx = px(a.center),
      cy = py(a.center);
    const sx = px(a.start),
      sy = py(a.start);
    const ex = px(a.end),
      ey = py(a.end);
    residuals.push(
      (x) =>
        Math.hypot(sx(x) - cx(x), sy(x) - cy(x)) -
        Math.hypot(ex(x) - cx(x), ey(x) - cy(x)),
    );
  }

  for (const c of input.constraints) {
    switch (c.type) {
      case "fix":
        break; // handled via variable pinning
      case "coincident": {
        const ax = px(c.a),
          ay = py(c.a),
          bx = px(c.b),
          by = py(c.b);
        residuals.push((x) => ax(x) - bx(x));
        residuals.push((x) => ay(x) - by(x));
        break;
      }
      case "horizontal": {
        const { y1, y2 } = lineEnds(c.line);
        residuals.push((x) => y2(x) - y1(x));
        break;
      }
      case "vertical": {
        const { x1, x2 } = lineEnds(c.line);
        residuals.push((x) => x2(x) - x1(x));
        break;
      }
      case "parallel": {
        const a = lineEnds(c.a),
          b = lineEnds(c.b);
        residuals.push((x) => {
          const dax = a.x2(x) - a.x1(x),
            day = a.y2(x) - a.y1(x);
          const dbx = b.x2(x) - b.x1(x),
            dby = b.y2(x) - b.y1(x);
          const la = Math.hypot(dax, day) || 1,
            lb = Math.hypot(dbx, dby) || 1;
          return (dax * dby - day * dbx) / (la * lb);
        });
        break;
      }
      case "perpendicular": {
        const a = lineEnds(c.a),
          b = lineEnds(c.b);
        residuals.push((x) => {
          const dax = a.x2(x) - a.x1(x),
            day = a.y2(x) - a.y1(x);
          const dbx = b.x2(x) - b.x1(x),
            dby = b.y2(x) - b.y1(x);
          const la = Math.hypot(dax, day) || 1,
            lb = Math.hypot(dbx, dby) || 1;
          return (dax * dbx + day * dby) / (la * lb);
        });
        break;
      }
      case "tangent": {
        // line–circle/arc or circle–circle
        const lineId = lines.has(c.a) ? c.a : lines.has(c.b) ? c.b : null;
        const circId = lines.has(c.a) ? c.b : c.a;
        if (lineId) {
          const offset = lineOffset(lineEnds(lineId));
          const { cx, cy } = centerOf(circId);
          const r = radius(circId);
          residuals.push((x) => Math.abs(offset(x, cx(x), cy(x))) - r(x));
        } else {
          const A = centerOf(c.a),
            B = centerOf(c.b);
          const ra = radius(c.a),
            rb = radius(c.b);
          // Branch (external/internal tangency) chosen from initial config.
          residuals.push((x) => {
            const d = Math.hypot(B.cx(x) - A.cx(x), B.cy(x) - A.cy(x));
            const ext = Math.abs(d - (ra(x) + rb(x)));
            const internal = Math.abs(d - Math.abs(ra(x) - rb(x)));
            return ext <= internal
              ? d - (ra(x) + rb(x))
              : d - Math.abs(ra(x) - rb(x));
          });
        }
        break;
      }
      case "concentric": {
        const A = centerOf(c.a),
          B = centerOf(c.b);
        residuals.push((x) => A.cx(x) - B.cx(x));
        residuals.push((x) => A.cy(x) - B.cy(x));
        break;
      }
      case "equal": {
        const bothLines = lines.has(c.a) && lines.has(c.b);
        if (bothLines) {
          const a = lineEnds(c.a),
            b = lineEnds(c.b);
          residuals.push(
            (x) =>
              Math.hypot(a.x2(x) - a.x1(x), a.y2(x) - a.y1(x)) -
              Math.hypot(b.x2(x) - b.x1(x), b.y2(x) - b.y1(x)),
          );
        } else {
          const ra = radius(c.a),
            rb = radius(c.b);
          residuals.push((x) => ra(x) - rb(x));
        }
        break;
      }
      case "midpoint": {
        const p = { x: px(c.point), y: py(c.point) };
        const l = lineEnds(c.line);
        residuals.push((x) => p.x(x) - (l.x1(x) + l.x2(x)) / 2);
        residuals.push((x) => p.y(x) - (l.y1(x) + l.y2(x)) / 2);
        break;
      }
      case "collinear": {
        const offset = lineOffset(lineEnds(c.a));
        const b = lineEnds(c.b);
        residuals.push((x) => offset(x, b.x1(x), b.y1(x)));
        residuals.push((x) => offset(x, b.x2(x), b.y2(x)));
        break;
      }
      case "pointOnLine": {
        const offset = lineOffset(lineEnds(c.line));
        const p = { x: px(c.point), y: py(c.point) };
        residuals.push((x) => offset(x, p.x(x), p.y(x)));
        break;
      }
      case "pointLineDistance": {
        const offset = lineOffset(lineEnds(c.line));
        const p = { x: px(c.point), y: py(c.point) };
        const v = c.value;
        residuals.push((x) => Math.abs(offset(x, p.x(x), p.y(x))) - v);
        break;
      }
      case "lineDistance": {
        const offset = lineOffset(lineEnds(c.a));
        const b = lineEnds(c.b);
        const v = c.value;
        residuals.push((x) => Math.abs(offset(x, b.x1(x), b.y1(x))) - v);
        residuals.push(
          (x) => offset(x, b.x2(x), b.y2(x)) - offset(x, b.x1(x), b.y1(x)),
        );
        break;
      }
      case "pointOnCircle": {
        const p = { x: px(c.point), y: py(c.point) };
        const { cx, cy } = centerOf(c.circle);
        const r = radius(c.circle);
        residuals.push(
          (x) => Math.hypot(p.x(x) - cx(x), p.y(x) - cy(x)) - r(x),
        );
        break;
      }
      case "distance": {
        const ax = px(c.a),
          ay = py(c.a),
          bx = px(c.b),
          by = py(c.b);
        const v = c.value;
        if (c.axis === "x") {
          residuals.push((x) => Math.abs(bx(x) - ax(x)) - v);
        } else if (c.axis === "y") {
          residuals.push((x) => Math.abs(by(x) - ay(x)) - v);
        } else {
          residuals.push((x) => Math.hypot(bx(x) - ax(x), by(x) - ay(x)) - v);
        }
        break;
      }
      case "length": {
        const l = lineEnds(c.line);
        const v = c.value;
        residuals.push(
          (x) => Math.hypot(l.x2(x) - l.x1(x), l.y2(x) - l.y1(x)) - v,
        );
        break;
      }
      case "lineAngle": {
        const l = lineEnds(c.line);
        const v = ((c.value + (c.axis === "y" ? 90 : 0)) * Math.PI) / 180;
        const ux = Math.cos(v),
          uy = Math.sin(v);
        residuals.push((x) => {
          const dx = l.x2(x) - l.x1(x),
            dy = l.y2(x) - l.y1(x);
          return Math.atan2(ux * dy - uy * dx, ux * dx + uy * dy);
        });
        break;
      }
      case "radius": {
        const r = radius(c.entity);
        const v = c.value;
        residuals.push((x) => r(x) - v);
        break;
      }
      case "diameter": {
        const r = radius(c.entity);
        const v = c.value;
        residuals.push((x) => 2 * r(x) - v);
        break;
      }
      case "angle": {
        const a = lineEnds(c.a),
          b = lineEnds(c.b);
        const v = (c.value * Math.PI) / 180;
        residuals.push((x) => {
          const dax = a.x2(x) - a.x1(x),
            day = a.y2(x) - a.y1(x);
          const dbx = b.x2(x) - b.x1(x),
            dby = b.y2(x) - b.y1(x);
          const dot = dax * dbx + day * dby;
          const cross = dax * dby - day * dbx;
          return Math.atan2(Math.abs(cross), dot) - v;
        });
        break;
      }
    }
  }

  const hardCount = residuals.length;

  if (input.drag) {
    const vi = pointVarIndex.get(input.drag.pointId);
    if (vi !== undefined && vi >= 0) {
      const { x: tx, y: ty } = { x: input.drag.x, y: input.drag.y };
      residuals.push((x) => DRAG_WEIGHT * (x[vi]! - tx));
      residuals.push((x) => DRAG_WEIGHT * (x[vi + 1]! - ty));
    }
  }

  const apply = (x: Float64Array, entities: SketchEntity[]) => {
    for (const e of entities) {
      if (e.kind === "point") {
        const vi = pointVarIndex.get(e.id)!;
        if (vi >= 0) {
          e.x = x[vi]!;
          e.y = x[vi + 1]!;
        }
      } else if (e.kind === "circle") {
        const vi = radiusVarIndex.get(e.id)!;
        if (vi >= 0) e.radius = Math.abs(x[vi]!);
      }
    }
  };

  return {
    x0: Float64Array.from(vars),
    residuals,
    hardCount,
    apply,
    numVars: vars.length,
  };
}

function lineOffset(l: {
  x1: Residual;
  y1: Residual;
  x2: Residual;
  y2: Residual;
}) {
  return (x: Float64Array, ptx: number, pty: number) => {
    const dx = l.x2(x) - l.x1(x),
      dy = l.y2(x) - l.y1(x);
    const len = Math.hypot(dx, dy) || 1;
    return (dx * (pty - l.y1(x)) - dy * (ptx - l.x1(x))) / len;
  };
}

export class SolverModelError extends Error {}

function evalResiduals(res: Residual[], x: Float64Array): Float64Array {
  const out = new Float64Array(res.length);
  for (let i = 0; i < res.length; i++) out[i] = res[i]!(x);
  return out;
}

function checkLength(values: { length: number }, length: number): void {
  if (values.length !== length) {
    throw new RangeError(`expected length ${length}, got ${values.length}`);
  }
}

function numericJacobian(
  res: Residual[],
  x: Float64Array,
  r0: Float64Array,
): Float64Array[] {
  checkLength(r0, res.length);
  const m = res.length;
  const n = x.length;
  const J: Float64Array[] = [];
  for (let i = 0; i < m; i++) J.push(new Float64Array(n));
  const xp = Float64Array.from(x);
  for (let j = 0; j < n; j++) {
    const h = 1e-6 * Math.max(1, Math.abs(x[j]!));
    xp[j] = x[j]! + h;
    for (let i = 0; i < m; i++) {
      J[i]![j] = (res[i]!(xp) - r0[i]!) / h;
    }
    xp[j] = x[j]!;
  }
  return J;
}

/** Solve (A + λ·diag(A)) dx = b with Gaussian elimination (A = JᵀJ, b = −Jᵀr). */
function solveNormal(
  J: Float64Array[],
  r: Float64Array,
  lambda: number,
  n: number,
): Float64Array | null {
  checkLength(r, J.length);
  for (const row of J) checkLength(row, n);
  // Build A = JᵀJ and g = Jᵀr
  const A: Float64Array[] = [];
  for (let i = 0; i < n; i++) A.push(new Float64Array(n + 1));
  for (const [ri, row] of J.entries()) {
    for (let a = 0; a < n; a++) {
      if (row[a] === 0) continue;
      for (let b = a; b < n; b++) {
        A[a]![b]! += row[a]! * row[b]!;
      }
      A[a]![n]! -= row[a]! * r[ri]!;
    }
  }
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < a; b++) A[a]![b] = A[b]![a]!;
    A[a]![a]! *= 1 + lambda;
    A[a]![a]! += 1e-12;
  }
  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row]![col]!) > Math.abs(A[piv]![col]!)) piv = row;
    }
    if (Math.abs(A[piv]![col]!) < 1e-14) continue;
    if (piv !== col) {
      const t = A[piv]!;
      A[piv] = A[col]!;
      A[col] = t;
    }
    const d = A[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      const f = A[row]![col]! / d;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) A[row]![k]! -= f * A[col]![k]!;
    }
  }
  const dx = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let s = A[row]![n]!;
    for (let k = row + 1; k < n; k++) s -= A[row]![k]! * dx[k]!;
    dx[row] = Math.abs(A[row]![row]!) < 1e-14 ? 0 : s / A[row]![row]!;
  }
  return dx;
}

/** Rank of the Jacobian via row-echelon elimination with a tolerance. */
function jacobianRank(J: Float64Array[], n: number): number {
  for (const row of J) checkLength(row, n);
  const rows = J.map((r) => Float64Array.from(r));
  let rank = 0;
  let col = 0;
  const tol = 1e-7;
  while (rank < rows.length && col < n) {
    let piv = -1;
    let best = tol;
    for (let r = rank; r < rows.length; r++) {
      const v = Math.abs(rows[r]![col]!);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (piv < 0) {
      col++;
      continue;
    }
    const t = rows[piv]!;
    rows[piv] = rows[rank]!;
    rows[rank] = t;
    const d = rows[rank]![col]!;
    for (let r = rank + 1; r < rows.length; r++) {
      const f = rows[r]![col]! / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) rows[r]![k]! -= f * rows[rank]![k]!;
    }
    rank++;
    col++;
  }
  return rank;
}

function runLM(
  residuals: Residual[],
  xStart: Float64Array,
  numVars: number,
): { x: Float64Array; r: Float64Array } {
  checkLength(xStart, numVars);
  let x = Float64Array.from(xStart);
  let r = evalResiduals(residuals, x);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let lambda = 1e-3;

  if (numVars > 0 && residuals.length > 0) {
    for (let iter = 0; iter < MAX_ITER; iter++) {
      if (Math.sqrt(cost) < CONV_TOL) break;
      const J = numericJacobian(residuals, x, r);
      const dx = solveNormal(J, r, lambda, numVars);
      if (!dx) break;
      const xNew = Float64Array.from(x);
      for (const [j, dj] of dx.entries()) xNew[j]! += dj;
      const rNew = evalResiduals(residuals, xNew);
      const costNew = rNew.reduce((s, v) => s + v * v, 0);
      if (costNew < cost) {
        x = xNew;
        r = rNew;
        cost = costNew;
        lambda = Math.max(lambda * 0.4, 1e-9);
        const step = Math.sqrt(dx.reduce((s, v) => s + v * v, 0));
        if (step < 1e-12) break;
      } else {
        lambda *= 5;
        if (lambda > 1e10) break;
      }
    }
  }
  return { x, r };
}

export function solveSketch(input: SolveInput): SolveResult {
  const entities: SketchEntity[] = input.entities.map((e) => ({ ...e }));
  const problem = buildProblem({ ...input, entities });
  const { residuals, x0, numVars, hardCount } = problem;

  let { x } = runLM(residuals, x0, numVars);

  // Drag pulls are soft; polish with hard constraints only so the final
  // configuration satisfies constraints exactly.
  const hard = residuals.slice(0, hardCount);
  if (residuals.length > hardCount) {
    ({ x } = runLM(hard, x, numVars));
  }
  const r = evalResiduals(hard, x);

  problem.apply(x, entities);

  let maxResidual = 0;
  for (const v of r) maxResidual = Math.max(maxResidual, Math.abs(v));
  const converged = maxResidual < CONFLICT_TOL;

  // DOF analysis at the solution (hard constraints only).
  let dof = numVars;
  if (numVars > 0 && hardCount > 0) {
    const Jh = numericJacobian(hard, x, r);
    dof = numVars - jacobianRank(Jh, numVars);
  }

  let status: SketchSolveStatus;
  if (!converged) status = "over_constrained";
  else if (dof === 0)
    status =
      numVars === 0 && hardCount === 0 && input.entities.length === 0
        ? "unconstrained"
        : "fully_constrained";
  else if (hardCount === 0 && !input.constraints.some((c) => c.type === "fix"))
    status = "unconstrained";
  else status = "partially_constrained";

  return { entities, status, dof, converged, maxResidual };
}
