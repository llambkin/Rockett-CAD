import type { Tool } from "../shared/tools.js";

export type Mesh = {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
};

export type IndexedMesh = {
  readonly points: Float64Array;
  readonly corners: Uint32Array;
  readonly boxes: Float64Array;
  readonly planes: Float64Array;
  readonly grid: Grid;
  readonly seen: Uint32Array;
  visit: number;
};

type Cells = {
  x: number;
  y: number;
  size: number;
  columns: number;
  rows: number;
};

type Grid = Cells & {
  starts: Uint32Array;
  items: Uint32Array;
  top: Float64Array;
};

type Cutter = { radius: number; flat: number; corner: number };

type Edge = {
  z: number;
  slope: number;
  along: number;
  across: number;
  reach: number;
};

const TOLERANCE = 1e-9;
const MAX_STEPS = 64;
const MAX_VISIT = 0xffffffff;
const CELL_SCALE = 2;

function cutter(tool: Tool): Cutter {
  const radius = tool.diameter / 2;
  if (!(radius > 0)) throw new RangeError("tool diameter must be above 0");
  if (tool.kind === "flat") return { radius, flat: radius, corner: 0 };
  if (tool.kind === "ball") return { radius, flat: 0, corner: radius };
  if (tool.kind !== "bull")
    throw new RangeError("drop cutter takes flat, ball and bull tools");
  const corner = tool.cornerRadius;
  if (!(corner >= 0 && corner <= radius))
    throw new RangeError("corner radius must be between 0 and the radius");
  return { radius, flat: radius - corner, corner };
}

function lift(cut: Cutter, distance: number): number {
  if (distance <= cut.flat) return 0;
  const out = distance - cut.flat;
  return (
    cut.corner - Math.sqrt(Math.max(0, cut.corner * cut.corner - out * out))
  );
}

function checked(mesh: Mesh) {
  const points = Float64Array.from(mesh.positions);
  const count = points.length / 3;
  if (!Number.isInteger(count) || mesh.indices.length % 3)
    throw new RangeError("positions and indices must come in threes");
  if (!points.every(Number.isFinite))
    throw new RangeError("mesh positions must be finite");
  const corners = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < corners.length; i++) {
    const index = mesh.indices[i]!;
    if (!(Number.isInteger(index) && index >= 0 && index < count))
      throw new RangeError(`mesh index ${index} is outside the positions`);
    corners[i] = index * 3;
  }
  return { points, corners };
}

function triangleBoxes(points: Float64Array, corners: Uint32Array) {
  const boxes = new Float64Array((corners.length / 3) * 5);
  for (let t = 0; t < corners.length / 3; t++) {
    const b = t * 5;
    boxes.set([Infinity, Infinity, -Infinity, -Infinity, -Infinity], b);
    for (let k = 0; k < 3; k++) {
      const p = corners[3 * t + k]!;
      boxes[b] = Math.min(boxes[b]!, points[p]!);
      boxes[b + 1] = Math.min(boxes[b + 1]!, points[p + 1]!);
      boxes[b + 2] = Math.max(boxes[b + 2]!, points[p]!);
      boxes[b + 3] = Math.max(boxes[b + 3]!, points[p + 1]!);
      boxes[b + 4] = Math.max(boxes[b + 4]!, points[p + 2]!);
    }
  }
  return boxes;
}

function trianglePlanes(p: Float64Array, corners: Uint32Array) {
  const planes = new Float64Array((corners.length / 3) * 4);
  for (let t = 0; t < corners.length / 3; t++) {
    const a = corners[3 * t]!;
    const b = corners[3 * t + 1]!;
    const c = corners[3 * t + 2]!;
    const ux = p[b]! - p[a]!;
    const uy = p[b + 1]! - p[a + 1]!;
    const uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!;
    const vy = p[c + 1]! - p[a + 1]!;
    const vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) * (nz < 0 ? -1 : 1);
    if (!(Math.abs(length) > 0)) continue;
    const q = t * 4;
    planes[q] = nx / length;
    planes[q + 1] = ny / length;
    planes[q + 2] = nz / length;
    planes[q + 3] =
      planes[q]! * p[a]! +
      planes[q + 1]! * p[a + 1]! +
      planes[q + 2]! * p[a + 2]!;
  }
  return planes;
}

