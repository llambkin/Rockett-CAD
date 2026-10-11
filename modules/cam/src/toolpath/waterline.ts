import { CHORD_FRACTION } from "../kernel/surfaceMesh.js";
import type { Move, Section, Xy } from "../shared/ir.js";
import { toolRefusal } from "../shared/operations.js";
import { MIN_TOLERANCE } from "../shared/params.js";
import type { Box, Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";
import {
  indexMesh,
  type IndexedMesh,
  type Mesh,
} from "../surface/dropCutter.js";
import { depthLevels, gap } from "./geometry.js";
import { dropBudget, type Budget } from "./parallel.js";

export type WaterlineInput = {
  operationId: string;
  setup: Pick<Setup, "safeHeight" | "clearance" | "tolerance">;
  stock: Box;
  mesh: Mesh;
  tool: Tool;
  preset: Preset;
  angle: number;
};

type Grid = {
  x: number;
  y: number;
  size: number;
  columns: number;
  rows: number;
  heights: Float64Array;
};

type Probe = {
  budget: Budget;
  mesh: IndexedMesh;
  tool: Tool;
  z: number;
  at: number;
  step: number;
  margin: number;
  tolerance: number;
  spacing: number;
  reach: number;
};

const GRID_FRACTION = 0.25;
const STEP_FRACTION = 0.125;
const MARGIN_FRACTION = 0.25;
const RESIDUAL_FRACTION = 0.01;
const SLOPE_PROBE = 4;

const CASES: [number, number][][] = [
  [],
  [[0, 3]],
  [[1, 0]],
  [[1, 3]],
  [[2, 1]],
  [
    [0, 1],
    [2, 3],
  ],
  [[2, 0]],
  [[2, 3]],
  [[3, 2]],
  [[0, 2]],
  [
    [3, 0],
    [1, 2],
  ],
  [[1, 2]],
  [[3, 1]],
  [[0, 1]],
  [[3, 0]],
  [],
];

const SPLIT_SADDLES: Record<number, [number, number][]> = {
  5: [
    [0, 3],
    [2, 1],
  ],
  10: [
    [1, 0],
    [3, 2],
  ],
};

const along = (a: Xy, b: Xy, t: number): Xy => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const shift = (p: Xy, d: Xy, t: number): Xy => [
  p[0] + d[0] * t,
  p[1] + d[1] * t,
];

function unit(x: number, y: number): Xy {
  const length = Math.hypot(x, y);
  return [x / length, y / length];
}

const left = (a: Xy, b: Xy) => unit(a[1] - b[1], b[0] - a[0]);
const height = (c: Probe, [x, y]: Xy) => c.budget.drop(c.mesh, c.tool, x, y);
const free = (c: Probe, p: Xy) => height(c, p) <= c.z;

function shape(tool: Tool) {
  const radius = tool.diameter / 2;
  if (!(radius > 0)) throw new RangeError("tool diameter must be above 0");
  if (tool.kind === "ball") return { radius, corner: radius };
  if (tool.kind === "bull") return { radius, corner: tool.cornerRadius };
  return { radius, corner: 0 };
}

function spacing(radius: number, corner: number, residual: number) {
  const r = Math.max(corner, radius - corner);
  return 2 * Math.sqrt(2 * r * residual - residual * residual);
}

function extent(mesh: IndexedMesh) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  mesh.points.forEach((value, i) => {
    low[i % 3] = Math.min(low[i % 3]!, value);
    high[i % 3] = Math.max(high[i % 3]!, value);
  });
  return { low, high };
}

function sample(
  mesh: IndexedMesh,
  tool: Tool,
  radius: number,
  budget: Budget,
): Grid {
  const size = radius * GRID_FRACTION;
  const { low, high } = extent(mesh);
  const x = low[0]! - radius - size;
  const y = low[1]! - radius - size;
  const columns = Math.ceil((high[0]! + radius + size - x) / size) + 1;
  const rows = Math.ceil((high[1]! + radius + size - y) / size) + 1;
  budget.need(columns * rows);
  const heights = new Float64Array(columns * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++)
      heights[j * columns + i] = budget.drop(
        mesh,
        tool,
        x + i * size,
        y + j * size,
      );
  return { x, y, size, columns, rows, heights };
}

function boundary(c: Probe, from: Xy, to: Xy, bounded = false): Xy {
  let [lo, hi] = [from, to];
  while (gap(lo, hi) > c.step) {
    const mid = along(lo, hi, 0.5);
    if (free(c, mid)) lo = mid;
    else hi = mid;
  }
  const back = shift(
    lo,
    unit(from[0] - to[0], from[1] - to[1]),
    bounded ? Math.min(c.margin, gap(lo, from) / 2) : c.margin,
  );
  return free(c, back) ? back : lo;
}

