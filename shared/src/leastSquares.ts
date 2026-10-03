export type Residual = (x: Float64Array) => number;

const CONV_TOL = 1e-8;
const MAX_ITER = 120;
const DAMPING_FLOOR = 1e-6;

export interface Block {
  vars: number[];
  rows: number[];
}

export function evalResiduals(res: Residual[], x: Float64Array): Float64Array {
  const out = new Float64Array(res.length);
  for (let i = 0; i < res.length; i++) out[i] = res[i]!(x);
  return out;
}

const sumSquares = (values: Float64Array): number =>
  values.reduce((s, v) => s + v * v, 0);

function checkLength(values: { length: number }, length: number): void {
  if (values.length !== length) {
    throw new RangeError(`expected length ${length}, got ${values.length}`);
  }
}

export function numericJacobian(
  res: Residual[],
  x: Float64Array,
  r0: Float64Array,
  vars: number[],
): Float64Array[] {
  checkLength(r0, res.length);
  const m = res.length;
  const J: Float64Array[] = [];
  for (let i = 0; i < m; i++) J.push(new Float64Array(vars.length));
  for (const [j, v] of vars.entries()) {
    const xv = x[v]!;
    const h = 1e-6 * Math.max(1, Math.abs(xv));
    x[v] = xv + h;
    for (let i = 0; i < m; i++) {
      J[i]![j] = (res[i]!(x) - r0[i]!) / h;
    }
    x[v] = xv;
  }
  return J;
}

function normalSystem(
  residuals: Residual[],
  x: Float64Array,
  r: Float64Array,
  { vars, rows }: Block,
): Float64Array[] {
  const n = vars.length;
  const res = rows.map((i) => residuals[i]!);
  const r0 = Float64Array.from(rows, (i) => r[i]!);
  const J = numericJacobian(res, x, r0, vars);
  const A: Float64Array[] = [];
  for (let i = 0; i < n; i++) A.push(new Float64Array(n + 1));
  for (const [ri, row] of J.entries()) {
    for (let a = 0; a < n; a++) {
      if (row[a] === 0) continue;
      for (let b = a; b < n; b++) {
        A[a]![b]! += row[a]! * row[b]!;
      }
      A[a]![n]! -= row[a]! * r0[ri]!;
    }
  }
  for (let a = 0; a < n; a++) for (let b = 0; b < a; b++) A[a]![b] = A[b]![a]!;
  return A;
}

function eliminate(
  A: Float64Array[],
  lambda: number,
  floor: number,
): Float64Array {
  const n = A.length;
  for (let a = 0; a < n; a++) {
    A[a]![a]! *= 1 + lambda;
    A[a]![a]! += 1e-12 + lambda * floor;
  }
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

export function jacobianRank(J: Float64Array[], n: number): number {
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

export function dampingFloor(J: Float64Array[]): number {
  let floor = 0;
  for (let a = 0; a < (J[0]?.length ?? 0); a++) {
    let diagonal = 0;
    for (const row of J) if (row[a] !== 0) diagonal += row[a]! * row[a]!;
    floor = Math.max(floor, diagonal * DAMPING_FLOOR);
  }
  return floor;
}

function dampedStep(
  residuals: Residual[],
  x: Float64Array,
  r: Float64Array,
  blocks: Block[],
  lambda: number,
  base: number,
): Float64Array {
  const systems = blocks.map((block) => normalSystem(residuals, x, r, block));
  let floor = base;
  for (const A of systems)
    for (const [a, row] of A.entries())
      floor = Math.max(floor, row[a]! * DAMPING_FLOOR);
  const dx = new Float64Array(x.length);
  for (const [k, { vars }] of blocks.entries()) {
    const d = eliminate(systems[k]!, lambda, floor);
    for (const [j, v] of vars.entries()) dx[v] = d[j]!;
  }
  return dx;
}

export function leastSquares(
  residuals: Residual[],
  x: Float64Array,
  blocks: Block[],
  floor = 0,
): void {
  if (blocks.length === 0 || residuals.length === 0) return;
  let r = evalResiduals(residuals, x);
  let cost = sumSquares(r);
  let lambda = 1e-3;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (Math.sqrt(cost) < CONV_TOL) break;
    const dx = dampedStep(residuals, x, r, blocks, lambda, floor);
    const before = Float64Array.from(x);
    for (const { vars } of blocks) for (const v of vars) x[v] = x[v]! + dx[v]!;
    const rNew = evalResiduals(residuals, x);
    const costNew = sumSquares(rNew);
    if (costNew < cost) {
      r = rNew;
      cost = costNew;
      lambda = Math.max(lambda * 0.4, 1e-9);
      if (Math.sqrt(sumSquares(dx)) < 1e-12) break;
    } else {
      x.set(before);
      lambda *= 5;
      if (lambda > 1e10) break;
    }
  }
}

export function components(deps: number[][], numVars: number): Block[] {
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
