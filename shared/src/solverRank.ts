import type { SketchConstraint } from "./model.js";
import {
  components,
  evalResiduals,
  jacobianRank,
  numericJacobian,
  type Block,
  type Residual,
} from "./leastSquares.js";

export const driving = (c: SketchConstraint) => !("driven" in c && c.driven);

interface RankProblem {
  x0: Float64Array;
  residuals: Residual[];
  deps: number[][];
  starts: number[];
  hardCount: number;
  numVars: number;
}

export function firstRedundant(
  before: SketchConstraint[],
  constraints: SketchConstraint[],
  build: (constraints: SketchConstraint[]) => RankProblem,
  tol: number,
): SketchConstraint | undefined {
  const drove = new Set(before.filter(driving).map((c) => c.id));
  const fresh = constraints.filter((c) => driving(c) && !drove.has(c.id));
  if (fresh.length === 0) return undefined;
  const base = constraints.filter((c) => !fresh.includes(c));
  const problem = build([...base, ...fresh]);
  const { residuals, deps, starts, hardCount, x0 } = problem;
  const blocks = components(deps.slice(0, hardCount), problem.numVars);
  const blockOf = new Map(blocks.flatMap((b) => b.rows.map((r) => [r, b])));
  const freshStart = starts[base.length]!;
  const judge = ({ rows, vars }: Block) => {
    const own = rows.map((row) => residuals[row]!);
    const r0 = evalResiduals(own, x0);
    if (r0.some((r) => Math.abs(r) >= tol)) return null;
    const J = numericJacobian(own, x0, r0, vars);
    const at = new Map(rows.map((row, i) => [row, J[i]!]));
    const kept = rows.filter((row) => row < freshStart).map((r) => at.get(r)!);
    return { at, kept, rank: jacobianRank(kept, vars.length) };
  };
  const judged = new Map<Block, NonNullable<ReturnType<typeof judge>>>();
  for (const [i, c] of fresh.entries()) {
    const first = starts[base.length + i]!;
    const end = starts[base.length + i + 1] ?? hardCount;
    if (first === end) continue;
    const block = blockOf.get(first);
    if (!block) return c;
    const state = judged.get(block) ?? judge(block);
    if (!state) return undefined;
    judged.set(block, state);
    for (let row = first; row < end; row++) state.kept.push(state.at.get(row)!);
    const rank = jacobianRank(state.kept, block.vars.length);
    if (rank === state.rank) return c;
    state.rank = rank;
  }
  return undefined;
}
