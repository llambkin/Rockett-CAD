import type { RouteModuleApi, ServerContext } from "@rockett/plugin-api";
import { EPSILON, cellRange, cellSize, gridOf } from "../client/heightmap.js";
import { surfaceRoute } from "../shared/document.js";
import { MIN_TOLERANCE } from "../shared/params.js";
import { stockBox } from "../shared/setup.js";
import type { Mesh } from "../surface/dropCutter.js";
import { stockSetup } from "./generate.js";

const SURFACE_JOB = "rockett.cam.surfaceMesh";

type Grid = ReturnType<typeof gridOf>;

function partTops({ positions: p, indices }: Mesh, grid: Grid) {
  const { min, cellMm, columns, rows } = grid;
  const tops = new Float64Array(columns * rows).fill(-Infinity);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = 3 * indices[t]!;
    const b = 3 * indices[t + 1]!;
    const c = 3 * indices[t + 2]!;
    const [ax, ay, az] = [p[a]!, p[a + 1]!, p[a + 2]!];
    const [ux, uy, uz] = [p[b]! - ax, p[b + 1]! - ay, p[b + 2]! - az];
    const [vx, vy, vz] = [p[c]! - ax, p[c + 1]! - ay, p[c + 2]! - az];
    const det = ux * vy - vx * uy;
    if (Math.abs(det) < EPSILON) continue;
    const [i0, i1] = cellRange(
      ax + Math.min(0, ux, vx),
      ax + Math.max(0, ux, vx),
      min[0],
      cellMm,
      columns,
    );
    const [j0, j1] = cellRange(
      ay + Math.min(0, uy, vy),
      ay + Math.max(0, uy, vy),
      min[1],
      cellMm,
      rows,
    );
    for (let j = j0; j <= j1; j++) {
      const dy = min[1] + (j + 0.5) * cellMm - ay;
      for (let i = i0; i <= i1; i++) {
        const dx = min[0] + (i + 0.5) * cellMm - ax;
        const s = (dx * vy - vx * dy) / det;
        const r = (ux * dy - dx * uy) / det;
        if (s < -EPSILON || r < -EPSILON || s + r > 1 + EPSILON) continue;
        const k = j * columns + i;
        tops[k] = Math.max(tops[k]!, az + s * uz + r * vz);
      }
    }
  }
  return Array.from(tops, (z) => (Number.isFinite(z) ? z : null));
}

export function mountSurface(
  api: RouteModuleApi,
  context: Pick<ServerContext, "bodies" | "startKernelJob">,
) {
  api.projectRoute(surfaceRoute, async (doc, req, { user }) => {
    const tolerance = Number(req.params.tolerance);
    if (!(Number.isFinite(tolerance) && tolerance >= MIN_TOLERANCE))
      return {
        reason: `gouge tolerance must be at least ${MIN_TOLERANCE} mm`,
      };
    const found = await stockSetup(context, doc, req.params, user);
    if ("reason" in found) return found;
    const { setup, bodies } = found;
    const box = stockBox(
      setup,
      Object.fromEntries(bodies.map(({ id: key, bbox }) => [key, bbox])),
    );
    const grid = gridOf(box, cellSize(box));
    const mesh = (await context.startKernelJob(SURFACE_JOB, {
      bodies: bodies.map(({ fingerprint, brep }) => ({
        identity: fingerprint,
        brep,
      })),
      modelToSetup: box.modelToSetup,
      tolerance,
    })) as Mesh;
    const tops = partTops(mesh, grid);
    return { ...grid, tops };
  });
}