function search(
  c: Probe,
  origin: Xy,
  direction: Xy,
  [first, limit]: [number, number],
  toFree: boolean,
): Xy | undefined {
  let near = origin;
  for (let t = first; t <= limit; t *= 2) {
    const p = shift(origin, direction, t);
    if (free(c, p) === toFree)
      return toFree ? boundary(c, p, near) : boundary(c, near, p);
    near = p;
  }
  return undefined;
}

function split(c: Probe, a: Xy, b: Xy): Xy | undefined {
  const length = gap(a, b);
  const inward = left(a, b);
  const count = Math.ceil(length / c.spacing);
  for (let k = 1; k < count; k++) {
    const q = along(a, b, k / count);
    if (free(c, q)) continue;
    const out = search(
      c,
      q,
      [-inward[0], -inward[1]],
      [c.margin, c.reach],
      true,
    );
    if (!out)
      throw new RangeError(`waterline could not clear a loop at Z ${c.at}`);
    return out;
  }
  if (length <= 2 * c.tolerance) return undefined;
  const middle = along(a, b, 0.5);
  if (!free(c, shift(middle, inward, c.tolerance))) return undefined;
  return search(c, middle, inward, [2 * c.tolerance, length], false);
}

function refine(c: Probe, loop: Xy[]): Xy[] {
  const out: Xy[] = [];
  for (const [i, start] of loop.entries()) {
    const pending = [loop[(i + 1) % loop.length]!];
    let from = start;
    while (pending.length) {
      const mid = split(c, from, pending.at(-1)!);
      if (mid) {
        pending.push(mid);
        continue;
      }
      out.push(from);
      from = pending.pop()!;
    }
  }
  return out;
}

function edgePoint(c: Probe, grid: Grid, inside: Uint8Array, edge: number): Xy {
  const node = edge >> 1;
  const other = node + (edge & 1 ? grid.columns : 1);
  const at = (n: number): Xy => [
    grid.x + (n % grid.columns) * grid.size,
    grid.y + Math.floor(n / grid.columns) * grid.size,
  ];
  return inside[node]
    ? boundary(c, at(other), at(node), true)
    : boundary(c, at(node), at(other), true);
}

function cellSegments(
  c: Probe,
  grid: Grid,
  inside: Uint8Array,
  i: number,
  j: number,
) {
  const { columns, size } = grid;
  const n = j * columns + i;
  const corners = [n, n + 1, n + 1 + columns, n + columns];
  const index = corners.reduce((sum, k, bit) => sum | (inside[k]! << bit), 0);
  const edges = [2 * n, 2 * (n + 1) + 1, 2 * (n + columns), 2 * n + 1];
  const middle: Xy = [grid.x + (i + 0.5) * size, grid.y + (j + 0.5) * size];
  const pairs =
    index in SPLIT_SADDLES && free(c, middle)
      ? SPLIT_SADDLES[index]!
      : CASES[index]!;
  return pairs.map(([a, b]) => [edges[a]!, edges[b]!] as const);
}

function contours(c: Probe, grid: Grid): Xy[][] {
  const inside = Uint8Array.from(grid.heights, (h) => (h > c.z ? 1 : 0));
  const next = new Map<number, number>();
  for (let j = 0; j + 1 < grid.rows; j++)
    for (let i = 0; i + 1 < grid.columns; i++)
      for (const [from, to] of cellSegments(c, grid, inside, i, j))
        next.set(from, to);
  const loops: Xy[][] = [];
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    const loop: Xy[] = [];
    for (let edge = start; next.has(edge);) {
      loop.push(edgePoint(c, grid, inside, edge));
      const to = next.get(edge)!;
      next.delete(edge);
      edge = to;
    }
    loops.push(
      refine(
        c,
        loop.filter((p, i) => gap(p, loop.at(i - 1)!) > 0),
      ),
    );
  }
  return loops;
}

const turn = (p: Xy, q: Xy, r: Xy) =>
  Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));

function crossings(loops: Xy[][], size: number): boolean {
  const cells = new Map<string, [Xy, Xy][]>();
  const span = (u: number, v: number) =>
    [Math.min(u, v), Math.max(u, v)].map((w) => Math.floor(w / size));
  for (const loop of loops)
    for (const [i, a] of loop.entries()) {
      const b = loop[(i + 1) % loop.length]!;
      const [x0, x1] = span(a[0], b[0]) as [number, number];
      const [y0, y1] = span(a[1], b[1]) as [number, number];
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const here = cells.get(key) ?? [];
          for (const [c, d] of here)
            if (
              turn(a, b, c) * turn(a, b, d) < 0 &&
              turn(c, d, a) * turn(c, d, b) < 0
            )
              return true;
          here.push([a, b]);
          cells.set(key, here);
        }
    }
  return false;
}

function steep(c: Probe, loop: Xy[], rise: number, probe: number): boolean {
  return loop.some((p, i) => {
    const before = left(loop[(i + loop.length - 1) % loop.length]!, p);
    const after = left(p, loop[(i + 1) % loop.length]!);
    const normal = unit(before[0] + after[0], before[1] + after[1]);
    return height(c, shift(p, normal, probe)) - c.z >= rise;
  });
}

