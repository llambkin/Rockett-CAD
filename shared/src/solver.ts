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
import { OverConstrainedError } from "./solverError.js";
export { OverConstrainedError } from "./solverError.js";
import { arcRadiusGap, axisCosine, entityPointIds } from "./sketchCurves.js";
import {
  dampingFloor,
  evalResiduals,
  jacobianRank,
  leastSquares,
  numericJacobian,
  type Block,
  type Residual,
} from "./leastSquares.js";

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

const CONFLICT_TOL = 1e-4;
const DRAG_WEIGHT = 0.02;

interface Problem {
  x0: Float64Array;
  residuals: Residual[];
  deps: number[][];
  refs: Set<string>;
  /** residuals contributed by real constraints (excludes drag pulls) */
  hardCount: number;
  varsOf: (id: string) => number[];
  apply: (x: Float64Array, entities: SketchEntity[]) => void;
  numVars: number;
}

function layout(input: SolveInput) {
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
  const varsOf = (id: string): number[] => {
    const p = pointVarIndex.get(id) ?? -1;
    if (p >= 0) return [p, p + 1];
    const r = radiusVarIndex.get(id) ?? -1;
    return r >= 0 ? [r] : [];
  };
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
    points,
    lines,
    circles,
    arcs,
    vars,
    pointVarIndex,
    radiusVarIndex,
    varsOf,
    apply,
  };
}

const pointAt = ([fx, fy]: Residual[], x: Float64Array) => ({
  x: fx!(x),
  y: fy!(x),
});

function buildProblem(input: SolveInput): Problem {
  const space = layout(input);
  const { points, lines, circles, arcs, varsOf } = space;
  const { pointVarIndex, radiusVarIndex } = space;
  const residuals: Residual[] = [];
  const deps: number[][] = [];
  const refs = new Set<string>();
  const touched = new Set<string>();
  const settle = (into?: Set<string>) => {
    const used = [...refs].flatMap(varsOf);
    while (deps.length < residuals.length) deps.push(used);
    for (const id of refs) into?.add(id);
    refs.clear();
  };

  const px = (id: string) => {
    const p = points.get(id);
    if (!p) throw new SolverModelError(`unknown point ${id}`);
    refs.add(id);
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
      refs.add(id);
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

  for (const e of input.entities) {
    if (e.kind !== "arc" && e.kind !== "ellipse") continue;
    const [c, p, q] = entityPointIds(e).map((id) => [px(id), py(id)]);
    const rule = e.kind === "arc" ? arcRadiusGap : axisCosine;
    residuals.push((x) => rule(pointAt(c!, x), pointAt(p!, x), pointAt(q!, x)));
    settle();
  }

  for (const c of input.constraints) {
    if ("driven" in c && c.driven) continue;
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
    settle(touched);
  }

  const hardCount = residuals.length;

  if (input.drag) {
    const vi = pointVarIndex.get(input.drag.pointId);
    if (vi !== undefined && vi >= 0) {
      const { x: tx, y: ty } = { x: input.drag.x, y: input.drag.y };
      residuals.push((x) => DRAG_WEIGHT * (x[vi]! - tx));
      residuals.push((x) => DRAG_WEIGHT * (x[vi + 1]! - ty));
      refs.add(input.drag.pointId);
      settle();
    }
  }

  return {
    x0: Float64Array.from(space.vars),
    residuals,
    deps,
    refs: touched,
    hardCount,
    varsOf,
    apply: space.apply,
    numVars: space.vars.length,
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

function components(deps: number[][], numVars: number): Block[] {
  const parent = Array.from({ length: numVars }, (_, v) => v);
  const root = (v: number): number => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]!]!;
    return v;
  };
  for (const [first, ...rest] of deps)
    for (const v of rest) parent[root(v)] = root(first!);
  const found = new Map<number, Block>();
  for (const [row, used] of deps.entries()) {
    if (used.length === 0) continue;
    const key = root(used[0]!);
    const part = found.get(key) ?? { vars: [], rows: [] };
    found.set(key, part);
    part.rows.push(row);
  }
  for (let v = 0; v < numVars; v++) found.get(root(v))?.vars.push(v);
  return [...found.values()];
}

