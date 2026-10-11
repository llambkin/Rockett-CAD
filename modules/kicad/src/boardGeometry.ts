export const BOARD_LIMITS = { segments: 20_000, work: 1_000_000 } as const;
const JOIN = 1e-3;
export const EPS = 1e-9;
export const TAU = 2 * Math.PI;

export type BoardPoint = [number, number];
export type BoardSegment = { from: BoardPoint; to: BoardPoint } & (
  { kind: "line" } | { kind: "arc"; centre: BoardPoint; sweep: number }
);
export type BoardLoop = BoardSegment[];

export function finite(value: number) {
  if (!Number.isFinite(value))
    fail("Board geometry arithmetic exceeds numeric range");
  return value;
}
export const gap = (a: BoardPoint, b: BoardPoint) =>
  finite(Math.hypot(a[0] - b[0], a[1] - b[1]));
const sub = (a: BoardPoint, b: BoardPoint): BoardPoint => [
  finite(a[0] - b[0]),
  finite(a[1] - b[1]),
];
const cross = (a: BoardPoint, b: BoardPoint) =>
  finite(a[0] * b[1] - a[1] * b[0]);
const dot = (a: BoardPoint, b: BoardPoint) => finite(a[0] * b[0] + a[1] * b[1]);
const turn = (angle: number) => ((angle % TAU) + TAU) % TAU;
const angle = (p: BoardPoint, c: BoardPoint) =>
  Math.atan2(finite(p[1] - c[1]), finite(p[0] - c[0]));
const reverse = (s: BoardSegment): BoardSegment =>
  s.kind === "line"
    ? { ...s, from: s.to, to: s.from }
    : { ...s, from: s.to, to: s.from, sweep: -s.sweep };
export function fail(message: string): never {
  throw new RangeError(message);
}

export function validateSegment(segment: BoardSegment) {
  const d = sub(
    segment.from,
    segment.kind === "arc" ? segment.centre : segment.to,
  );
  dot(d, d);
}

export function circle(centre: BoardPoint, from: BoardPoint): BoardSegment {
  if (gap(centre, from) <= EPS) fail("degenerate circle in Edge.Cuts");
  return { kind: "arc", from, to: from, centre, sweep: -TAU };
}

export function arc(
  from: BoardPoint,
  mid: BoardPoint,
  to: BoardPoint,
): BoardSegment {
  const b = sub(mid, from),
    c = sub(to, from);
  const divisor = finite(2 * cross(b, c));
  if (Math.abs(divisor) <= EPS) fail("degenerate arc in Edge.Cuts");
  const bb = dot(b, b),
    cc = dot(c, c);
  const centre: BoardPoint = [
    finite(from[0] + finite(c[1] * bb - b[1] * cc) / divisor),
    finite(from[1] + finite(b[0] * cc - c[0] * bb) / divisor),
  ];
  const end = turn(angle(to, centre) - angle(from, centre));
  const sweep =
    turn(angle(mid, centre) - angle(from, centre)) < end ? end : end - TAU;
  return { kind: "arc", from, to, centre, sweep };
}

function progress(s: Extract<BoardSegment, { kind: "arc" }>, p: BoardPoint) {
  const delta =
    (angle(p, s.centre) - angle(s.from, s.centre)) * Math.sign(s.sweep);
  const value = turn(delta);
  return TAU - value < EPS ? 0 : value;
}

function on(s: BoardSegment, p: BoardPoint) {
  if (s.kind === "arc")
    return (
      Math.abs(gap(p, s.centre) - gap(s.from, s.centre)) <= EPS &&
      progress(s, p) <= Math.abs(s.sweep) + EPS
    );
  const d = sub(s.to, s.from),
    q = sub(p, s.from),
    length = gap(s.from, s.to),
    projection = dot(q, d);
  return (
    Math.abs(cross(d, q)) <= EPS * length &&
    projection >= -EPS &&
    projection <= finite(length ** 2) + EPS
  );
}

export type BoardBounds = { min: BoardPoint; max: BoardPoint };

export function segmentBounds(segment: BoardSegment): BoardBounds {
  validateSegment(segment);
  const points = [segment.from, segment.to];
  if (segment.kind === "arc") {
    const radius = gap(segment.from, segment.centre);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const point: BoardPoint = [
        finite(segment.centre[0] + dx * radius),
        finite(segment.centre[1] + dy * radius),
      ];
      if (on(segment, point)) points.push(point);
    }
  }
  return {
    min: [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
    ],
    max: [
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ],
  };
}

type Line = Extract<BoardSegment, { kind: "line" }>;
type Arc = Extract<BoardSegment, { kind: "arc" }>;
type Collision = { points: BoardPoint[]; overlap: boolean };