function levels(
  mesh: IndexedMesh,
  [top, bottom, lift]: [number, number, number],
  input: WaterlineInput,
) {
  const all = depthLevels(top, bottom, input.preset.stepdown).map(
    (z): [number, number] => [z, z - lift],
  );
  const { points: p, corners: k } = mesh;
  const floors = new Set<number>();
  for (let t = 0; t < k.length; t += 3) {
    const z = p[k[t]! + 2]!;
    if (
      z < top &&
      z > bottom &&
      p[k[t + 1]! + 2] === z &&
      p[k[t + 2]! + 2] === z
    )
      floors.add(z);
  }
  for (const floor of floors) {
    const at = all.findIndex(([z]) => z < floor + lift);
    all.splice(at < 0 ? all.length : at, 0, [floor + lift, floor]);
  }
  return all.filter(
    ([z], i) => i === 0 || all[i - 1]![0] - z > input.setup.tolerance,
  );
}

export function checkWaterline({
  setup,
  tool,
  angle,
}: Pick<WaterlineInput, "setup" | "tool" | "angle">) {
  const refusal = toolRefusal("rockett.cam.waterline", tool.kind);
  if (refusal) throw new RangeError(refusal);
  if (!(angle >= 0 && angle < 90))
    throw new RangeError("wall angle must be at least 0 and below 90 degrees");
  if (!(setup.tolerance >= MIN_TOLERANCE && Number.isFinite(setup.tolerance)))
    throw new RangeError(`tolerance must be at least ${MIN_TOLERANCE} mm`);
  if (!(setup.clearance > 0 && setup.safeHeight >= setup.clearance))
    throw new RangeError(
      "clearance must be above 0 and at most the safe height",
    );
}

function checked(input: WaterlineInput) {
  checkWaterline(input);
  if (!input.mesh.indices.length)
    throw new RangeError("waterline needs a mesh with triangles");
  const mesh = indexMesh(input.mesh);
  const { low, high } = extent(mesh);
  if (!(input.stock.max[2] >= high[2]!))
    throw new RangeError("stock top must be at or above the model top");
  const bottom = Math.max(low[2]!, input.stock.min[2]);
  return { mesh, top: high[2]!, bottom, ...shape(input.tool) };
}

export function waterline(input: WaterlineInput): Section {
  const { setup, preset, stock, tool } = input;
  const { mesh, top, bottom, radius, corner } = checked(input);
  const { tolerance } = setup;
  const lift = tolerance * RESIDUAL_FRACTION;
  const grown: Tool = {
    ...tool,
    kind: "bull",
    diameter: 2 * (radius + lift),
    cornerRadius: corner + lift,
  };
  const all = levels(mesh, [top, bottom, lift], input);
  const budget = dropBudget("waterline");
  const grid = sample(mesh, grown, radius + lift, budget);
  const probe: Probe = {
    budget,
    mesh,
    tool: grown,
    z: top,
    at: top,
    step: tolerance * STEP_FRACTION,
    margin: tolerance * MARGIN_FRACTION,
    tolerance: tolerance * (1 - CHORD_FRACTION),
    spacing: spacing(radius + lift, corner + lift, lift),
    reach: 2 * radius + grid.size,
  };
  const reach = SLOPE_PROBE * tolerance;
  const rise =
    (reach - probe.margin - probe.step) *
    Math.tan((input.angle * Math.PI) / 180);
  const clear = stock.max[2] + setup.clearance;
  const safe = stock.max[2] + setup.safeHeight;
  const moves: Move[] = [];
  for (const [n, [z, low]] of all.entries()) {
    Object.assign(probe, { z: low, at: z });
    budget.what = `waterline at depth level ${n + 1} of ${all.length}`;
    const loops = contours(probe, grid);
    if (crossings(loops, grid.size))
      throw new RangeError(`waterline loops cross at Z ${z}`);
    for (const loop of loops) {
      if (!steep(probe, loop, rise, reach)) continue;
      const [x, y] = loop[0]!;
      if (!moves.length) moves.push({ kind: "rapid", to: [x, y, safe] });
      moves.push({ kind: "rapid", to: [x, y, clear] });
      moves.push({
        kind: "feed",
        to: [x, y, z],
        feed: preset.plungeFeed,
        role: "plunge",
      });
      for (const [px, py] of Array.from(loop, (_, i) => loop.at(-1 - i)!))
        moves.push({
          kind: "feed",
          to: [px, py, z],
          feed: preset.cutFeed,
          role: "cut",
        });
      moves.push({
        kind: "feed",
        to: [x, y, clear],
        feed: preset.cutFeed,
        role: "link",
      });
    }
  }
  const last = moves.at(-1);
  if (last?.kind === "feed")
    moves.push({ kind: "rapid", to: [last.to[0], last.to[1], safe] });
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "finish",
    spindle: { rpm: preset.rpm, dir: "cw" },
    coolant: preset.coolant,
    moves,
  };
}
