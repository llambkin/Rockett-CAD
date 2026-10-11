import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RegionLoop } from "../src/kernel/regions.js";
import {
  arcSweep,
  validateProgram,
  type Move,
  type Section,
  type Xy,
  type Xyz,
} from "../src/shared/ir.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import { adaptive, type AdaptiveCut } from "../src/toolpath/adaptive.js";
import {
  append,
  area,
  chorded,
  covers,
  disc,
  lines,
  offsetLoops,
  subtractLoops,
  swathOf,
  unionLoops,
  type Loop,
} from "../src/toolpath/geometry.js";
import { WALL } from "../src/toolpath/pocket.js";

const engine = new WebAssembly.Module(
  readFileSync(new URL("../wasm/adaptive/adaptive.wasm", import.meta.url)),
);

const tool: Tool = {
  id: "t10",
  name: "10 mm flat",
  kind: "flat",
  diameter: 10,
  fluteLength: 22,
  overallLength: 60,
  shankDiameter: 10,
  flutes: 3,
  centreCutting: true,
};

const preset: Preset = {
  id: "p1",
  name: "MDF adaptive",
  rpm: 18000,
  cutFeed: 2000,
  plungeFeed: 300,
  rampFeed: 600,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off",
};

const [W, H, R] = [40, 30, 8];

const rounded: RegionLoop = {
  start: [R, 0],
  segments: [
    { kind: "line", to: [W - R, 0] },
    { kind: "arc", to: [W, R], centre: [W - R, R], dir: "ccw" },
    { kind: "line", to: [W, H - R] },
    { kind: "arc", to: [W - R, H], centre: [W - R, H - R], dir: "ccw" },
    { kind: "line", to: [R, H] },
    { kind: "arc", to: [0, H - R], centre: [R, H - R], dir: "ccw" },
    { kind: "line", to: [0, R] },
    { kind: "arc", to: [R, 0], centre: [R, R], dir: "ccw" },
  ],
};

const base: AdaptiveCut = {
  operationId: "op1",
  setup: { safeHeight: 15, clearance: 3, fixtures: [] },
  stock: { min: [-10, -10, -10], max: [50, 40, 0] },
  boundary: chorded(rounded),
  islands: [],
  bottom: -6,
  rampAngle: 5,
  tool,
  preset,
  engine,
  engagement: 60,
};

const cut = (changes: Partial<AdaptiveCut> = {}) =>
  adaptive({ ...base, ...changes });

const section = cut();

const square = (x0: number, y0: number, x1: number, y1: number): Loop => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const small: Partial<AdaptiveCut> = {
  boundary: square(0, 0, 24, 18),
  bottom: -3,
  engagement: 90,
};

const dumbbell: Partial<AdaptiveCut> = {
  boundary: [
    [0, 0],
    [20, 0],
    [20, 8],
    [30, 8],
    [30, 0],
    [50, 0],
    [50, 20],
    [30, 20],
    [30, 12],
    [20, 12],
    [20, 20],
    [0, 20],
  ].map(([x, y]) => ({ x: x!, y: y! })),
  bottom: -3,
  tool: { ...tool, id: "t6", name: "6 mm flat", diameter: 6, shankDiameter: 6 },
};

const r = tool.diameter / 2;

type Fixture = {
  section: Section;
  boundary: Loop;
  radius: number;
  size: Xy;
  levels: number[];
};

const wide: Fixture = {
  section,
  boundary: base.boundary,
  radius: r,
  size: [W, H],
  levels: [-3, -6],
};

const narrow: Fixture = {
  section: cut(dumbbell),
  boundary: dumbbell.boundary!,
  radius: 3,
  size: [50, 20],
  levels: [-3],
};

const fixtures = [wide, narrow];

function travel(moves: Move[]) {
  const out: { from: Xyz; move: Extract<Move, { to: Xyz }> }[] = [];
  let at: Xyz | undefined;
  for (const move of moves) {
    if (move.kind !== "rapid" && move.kind !== "feed" && move.kind !== "arc")
      continue;
    if (at) out.push({ from: at, move });
    at = move.to;
  }
  return out;
}

type Trip = ReturnType<typeof travel>;

type Sample = { at: Xy; heading: Xy };

function samples(from: Xyz, move: Move, step: number): Sample[] {
  if (move.kind === "feed") {
    const [dx, dy] = [move.to[0] - from[0], move.to[1] - from[1]];
    const length = Math.hypot(dx, dy);
    if (!length) return [];
    const count = Math.ceil(length / step);
    return Array.from({ length: count }, (_, i) => ({
      at: [from[0] + (dx * (i + 1)) / count, from[1] + (dy * (i + 1)) / count],
      heading: [dx / length, dy / length],
    }));
  }
  if (move.kind !== "arc") return [];
  const [cx, cy] = move.centre;
  const radius = Math.hypot(from[0] - cx, from[1] - cy);
  const begin = Math.atan2(from[1] - cy, from[0] - cx);
  const sign = move.dir === "ccw" ? 1 : -1;
  const turn = arcSweep(from, move);
  const count = Math.ceil((radius * turn) / step);
  return Array.from({ length: count }, (_, i) => {
    const angle = begin + (sign * turn * (i + 1)) / count;
    return {
      at: [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)],
      heading: [-sign * Math.sin(angle), sign * Math.cos(angle)],
    };
  });
}