function solveTouching(
  input: SolveInput,
  seeds: Set<string> | null,
): SolveResult {
  const entities: SketchEntity[] = input.entities.map((e) => ({ ...e }));
  const problem = buildProblem({ ...input, entities });
  const { residuals, deps, numVars, hardCount } = problem;
  const x = Float64Array.from(problem.x0);
  const seedVars = seeds && new Set([...seeds].flatMap(problem.varsOf));
  const solved: Block[] = [];
  const kept: Block[] = [];
  for (const part of components(deps, numVars)) {
    const touched = !seedVars || part.vars.some((v) => seedVars.has(v));
    (touched ? solved : kept).push(part);
  }
  const hard = (row: number) => row < hardCount;
  let dof = numVars;
  const count = ({ vars, rows }: Block): number => {
    const own = rows.filter(hard).map((row) => residuals[row]!);
    if (own.length === 0) return 0;
    const J = numericJacobian(own, x, evalResiduals(own, x), vars);
    dof -= jacobianRank(J, vars.length);
    return dampingFloor(J);
  };
  const floor = kept.reduce((f, part) => Math.max(f, count(part)), 0);
  const solvedRows = new Set(solved.flatMap((part) => part.rows));
  const descend = (keep: (row: number) => boolean): number[] => {
    const rows = [...deps.keys()].filter(
      (row) => keep(row) && (!deps[row]!.length || solvedRows.has(row)),
    );
    const at = new Map(rows.map((row, i) => [row, i]));
    const blocks = solved.map(({ vars, rows: own }) => ({
      vars,
      rows: own.filter(keep).map((row) => at.get(row)!),
    }));
    leastSquares(
      rows.map((row) => residuals[row]!),
      x,
      blocks,
      floor,
    );
    return rows;
  };
  const judged = descend(() => true).filter(hard);
  if (residuals.length > hardCount) descend(hard);
  for (const part of solved) count(part);

  problem.apply(x, entities);

  let maxResidual = 0;
  for (const row of judged)
    maxResidual = Math.max(maxResidual, Math.abs(residuals[row]!(x)));
  const converged = maxResidual < CONFLICT_TOL;

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

export const solveSketch = (input: SolveInput): SolveResult =>
  solveTouching(input, input.drag ? new Set([input.drag.pointId]) : null);

export const settledEntities = (
  result: SolveResult,
  stored: SketchEntity[],
): SketchEntity[] => (result.converged ? result.entities : stored);

const holds = ({ residuals, x0 }: Problem): boolean =>
  residuals.every((r) => Math.abs(r(x0)) < CONFLICT_TOL);

export function sketchConstraintsHold(input: SolveInput): boolean | null {
  try {
    return holds(buildProblem(input));
  } catch (e) {
    if (e instanceof SolverModelError) return null;
    throw e;
  }
}

const converges = (
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  touched: Set<string>,
): boolean => solveTouching({ entities, constraints }, touched).converged;

function firstConflict(
  entities: SketchEntity[],
  kept: SketchConstraint[],
  added: SketchConstraint[],
  touched: Set<string>,
): SketchConstraint {
  let lo = 0;
  let hi = added.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (converges(entities, [...kept, ...added.slice(0, mid + 1)], touched))
      lo = mid + 1;
    else hi = mid;
  }
  return added[lo]!;
}

export function editedEntities(
  before: SketchConstraint[],
  after: { entities: SketchEntity[]; constraints: SketchConstraint[] },
): SketchEntity[] {
  const had = new Set(before.map((c) => JSON.stringify(c)));
  const isNew = (c: SketchConstraint) => !had.has(JSON.stringify(c));
  const added = after.constraints.filter(isNew);
  try {
    const probe = buildProblem({
      entities: after.entities,
      constraints: added,
    });
    if (holds(probe)) return after.entities;
    const solved = solveTouching(after, probe.refs);
    if (solved.converged) return solved.entities;
    const kept = after.constraints.filter((c) => !isNew(c));
    if (converges(after.entities, kept, probe.refs))
      throw new OverConstrainedError(
        firstConflict(after.entities, kept, added, probe.refs),
      );
    return after.entities;
  } catch (e) {
    if (e instanceof SolverModelError) return after.entities;
    throw e;
  }
}
