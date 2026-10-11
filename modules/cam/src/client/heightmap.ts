import type { RouteResponse } from "@rockett/plugin-api";
import type { surfaceRoute } from "../shared/document.js";
import type { Program, Xy } from "../shared/ir.js";
import { GOUGE_TOLERANCE } from "../shared/params.js";
import type { Box } from "../shared/setup.js";
import type { Tool } from "../shared/tools.js";
import { programToSegments } from "./segments.js";

export const CELL_MM = 0.5;
export const MAX_CELLS = 600 * 600;

export type Grid = { min: Xy; cellMm: number; columns: number; rows: number };
export type Heightmap = Grid & { heights: Float32Array; cutBy: Int32Array };
export type PartTop = RouteResponse<typeof surfaceRoute>;
export type Gouge = { operationId: string; cells: number; deepest: number };
export type GougeCheck =
  { gouges: Gouge[]; gouged: Uint8Array } | { reason: string };
export type SimulationJob = {
  program: Program;
  stock: Box;
  cellMm: number;
  top: PartTop;
  tolerances: Record<string, number>;
};
export type Simulated = { map: Heightmap; check: GougeCheck };

type Lowest = (
  z: number,
  m: number,
  h2: number,
  lo: number,
  hi: number,
) => number;

export const EPSILON = 1e-9;

const clamp = (u: number, lo: number, hi: number) =>
  Math.min(Math.max(u, lo), hi);

function lowest(tool: Tool): Lowest {
  const r = tool.diameter / 2;
  if (tool.kind === "bull") throw new Error("bull tools are not simulated yet");
  if ("tipAngle" in tool) {
    const k = 1 / Math.tan((tool.tipAngle * Math.PI) / 360);
    return (z, m, h2, lo, hi) => {
      const free =
        Math.abs(m) < k
          ? (-m * Math.sqrt(h2)) / Math.sqrt(k * k - m * m)
          : -m * Infinity;
      const u = clamp(free, lo, hi);
      return z + m * u + k * Math.sqrt(u * u + h2);
    };
  }
  if (tool.kind === "flat")
    return (z, m, _h2, lo, hi) => z + m * (m > 0 ? lo : hi);
  return (z, m, h2, lo, hi) => {
    const w2 = r * r - h2;
    const u = clamp((-m * Math.sqrt(w2)) / Math.sqrt(1 + m * m), lo, hi);
    return z + m * u + r - Math.sqrt(Math.max(0, w2 - u * u));
  };
}

export function cellSize({ min, max }: Box) {
  const [w, h] = [max[0] - min[0], max[1] - min[1]];
  const n = MAX_CELLS - 1;
  return Math.max(
    CELL_MM,
    (w + h + Math.sqrt((w + h) ** 2 + 4 * n * w * h)) / (2 * n),
  );
}

export const cellRange = (
  lo: number,
  hi: number,
  origin: number,
  cellMm: number,
  count: number,
) =>
  [
    Math.max(0, Math.ceil((lo - origin) / cellMm - 0.5)),
    Math.min(count - 1, Math.floor((hi - origin) / cellMm - 0.5)),
  ] as const;

export function gridOf({ min, max }: Box, cellMm: number): Grid {
  if (!(cellMm > 0)) throw new Error("cell size must be greater than 0");
  const columns = Math.ceil((max[0] - min[0]) / cellMm);
  const rows = Math.ceil((max[1] - min[1]) / cellMm);
  if (columns * rows > MAX_CELLS)
    throw new RangeError(`the stock needs more than ${MAX_CELLS} cells`);
  return { min: [min[0], min[1]], cellMm, columns, rows };
}