const CELL = 0.05;
const DIAGONAL = CELL * Math.SQRT2;
const SLACK = DIAGONAL / 2;

const reachOf = ({ boundary, radius }: Fixture) =>
  offsetLoops(offsetLoops([boundary], -(radius + WALL)), radius);

function fill(grid: Uint8Array, nx: number, j: number, x0: number, x1: number) {
  const i0 = Math.max(0, Math.ceil(x0 / CELL - 0.5));
  const i1 = Math.min(nx - 1, Math.floor(x1 / CELL - 0.5));
  if (i1 >= i0) grid.fill(1, j * nx + i0, j * nx + i1 + 1);
}

function raster(loops: Loop[], nx: number, ny: number) {
  const grid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = (j + 0.5) * CELL;
    const xs: number[] = [];
    for (const loop of loops)
      for (const [k, a] of loop.entries()) {
        const b = loop[(k + 1) % loop.length]!;
        if (a.y > y !== b.y > y)
          xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      fill(grid, nx, j, xs[k]!, xs[k + 1]!);
  }
  return grid;
}

function engagement(fixture: Fixture) {
  const { radius, size } = fixture;
  const [nx, ny] = [Math.round(size[0] / CELL), Math.round(size[1] / CELL)];
  const material = raster(offsetLoops(reachOf(fixture), -DIAGONAL), nx, ny);
  const stamp = (cleared: Uint8Array, [px, py]: Xy) => {
    const reach = radius - SLACK;
    const j0 = Math.max(0, Math.ceil((py - reach) / CELL - 0.5));
    const j1 = Math.min(ny - 1, Math.floor((py + reach) / CELL - 0.5));
    for (let j = j0; j <= j1; j++) {
      const half = Math.sqrt(
        Math.max(0, reach ** 2 - ((j + 0.5) * CELL - py) ** 2),
      );
      fill(cleared, nx, j, px - half, px + half);
    }
  };
  const engaged = (cleared: Uint8Array, { at, heading }: Sample) => {
    const ahead = Math.atan2(heading[1], heading[0]);
    let count = 0;
    for (let k = -180; k <= 180; k++) {
      const angle = ahead + (k * Math.PI) / 360;
      const x = at[0] + radius * Math.cos(angle);
      const y = at[1] + radius * Math.sin(angle);
      const [i, j] = [Math.floor(x / CELL), Math.floor(y / CELL)];
      const inside = i >= 0 && j >= 0 && i < nx && j < ny;
      if (inside && material[j * nx + i] && !cleared[j * nx + i]) count++;
    }
    return count / 2;
  };
  const top = base.stock.max[2];
  const grids = new Map<number, Uint8Array>();
  let worst = 0;
  let lap = 0;
  for (const { from, move } of travel(fixture.section.moves)) {
    const z = move.to[2];
    const descent = move.kind === "arc" && z < from[2];
    if (move.kind === "rapid" || z !== from[2] || z >= top) {
      lap = descent ? 2 : 0;
      continue;
    }
    const entry = move.kind === "arc" && lap-- > 0;
    const grid = grids.get(z) ?? new Uint8Array(nx * ny);
    grids.set(z, grid);
    for (const sample of samples(from, move, CELL)) {
      const angle = engaged(grid, sample);
      if (!entry) worst = Math.max(worst, angle);
      stamp(grid, sample.at);
    }
  }
  return worst;
}

function path(from: Xyz, move: Move): Loop {
  return [
    { x: from[0], y: from[1] },
    ...samples(from, move, 0.25).map(({ at: [x, y] }) => ({ x, y })),
  ];
}

const areaOf = (loops: Loop[]) =>
  loops.reduce((sum, loop) => sum + area(lines(loop)), 0);

function chains(trip: Trip, z: number) {
  const found: { chain: Loop; link: boolean }[] = [];
  let chain: Loop = [];
  for (const { from, move } of trip) {
    const flat = move.kind !== "rapid" && from[2] === z;
    const link = flat && "role" in move && move.role === "link";
    if (!flat || link) {
      if (chain.length) found.push({ chain, link: false });
      chain = [];
    }
    if (link) found.push({ chain: path(from, move), link });
    else if (flat) {
      const points = path(from, move);
      append(chain, chain.length ? points.slice(1) : points);
    }
  }
  if (chain.length) found.push({ chain, link: false });
  return found;
}

const swept = (trip: Trip, z: number, radius: number) =>
  unionLoops(chains(trip, z).flatMap(({ chain }) => swathOf(chain, radius)));