function lineHits(a: Line, b: Line): Collision {
  const d = sub(a.to, a.from),
    e = sub(b.to, b.from),
    q = sub(b.from, a.from);
  const divisor = cross(d, e);
  if (Math.abs(divisor) <= EPS) {
    if (Math.abs(cross(d, q)) > EPS * gap(a.from, a.to))
      return { points: [], overlap: false };
    const axis = Math.abs(d[0]) > Math.abs(d[1]) ? 0 : 1;
    const lower = Math.max(
      Math.min(a.from[axis], a.to[axis]),
      Math.min(b.from[axis], b.to[axis]),
    );
    const upper = Math.min(
      Math.max(a.from[axis], a.to[axis]),
      Math.max(b.from[axis], b.to[axis]),
    );
    return {
      points: [a.from, a.to, b.from, b.to].filter((p) => on(a, p) && on(b, p)),
      overlap: upper - lower > EPS,
    };
  }
  const t = finite(cross(q, e) / divisor),
    u = finite(cross(q, d) / divisor);
  return {
    points:
      t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS
        ? [[finite(a.from[0] + t * d[0]), finite(a.from[1] + t * d[1])]]
        : [],
    overlap: false,
  };
}

function lineArcHits(a: Line, b: Arc): Collision {
  const d = sub(a.to, a.from),
    q = sub(a.from, b.centre);
  const aa = dot(d, d),
    bb = finite(2 * dot(q, d));
  const cc = finite(dot(q, q) - finite(gap(b.from, b.centre) ** 2));
  const discriminant = finite(bb ** 2 - 4 * aa * cc);
  if (discriminant < -EPS) return { points: [], overlap: false };
  const root = Math.sqrt(Math.max(0, discriminant));
  return {
    points: [
      finite((-bb - root) / finite(2 * aa)),
      finite((-bb + root) / finite(2 * aa)),
    ]
      .filter((t) => t >= -EPS && t <= 1 + EPS)
      .map((t): BoardPoint => [
        finite(a.from[0] + t * d[0]),
        finite(a.from[1] + t * d[1]),
      ])
      .filter((p) => on(b, p)),
    overlap: false,
  };
}

function arcHits(a: Arc, b: Arc): Collision {
  const distance = gap(a.centre, b.centre),
    r = gap(a.from, a.centre),
    s = gap(b.from, b.centre);
  if (distance <= EPS && Math.abs(r - s) <= EPS) {
    const midpoint = (segment: typeof a): BoardPoint => {
      const at = angle(segment.from, segment.centre) + segment.sweep / 2;
      const radius = gap(segment.from, segment.centre);
      return [
        finite(segment.centre[0] + radius * Math.cos(at)),
        finite(segment.centre[1] + radius * Math.sin(at)),
      ];
    };
    const interior = (segment: typeof a, p: BoardPoint) =>
      on(segment, p) &&
      (Math.abs(segment.sweep) >= TAU - EPS ||
        (progress(segment, p) > EPS &&
          progress(segment, p) < Math.abs(segment.sweep) - EPS));
    return {
      points: [a.from, a.to, b.from, b.to].filter((p) => on(a, p) && on(b, p)),
      overlap:
        [a.from, a.to, midpoint(a)].some((p) => interior(b, p)) ||
        [b.from, b.to, midpoint(b)].some((p) => interior(a, p)),
    };
  }
  if (
    distance <= EPS ||
    distance > r + s + EPS ||
    distance < Math.abs(r - s) - EPS
  )
    return { points: [], overlap: false };
  const along = finite(
    finite(r ** 2 - s ** 2 + finite(distance ** 2)) / finite(2 * distance),
  );
  const height = Math.sqrt(Math.max(0, finite(r ** 2 - finite(along ** 2))));
  const dx = (b.centre[0] - a.centre[0]) / distance,
    dy = (b.centre[1] - a.centre[1]) / distance;
  return {
    points: [-1, 1]
      .map((sign): BoardPoint => [
        finite(a.centre[0] + along * dx - sign * height * dy),
        finite(a.centre[1] + along * dy + sign * height * dx),
      ])
      .filter((p) => on(a, p) && on(b, p)),
    overlap: false,
  };
}

function hits(a: BoardSegment, b: BoardSegment): Collision {
  if (a.kind === "line")
    return b.kind === "line" ? lineHits(a, b) : lineArcHits(a, b);
  return b.kind === "line" ? lineArcHits(b, a) : arcHits(a, b);
}