function cells(boxes: Float64Array): Cells {
  const count = boxes.length / 5;
  let [x, y, right, far, extent] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    0,
  ];
  for (let b = 0; b < boxes.length; b += 5) {
    x = Math.min(x, boxes[b]!);
    y = Math.min(y, boxes[b + 1]!);
    right = Math.max(right, boxes[b + 2]!);
    far = Math.max(far, boxes[b + 3]!);
    extent += Math.max(
      boxes[b + 2]! - boxes[b]!,
      boxes[b + 3]! - boxes[b + 1]!,
    );
  }
  const floor = Math.sqrt(((right - x) * (far - y)) / (4 * count));
  const size = Math.max((CELL_SCALE * extent) / count, floor) || 1;
  return {
    x,
    y,
    size,
    columns: Math.max(1, Math.ceil((right - x) / size)),
    rows: Math.max(1, Math.ceil((far - y) / size)),
  };
}

function cellRange(grid: Cells, low: number, high: number, axis: 0 | 1) {
  const origin = axis ? grid.y : grid.x;
  const last = (axis ? grid.rows : grid.columns) - 1;
  return [
    Math.max(0, Math.floor((low - origin) / grid.size)),
    Math.min(last, Math.floor((high - origin) / grid.size)),
  ] as const;
}

function buildGrid(boxes: Float64Array): Grid {
  const count = boxes.length / 5;
  const shape = cells(boxes);
  const total = shape.columns * shape.rows;
  const starts = new Uint32Array(total + 1);
  const top = new Float64Array(total).fill(-Infinity);
  const each = (visit: (cell: number, t: number) => void) => {
    for (let t = 0; t < count; t++) {
      const b = t * 5;
      const [i0, i1] = cellRange(shape, boxes[b]!, boxes[b + 2]!, 0);
      const [j0, j1] = cellRange(shape, boxes[b + 1]!, boxes[b + 3]!, 1);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) visit(j * shape.columns + i, t);
    }
  };
  each((cell) => starts[cell + 1]!++);
  for (let c = 0; c < total; c++) starts[c + 1]! += starts[c]!;
  const fill = starts.slice(0, total);
  const items = new Uint32Array(starts[total]!);
  each((cell, t) => {
    items[fill[cell]!++] = t;
    top[cell] = Math.max(top[cell]!, boxes[t * 5 + 4]!);
  });
  return { ...shape, starts, items, top };
}

export function indexMesh(mesh: Mesh): IndexedMesh {
  const { points, corners } = checked(mesh);
  const boxes = triangleBoxes(points, corners);
  return {
    points,
    corners,
    boxes,
    planes: trianglePlanes(points, corners),
    grid: buildGrid(boxes),
    seen: new Uint32Array(corners.length / 3),
    visit: 0,
  };
}

function vertex(
  p: Float64Array,
  v: number,
  cut: Cutter,
  x: number,
  y: number,
  best: number,
) {
  const distance = Math.hypot(p[v]! - x, p[v + 1]! - y);
  if (distance > cut.radius) return best;
  return Math.max(best, p[v + 2]! - lift(cut, distance));
}

function side(p: Float64Array, u: number, v: number, x: number, y: number) {
  return (
    (p[v]! - p[u]!) * (y - p[u + 1]!) - (p[v + 1]! - p[u + 1]!) * (x - p[u]!)
  );
}

function height(cut: Cutter, line: Edge, s: number) {
  return (
    line.z + line.slope * s - lift(cut, Math.hypot(line.across, s - line.along))
  );
}

function rate(cut: Cutter, line: Edge, s: number) {
  const w = s - line.along;
  const d = Math.hypot(line.across, w);
  if (d <= cut.flat) return line.slope;
  const out = d - cut.flat;
  const q = Math.sqrt(Math.max(0, cut.corner * cut.corner - out * out));
  return line.slope - ((out / q) * w) / d;
}

