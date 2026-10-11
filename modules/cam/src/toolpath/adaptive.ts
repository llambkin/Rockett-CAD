import type { RegionLoop } from "../kernel/regions.js";
import type { Section, Xy, Xyz } from "../shared/ir.js";
import { adaptiveClear, type AdaptiveRegion } from "./adaptiveEngine.js";
import {
  PIECE,
  append,
  bandOf,
  checkMoves,
  chorded,
  covers,
  disc,
  gap,
  lines,
  pass,
  startAt,
  subtractLoops,
  swathOf,
  unionLoops,
  type Loop,
  type Motion,
} from "./geometry.js";
import {
  HELIX,
  PROOF,
  approach,
  covered,
  enter,
  entryFor,
  finish,
  inRoom,
  link,
  linkRole,
  point,
  shapeOf,
  type Entry,
  type Pocket,
  type PocketInput,
  type Role,
} from "./pocket.js";

export type AdaptiveCut = PocketInput & {
  engine: WebAssembly.Module;
  engagement: number;
};

type Stroke =
  | { kind: "enter"; ring: RegionLoop; entry: Entry }
  | { kind: "lift"; to: Xy }
  | { kind: "move"; to: Xy; role: Role }
  | { kind: "ring"; ring: RegionLoop };

const UNDER = 0.7;
const TOLERANCE = 0.1;
const KEEP_DOWN = 3;
const LEAVE = 0.01;

const xy = ({ x, y }: { x: number; y: number }): Xy => [x, y];

function trail(from: Xy, points: Xy[]): Xy[] {
  const out = [from];
  for (const p of points) if (gap(out.at(-1)!, p) > PIECE) out.push(p);
  return out;
}

function circle(centre: Xy, start: Xy): RegionLoop {
  const across: Xy = [2 * centre[0] - start[0], 2 * centre[1] - start[1]];
  return {
    start,
    segments: [
      { kind: "arc", to: across, centre, dir: "ccw" },
      { kind: "arc", to: start, centre, dir: "ccw" },
    ],
  };
}

function hop(route: Xy[], ahead: Loop[], cleared: Loop[], shape: Pocket) {
  const moves: Stroke[] = [];
  for (const [i, to] of route.slice(1).entries()) {
    const role = linkRole(route[i]!, to, ahead, cleared, shape);
    if (!role) return [];
    moves.push({ kind: "move", to, role });
  }
  return moves;
}

function plan(regions: AdaptiveRegion[], region: Loop[], shape: Pocket) {
  const { radius, walls } = shape;
  const strokes: Stroke[] = [];
  let cleared: Loop[] = [];
  let at: Xy | undefined;
  const entered = (ring: RegionLoop, entry: Entry) => {
    strokes.push({ kind: "enter", ring, entry });
    if (entry.kind === "helix")
      cleared = unionLoops([
        ...cleared,
        ...bandOf(chorded(circle(entry.centre, ring.start)), radius),
      ]);
  };
  const descend = (ring: RegionLoop) => {
    const to = ring.start;
    if (covers(cleared, [disc(to, radius - PROOF)])) {
      strokes.push({ kind: "lift", to });
      return;
    }
    const entry = entryFor(ring, shape);
    const trace = [to, ...ring.segments.map((segment) => segment.to)];
    if (entry.kind === "ramp" && !inRoom(trace, shape))
      throw new RangeError(
        "the adaptive ramp entry leaves the tool centre region",
      );
    entered(ring, entry);
  };
  const reach = (route: Xy[], swath: Loop[], ring: RegionLoop) => {
    if (route.length < 2) return;
    const ahead = unionLoops([...cleared, ...swath]);
    const moves = hop(route, ahead, cleared, shape);
    if (moves.length) append(strokes, moves);
    else descend(ring);
  };
  for (const found of regions) {
    const centre = xy(found.helixCentre);
    const start = xy(found.start);
    if (!covers(walls, [disc(centre, gap(start, centre))]))
      throw new RangeError(
        "the adaptive helix entry leaves the tool centre region",
      );
    entered(circle(centre, start), { kind: "helix", centre });
    at = start;
    let hops: Xy[] = [];
    for (const path of found.paths) {
      const points = path.points.map(xy);
      if (path.motion !== "cut") {
        append(hops, points);
        continue;
      }
      const route = trail(at, hops);
      const chain = trail(route.at(-1)!, points);
      const swath = swathOf(chain.map(point), radius);
      if (!inRoom(chain, shape))
        throw new RangeError("the adaptive path leaves the tool centre region");
      reach(route, swath, lines(chain.map(point)));
      for (const to of chain.slice(1))
        strokes.push({ kind: "move", to, role: "cut" });
      cleared = unionLoops([...cleared, ...swath]);
      at = chain.at(-1)!;
      hops = [];
    }
  }
  for (const points of walls) {
    const ring = at ? startAt(lines(points), at) : lines(points);
    const band = bandOf(points, radius);
    if (at) reach([at, ring.start], band, ring);
    else descend(ring);
    strokes.push({ kind: "ring", ring });
    cleared = unionLoops([...cleared, ...band]);
    at = ring.start;
  }
  covered(cleared, region, shape);
  return strokes;
}

function level(
  z: number,
  from: number,
  strokes: Stroke[],
  shape: Pocket,
  at: Xyz | undefined,
) {
  const { cutFeed, plungeFeed } = shape.input.preset;
  const moves: Motion[] = [];
  for (const stroke of strokes) {
    const last = moves.at(-1)?.to ?? at;
    if (stroke.kind === "enter") {
      append(moves, approach(last, stroke.ring.start, from, shape));
      append(moves, enter(stroke.ring, stroke.entry, from, z, shape));
    } else if (stroke.kind === "lift") {
      append(moves, approach(last, stroke.to, from, shape));
      moves.push({
        kind: "feed",
        to: [...stroke.to, z],
        feed: plungeFeed,
        role: "plunge",
      });
    } else if (stroke.kind === "move")
      moves.push(link(stroke.to, z, shape, stroke.role));
    else append(moves, pass(stroke.ring, z, cutFeed));
  }
  return moves;
}

export function adaptive(input: AdaptiveCut): Section {
  const { stock, tool, engagement } = input;
  if (!(engagement > 0 && engagement <= 180))
    throw new RangeError(
      "maximum engagement must be above 0 and at most 180 degrees",
    );
  const factor = (UNDER * (1 - Math.cos((engagement * Math.PI) / 180))) / 2;
  const region = subtractLoops([input.boundary], input.islands);
  const shape = shapeOf(input, region, factor);
  const { levels } = shape;
  const top = stock.max[2];
  const [x0, y0] = stock.min;
  const [x1, y1] = stock.max;
  const strokes = plan(
    adaptiveClear(input.engine, {
      stock: [
        [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      ],
      region,
      cleared: [],
      operation: "clearingInside",
      toolDiameter: tool.diameter,
      stepOverFactor: factor,
      tolerance: TOLERANCE,
      stockToLeave: LEAVE,
      helixRampTargetDiameter: 2 * HELIX * tool.diameter,
      helixRampMinDiameter: 0,
      forceInsideOut: true,
      finishingProfile: false,
      keepToolDownDistRatio: KEEP_DOWN,
    }),
    region,
    shape,
  );
  const moves: Motion[] = [];
  for (const [l, z] of levels.entries()) {
    const from = l ? levels[l - 1]! : top;
    append(moves, level(z, from, strokes, shape, moves.at(-1)?.to));
    checkMoves(
      `adaptive at depth level ${l + 1} of ${levels.length}`,
      moves.length,
    );
  }
  return finish(moves, shape);
}