function contains(loop: BoardLoop, p: BoardPoint) {
  const only = loop[0];
  if (loop.length === 1 && only?.kind === "arc" && Math.abs(only.sweep) === TAU)
    return gap(p, only.centre) < gap(only.from, only.centre);
  let crossings = 0;
  for (const s of loop) {
    if (s.kind === "line") {
      if (
        s.from[1] > p[1] !== s.to[1] > p[1] &&
        finite(
          s.from[0] +
            finite((p[1] - s.from[1]) * (s.to[0] - s.from[0])) /
              finite(s.to[1] - s.from[1]),
        ) > p[0]
      )
        crossings++;
      continue;
    }
    const radius = gap(s.from, s.centre),
      height = finite(finite(p[1] - s.centre[1]) / radius);
    if (Math.abs(height) > 1) continue;
    const first = Math.asin(height);
    for (const at of Math.abs(height) === 1
      ? [first]
      : [first, Math.PI - first]) {
      const point: BoardPoint = [
        finite(s.centre[0] + radius * Math.cos(at)),
        p[1],
      ];
      if (point[0] <= p[0]) continue;
      const t = progress(s, point),
        end = Math.abs(s.sweep);
      const derivative = Math.cos(at) * Math.sign(s.sweep);
      if (t > EPS && t < end - EPS && Math.abs(derivative) > EPS) crossings++;
      else if (
        t <= EPS &&
        (derivative > EPS || (Math.abs(derivative) <= EPS && height < 0))
      )
        crossings++;
      else if (
        Math.abs(t - end) <= EPS &&
        (derivative < -EPS || (Math.abs(derivative) <= EPS && height < 0))
      )
        crossings++;
    }
  }
  return crossings % 2 === 1;
}

function chain(segments: BoardSegment[], spend: () => void) {
  const nodes: { point: BoardPoint; edges: number[] }[] = [];
  const ends = new Map<number, [number, number]>();
  const loops: BoardLoop[] = [];
  for (const [i, segment] of segments.entries()) {
    if (segment.kind === "arc" && Math.abs(segment.sweep) === TAU) {
      loops.push([segment]);
      continue;
    }
    const pair = [segment.from, segment.to].map((point) => {
      const matches: number[] = [];
      for (const [index, node] of nodes.entries()) {
        spend();
        if (gap(node.point, point) <= JOIN) matches.push(index);
      }
      if (matches.length > 1) fail("Self-intersecting loops in Edge.Cuts");
      const index = matches[0] ?? nodes.length;
      nodes[index] ??= { point, edges: [] };
      nodes[index]!.edges.push(i);
      return index;
    });
    ends.set(i, [pair[0]!, pair[1]!]);
  }
  if (nodes.some((node) => node.edges.length > 2))
    fail("Self-intersecting loops in Edge.Cuts");
  if (nodes.some((node) => node.edges.length !== 2))
    fail("Open chain in Edge.Cuts");
  const pending = new Set(ends.keys());
  while (pending.size) {
    const index = pending.values().next().value!;
    const start = ends.get(index)![0];
    let current = start,
      next = index;
    const loop: BoardLoop = [];
    do {
      spend();
      if (!pending.delete(next)) fail("Self-intersecting loops in Edge.Cuts");
      const [a, b] = ends.get(next)!;
      loop.push(current === a ? segments[next]! : reverse(segments[next]!));
      current = current === a ? b : a;
      next = nodes[current]!.edges.find((edge) => pending.has(edge)) ?? index;
    } while (current !== start);
    if (loop.length === 1 && loop[0]!.kind === "line")
      fail("degenerate outline in Edge.Cuts");
    loops.push(loop);
  }
  return loops;
}

export function boardLoops(segments: BoardSegment[], spend: () => void) {
  const loops = chain(segments, spend);
  const all = loops.flatMap((loop, loopIndex) =>
    loop.map((segment, index) => ({
      segment,
      index,
      loopIndex,
      length: loop.length,
    })),
  );
  for (const [i, a] of all.entries())
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!;
      spend();
      const collision = hits(a.segment, b.segment);
      const adjacent =
        a.loopIndex === b.loopIndex &&
        ((a.index + 1) % a.length === b.index ||
          (b.index + 1) % b.length === a.index);
      const shared = adjacent
        ? [a.segment.from, a.segment.to].filter(
            (p) =>
              gap(p, b.segment.from) <= JOIN || gap(p, b.segment.to) <= JOIN,
          )
        : [];
      if (
        collision.overlap ||
        collision.points.some((p) => !shared.some((q) => gap(p, q) <= JOIN))
      )
        fail("Self-intersecting loops in Edge.Cuts");
    }
  const depths = loops.map((loop, i) =>
    loops.reduce((depth, outer, j) => {
      spend();
      return depth + (i !== j && contains(outer, loop[0]!.from) ? 1 : 0);
    }, 0),
  );
  const outer = depths.flatMap((depth, i) => (depth === 0 ? [i] : []));
  if (outer.length !== 1) fail("Disjoint pieces in Edge.Cuts");
  if (depths.some((depth) => depth > 1))
    fail("Island in a cutout in Edge.Cuts");
  return {
    outline: loops[outer[0]!]!,
    cutouts: loops.filter((_, i) => i !== outer[0]),
  };
}