export function simulateHeightmap(
  program: Program,
  stock: Box,
  cellMm: number,
): Heightmap {
  const { columns, rows } = gridOf(stock, cellMm);
  const [x0, y0, bottom] = stock.min;
  const top = stock.max[2];
  const heights = new Float32Array(columns * rows).fill(top);
  const cutBy = new Int32Array(columns * rows).fill(-1);
  const { positions, sections } = programToSegments(program);

  const sweep = (p: number, r: number, cut: Lowest, section: number) => {
    const [ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0] = positions.subarray(
      p,
      p + 6,
    );
    if (Math.min(az, bz) >= top) return;
    const s = Math.hypot(bx - ax, by - ay);
    const vertical = s < EPSILON;
    const [ex, ey] = vertical ? [0, 0] : [(bx - ax) / s, (by - ay) / s];
    const m = vertical ? 0 : (bz - az) / s;
    const z0 = vertical ? Math.min(az, bz) : az;
    const [i0, i1] = cellRange(
      Math.min(ax, bx) - r,
      Math.max(ax, bx) + r,
      x0,
      cellMm,
      columns,
    );
    const [j0, j1] = cellRange(
      Math.min(ay, by) - r,
      Math.max(ay, by) + r,
      y0,
      cellMm,
      rows,
    );
    for (let j = j0; j <= j1; j++) {
      const ry = y0 + (j + 0.5) * cellMm - ay;
      for (let i = i0; i <= i1; i++) {
        const rx = x0 + (i + 0.5) * cellMm - ax;
        const along = rx * ex + ry * ey;
        const h2 = Math.max(0, rx * rx + ry * ry - along * along);
        if (h2 > r * r) continue;
        const w = Math.sqrt(r * r - h2);
        const lo = Math.max(-along, -w);
        const hi = Math.min(s - along, w);
        if (lo > hi) continue;
        const z = cut(z0 + m * along, m, h2, lo, hi);
        const c = j * columns + i;
        if (z >= heights[c]!) continue;
        heights[c] = Math.max(z, bottom);
        cutBy[c] = section;
      }
    }
  };

  program.sections.forEach(({ toolId }, n) => {
    const tool = program.tools.find(({ id }) => id === toolId);
    if (!tool) throw new Error(`section ${n} tool ${toolId} is unknown`);
    const cut = lowest(tool);
    const { start, count } = sections[n]!;
    for (let v = start; v < start + count; v += 2)
      sweep(v * 3, tool.diameter / 2, cut, n);
  });
  return { min: [x0, y0], cellMm, columns, rows, heights, cutBy };
}

const sameGrid = (a: Grid, b: Grid) =>
  a.cellMm === b.cellMm &&
  a.columns === b.columns &&
  a.rows === b.rows &&
  a.min[0] === b.min[0] &&
  a.min[1] === b.min[1];

function findGouges(
  map: Heightmap,
  top: Grid & { tops: (number | null)[] },
  program: Program,
  tolerances: Record<string, number>,
): GougeCheck {
  if (!sameGrid(map, top))
    return { reason: "the part top grid does not match the simulated stock" };
  const gouged = new Uint8Array(map.heights.length);
  const found = new Map<string, Gouge>();
  top.tops.forEach((z, c) => {
    const section = program.sections[map.cutBy[c]!];
    if (z === null || !section) return;
    const { operationId } = section;
    const depth = z - map.heights[c]!;
    if (!(depth > (tolerances[operationId] ?? GOUGE_TOLERANCE))) return;
    gouged[c] = 1;
    const seen = found.get(operationId);
    found.set(operationId, {
      operationId,
      cells: (seen?.cells ?? 0) + 1,
      deepest: Math.max(seen?.deepest ?? 0, depth),
    });
  });
  return { gouges: [...found.values()], gouged };
}

export function simulateJob(job: SimulationJob): Simulated {
  const map = simulateHeightmap(job.program, job.stock, job.cellMm);
  const { top } = job;
  const check =
    "reason" in top
      ? { reason: top.reason }
      : findGouges(map, top, job.program, job.tolerances);
  return { map, check };
}

export function simulateInWorker(job: SimulationJob) {
  let worker: Worker | undefined;
  let stop: ((error: Error) => void) | undefined;
  const result = new Promise<Simulated>((resolve, reject) => {
    stop = reject;
    worker = new Worker(new URL("./heightmapWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", ({ data }) =>
      "map" in data ? resolve(data) : reject(data.error),
    );
    worker.addEventListener("error", (event) =>
      reject(new Error(event.message)),
    );
    worker.postMessage(job, { transfer: [] });
  }).finally(() => worker?.terminate());
  return { result, cancel: () => stop?.(new Error("simulation cancelled")) };
}