function bend(cut: Cutter, line: Edge, s: number) {
  const w = s - line.along;
  const d = Math.hypot(line.across, w);
  if (d <= cut.flat) return 0;
  const out = d - cut.flat;
  const q = Math.sqrt(Math.max(0, cut.corner * cut.corner - out * out));
  const curve = (cut.corner * cut.corner) / (q * q * q);
  return -(curve * (w / d) ** 2 + ((out / q) * line.across ** 2) / d ** 3);
}

function peak(cut: Cutter, line: Edge, from: number, to: number) {
  if (cut.corner === 0) return line.slope > 0 ? to : from;
  if (cut.flat === 0) {
    const { slope, along, reach } = line;
    const s = along + slope * Math.sqrt(reach / (1 + slope * slope));
    return Math.min(Math.max(s, from), to);
  }
  let [lo, hi] = [from, to];
  if (rate(cut, line, lo) <= 0) return lo;
  if (rate(cut, line, hi) >= 0) return hi;
  let s = (lo + hi) / 2;
  for (let step = 0; step < MAX_STEPS && hi - lo > TOLERANCE; step++) {
    const change = rate(cut, line, s);
    if (change > 0) lo = s;
    else hi = s;
    const next = s - change / bend(cut, line, s);
    if (Math.abs(next - s) < TOLERANCE) return next;
    s = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return s;
}

function edge(
  p: Float64Array,
  a: number,
  b: number,
  cut: Cutter,
  x: number,
  y: number,
  best: number,
) {
  const dx = p[b]! - p[a]!;
  const dy = p[b + 1]! - p[a + 1]!;
  const length = Math.hypot(dx, dy);
  if (!(length > TOLERANCE))
    return vertex(p, p[a + 2]! > p[b + 2]! ? a : b, cut, x, y, best);
  const along = ((x - p[a]!) * dx + (y - p[a + 1]!) * dy) / length;
  const across = ((x - p[a]!) * dy - (y - p[a + 1]!) * dx) / length;
  const reach = cut.radius * cut.radius - across * across;
  if (reach < 0) return best;
  const lo = Math.max(0, along - Math.sqrt(reach));
  const hi = Math.min(length, along + Math.sqrt(reach));
  if (lo > hi) return best;
  const line = {
    z: p[a + 2]!,
    slope: (p[b + 2]! - p[a + 2]!) / length,
    along,
    across,
    reach,
  };
  const nearest = Math.min(Math.max(along, lo), hi);
  const top = line.z + line.slope * (line.slope > 0 ? hi : lo);
  if (top - lift(cut, Math.hypot(across, nearest - along)) <= best) return best;
  return Math.max(best, height(cut, line, peak(cut, line, lo, hi)));
}

function contact(
  mesh: IndexedMesh,
  t: number,
  cut: Cutter,
  x: number,
  y: number,
) {
  const { planes } = mesh;
  const nx = planes[4 * t]!;
  const ny = planes[4 * t + 1]!;
  const slope = Math.hypot(nx, ny);
  const reach = slope > 0 ? cut.flat / slope + cut.corner : 0;
  return { x: x - reach * nx, y: y - reach * ny };
}

function facet(
  mesh: IndexedMesh,
  t: number,
  cut: Cutter,
  x: number,
  y: number,
) {
  const { planes } = mesh;
  const q = t * 4;
  const nz = planes[q + 2]!;
  if (!(nz > TOLERANCE)) return Infinity;
  const nx = planes[q]!;
  const ny = planes[q + 1]!;
  const slope = Math.hypot(nx, ny);
  const offset = cut.flat * slope + cut.corner * slope * slope;
  const level = planes[q + 3]! - nx * x - ny * y + offset;
  return level / nz - cut.corner * (1 - nz);
}

function facing(
  mesh: IndexedMesh,
  t: number,
  cut: Cutter,
  x: number,
  y: number,
) {
  if (!(mesh.planes[4 * t + 2]! > TOLERANCE)) return 7;
  const at = contact(mesh, t, cut, x, y);
  const { corners: k, points: p } = mesh;
  const [a, b, c] = [k[3 * t]!, k[3 * t + 1]!, k[3 * t + 2]!];
  const ab = side(p, a, b, at.x, at.y);
  const bc = side(p, b, c, at.x, at.y);
  const ca = side(p, c, a, at.x, at.y);
  const turn = ab + bc + ca;
  return (
    (ab * turn < 0 ? 1 : 0) | (bc * turn < 0 ? 2 : 0) | (ca * turn < 0 ? 4 : 0)
  );
}

function triangle(
  mesh: IndexedMesh,
  t: number,
  cut: Cutter,
  x: number,
  y: number,
  best: number,
) {
  const { boxes: box, points: p, corners: k } = mesh;
  const b = t * 5;
  if (box[b + 4]! <= best) return best;
  const gap = Math.hypot(
    Math.max(box[b]! - x, 0, x - box[b + 2]!),
    Math.max(box[b + 1]! - y, 0, y - box[b + 3]!),
  );
  if (gap > cut.radius || box[b + 4]! - lift(cut, gap) <= best) return best;
  const tip = facet(mesh, t, cut, x, y);
  if (tip <= best) return best;
  const sides = facing(mesh, t, cut, x, y);
  if (!sides) return tip;
  const [i, j, l] = [k[3 * t]!, k[3 * t + 1]!, k[3 * t + 2]!];
  if (sides & 1) best = edge(p, i, j, cut, x, y, best);
  if (sides & 2) best = edge(p, j, l, cut, x, y, best);
  if (sides & 4) best = edge(p, l, i, cut, x, y, best);
  return best;
}

function nextVisit(mesh: IndexedMesh) {
  if (mesh.visit === MAX_VISIT) {
    mesh.seen.fill(0);
    mesh.visit = 0;
  }
  return ++mesh.visit;
}

function reachOf(
  grid: Grid,
  cell: number,
  cut: Cutter,
  x: number,
  y: number,
  floor: number,
) {
  if (!(grid.top[cell]! > floor)) return -Infinity;
  const i = cell % grid.columns;
  const j = (cell - i) / grid.columns;
  const gap = Math.hypot(
    Math.max(grid.x + i * grid.size - x, 0, x - grid.x - (i + 1) * grid.size),
    Math.max(grid.y + j * grid.size - y, 0, y - grid.y - (j + 1) * grid.size),
  );
  return gap > cut.radius ? -Infinity : grid.top[cell]! - lift(cut, gap);
}

function scan(
  mesh: IndexedMesh,
  cell: number,
  cut: Cutter,
  x: number,
  y: number,
  best: number,
) {
  const { grid, seen, visit } = mesh;
  if (reachOf(grid, cell, cut, x, y, best) <= best) return best;
  for (let n = grid.starts[cell]!; n < grid.starts[cell + 1]!; n++) {
    const t = grid.items[n]!;
    if (seen[t] === visit) continue;
    seen[t] = visit;
    best = triangle(mesh, t, cut, x, y, best);
  }
  return best;
}

export function dropCutter(
  mesh: IndexedMesh,
  tool: Tool,
  x: number,
  y: number,
): number {
  const cut = cutter(tool);
  const { grid } = mesh;
  nextVisit(mesh);
  const [i0, i1] = cellRange(grid, x - cut.radius, x + cut.radius, 0);
  const [j0, j1] = cellRange(grid, y - cut.radius, y + cut.radius, 1);
  let [first, high] = [0, -Infinity];
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const bound = reachOf(grid, j * grid.columns + i, cut, x, y, high);
      if (bound > high) [first, high] = [j * grid.columns + i, bound];
    }
  let best = scan(mesh, first, cut, x, y, -Infinity);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      best = scan(mesh, j * grid.columns + i, cut, x, y, best);
  return best;
}