function run(from: Xyz, move: Trip[number]["move"]) {
  if (move.kind === "arc")
    return (
      Math.hypot(from[0] - move.centre[0], from[1] - move.centre[1]) *
      arcSweep(from, move)
    );
  return Math.hypot(move.to[0] - from[0], move.to[1] - from[1]);
}

function unproven({ section: cutSection, radius }: Fixture) {
  const top = base.stock.max[2];
  const steepest = Math.tan((base.rampAngle * Math.PI) / 180);
  const trip = travel(cutSection.moves);
  return trip
    .filter(({ from, move }, i) => {
      const z = move.to[2];
      if (move.kind === "rapid" || z >= Math.min(from[2], top)) return false;
      const sideways = run(from, move);
      if (sideways > 0) return from[2] - z > steepest * sideways + 1e-9;
      return !covers(swept(trip.slice(0, i), z, radius), [
        disc([move.to[0], move.to[1]], radius - 5e-3),
      ]);
    })
    .map(({ from, move }) => ({ from, to: move.to }));
}

describe("adaptive", () => {
  it("enters each level by a helix, descends no steeper than the ramp angle and plunges straight only onto area cleared at that depth", () => {
    for (const fixture of fixtures) {
      for (const z of fixture.levels)
        expect(
          travel(fixture.section.moves).some(
            ({ move }) =>
              move.kind === "arc" && move.role === "plunge" && move.to[2] === z,
          ),
        ).toBe(true);
      expect(unproven(fixture)).toEqual([]);
    }
  });

  it("engages at most 65 degrees outside the helix laps at a 60 degree maximum and clears the tool-radius region", () => {
    expect(engagement(wide)).toBeLessThanOrEqual(65);
    for (const fixture of fixtures) {
      const { section: cutSection, radius, levels } = fixture;
      const reach = reachOf(fixture);
      const trip = travel(cutSection.moves);
      for (const z of levels) {
        const cleared = swept(trip, z, radius);
        const error =
          areaOf(subtractLoops(reach, cleared)) +
          areaOf(subtractLoops(cleared, reach));
        expect(error).toBeLessThan(1e-3);
      }
    }
  });

  it("engages at most 65 degrees in the dumbbell's square corners and neck", () => {
    expect(engagement(narrow)).toBeLessThanOrEqual(65);
  });

  it("matches the golden IR for a 24 by 18 mm pocket at a 90 degree maximum", () => {
    const golden = JSON.parse(
      readFileSync(new URL("golden/ir/adaptive.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(cut(small)).toEqual(golden);
  });

  it("forms a valid program", () => {
    expect(
      validateProgram({
        irVersion: 1,
        units: "mm",
        setupId: "s1",
        offsetIndex: 1,
        tools: [{ ...tool, number: 1 }],
        sections: [section],
      }),
    ).toEqual([]);
  });

  it("ends each level with the exact wall ring", () => {
    const [walls] = offsetLoops([base.boundary], -(r + WALL));
    const ring = new Set(walls!.map(({ x, y }) => `${x},${y}`));
    for (const z of wide.levels) {
      const flat = travel(section.moves).filter(
        ({ from, move }) => move.kind === "feed" && from[2] === z,
      );
      const last = new Set(
        flat
          .slice(-ring.size - 1)
          .map(({ move }) => "to" in move && `${move.to[0]},${move.to[1]}`),
      );
      for (const vertex of ring) expect(last.has(vertex)).toBe(true);
    }
  });

  it("keeps every link inside area cleared at its depth and retracts where it cannot", () => {
    const { radius } = narrow;
    let cleared: Loop[] = [];
    let links = 0;
    for (const { chain, link } of chains(travel(narrow.section.moves), -3)) {
      if (link) {
        expect(covers(cleared, swathOf(chain, radius - 5e-3))).toBe(true);
        links++;
      }
      cleared = unionLoops([...cleared, ...swathOf(chain, radius)]);
    }
    expect(links).toBeGreaterThan(0);
    const lifts = travel(narrow.section.moves).filter(
      ({ from, move }, i, all) =>
        move.kind === "feed" &&
        move.role === "plunge" &&
        move.to[2] === -3 &&
        all[i - 1]?.move.kind === "feed" &&
        from[2] === 0,
    );
    expect(lifts.length).toBeGreaterThan(0);
  });

  it("refuses an engagement out of range and a cut near a fixture", () => {
    for (const angle of [0, 200, Number.NaN])
      expect(() => cut({ engagement: angle })).toThrow(
        "maximum engagement must be above 0 and at most 180 degrees",
      );
    expect(() => cut({ engagement: 20 })).toThrow(
      "stepover fraction must be at least 0.05",
    );
    expect(() =>
      cut({
        setup: {
          ...base.setup,
          fixtures: [
            { name: "toe clamp", min: [30, 10, -10], max: [36, 20, 5] },
          ],
        },
      }),
    ).toThrow("toe clamp");
  });
});
