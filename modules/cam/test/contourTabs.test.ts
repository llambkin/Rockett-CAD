import { describe, expect, it } from "vitest";
import type { RegionLoop } from "../src/kernel/regions.js";
import {
  arcSweep,
  validateProgram,
  type Move,
  type Xy,
  type Xyz,
} from "../src/shared/ir.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import { contour, type ContourInput } from "../src/toolpath/contour.js";
import {
  bandOf,
  components,
  pass,
  subtractLoops,
  swathOf,
  type Loop,
} from "../src/toolpath/geometry.js";

const RADIUS = 3;
const STEP = 0.05;

const tool: Tool = {
  id: "t1",
  name: "6 mm flat",
  kind: "flat",
  diameter: 2 * RADIUS,
  fluteLength: 22,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const preset: Preset = {
  id: "p1",
  name: "MDF profile",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 1.5,
  stepoverFraction: 0.5,
  coolant: "off",
};

const part: RegionLoop = {
  start: [5, 0],
  segments: [
    { kind: "line", to: [35, 0] },
    { kind: "arc", to: [40, 5], centre: [35, 5], dir: "ccw" },
    { kind: "line", to: [40, 25] },
    { kind: "arc", to: [35, 30], centre: [35, 25], dir: "ccw" },
    { kind: "line", to: [5, 30] },
    { kind: "arc", to: [0, 25], centre: [5, 25], dir: "ccw" },
    { kind: "line", to: [0, 5] },
    { kind: "arc", to: [5, 0], centre: [5, 5], dir: "ccw" },
  ],
};

const outside: RegionLoop = {
  start: [5, -3],
  segments: [
    { kind: "line", to: [35, -3] },
    { kind: "arc", to: [43, 5], centre: [35, 5], dir: "ccw" },
    { kind: "line", to: [43, 25] },
    { kind: "arc", to: [35, 33], centre: [35, 25], dir: "ccw" },
    { kind: "line", to: [5, 33] },
    { kind: "arc", to: [-3, 25], centre: [5, 25], dir: "ccw" },
    { kind: "line", to: [-3, 5] },
    { kind: "arc", to: [5, -3], centre: [5, 5], dir: "ccw" },
  ],
};

const ring = (r: number): RegionLoop => ({
  start: [r, 0],
  segments: [{ kind: "arc", to: [r, 0], centre: [0, 0], dir: "ccw" }],
});

const plain: ContourInput = {
  operationId: "op1",
  setup: { safeHeight: 15, clearance: 3 },
  stock: { min: [-10, -10, -10], max: [50, 40, 0] },
  loop: part,
  side: "outside",
  direction: "climb",
  bottom: -6,
  start: [-10, -10],
  tool,
  preset,
};

const base: ContourInput = {
  ...plain,
  tabs: { count: 4, width: 3, height: 4 },
};

const TAB_TOP = -2;

const cut = (changes: Partial<ContourInput>, path = outside) =>
  contour({ ...base, ...changes }, () => [path]);

function samples(moves: Move[]): Xyz[] {
  const out: Xyz[] = [];
  let at: Xyz | undefined;
  for (const move of moves) {
    if (!("to" in move)) continue;
    if (at && move.kind === "arc") {
      const [cx, cy] = move.centre;
      const radius = Math.hypot(at[0] - cx, at[1] - cy);
      const turn = arcSweep(at, move) * (move.dir === "ccw" ? 1 : -1);
      const start = Math.atan2(at[1] - cy, at[0] - cx);
      const count = Math.ceil((radius * Math.abs(turn)) / STEP);
      for (let i = 1; i <= count; i++) {
        const angle = start + (turn * i) / count;
        out.push([
          cx + radius * Math.cos(angle),
          cy + radius * Math.sin(angle),
          at[2] + ((move.to[2] - at[2]) * i) / count,
        ]);
      }
      out[out.length - 1] = move.to;
    } else if (at) {
      const count = Math.max(
        1,
        Math.ceil(Math.hypot(...move.to.map((v, i) => v - at![i]!)) / STEP),
      );
      for (let i = 1; i <= count; i++)
        out.push(
          move.to.map((v, k) => at![k]! + ((v - at![k]!) * i) / count) as Xyz,
        );
      out[out.length - 1] = move.to;
    } else out.push(move.to);
    at = move.to;
  }
  return out;
}

function centreLine(path: RegionLoop): Loop {
  return samples([
    { kind: "rapid", to: [...path.start, 0] },
    ...pass(path, 0, 1),
  ]).map(([x, y]) => ({ x, y }));
}

function cutBelow(moves: Move[], height: number): Loop[] {
  const runs: Loop[] = [[]];
  for (const [x, y, z] of samples(moves))
    if (z <= height + 1e-9) runs.at(-1)!.push({ x, y });
    else if (runs.at(-1)!.length) runs.push([]);
  return runs
    .filter((run) => run.length)
    .flatMap((run) =>
      swathOf(
        run.length > 1 ? run : [run[0]!, { x: run[0]!.x + 1e-4, y: run[0]!.y }],
        RADIUS,
      ),
    );
}

function material(moves: Move[], path: RegionLoop, height: number) {
  const band = bandOf(centreLine(path), RADIUS - 0.01);
  return components(subtractLoops(band, cutBelow(moves, height)));
}

function inside(loop: Loop, [x, y]: Xy): boolean {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!;
    const b = loop[j]!;
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      hit = !hit;
  }
  return hit;
}

function across(loop: Loop, a: Xy, b: Xy): number {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const count = Math.ceil(length / 0.0005);
  let hits = 0;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    if (inside(loop, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]))
      hits++;
  }
  return (hits * length) / count;
}

function tabEnds(moves: Move[]): [Xy, Xy][] {
  const ends: [Xy, Xy][] = [];
  let at: Xyz | undefined;
  let start: Xy | undefined;
  let end: Xy | undefined;
  for (const move of moves) {
    if (!("to" in move)) continue;
    const [x, y, z] = move.to;
    if (at && move.kind === "feed" && x === at[0] && y === at[1] && z > at[2])
      start = [x, y];
    if (start && z === TAB_TOP) end = [x, y];
    if (start && end && z < TAB_TOP) {
      ends.push([start, end]);
      start = end = undefined;
    }
    at = move.to;
  }
  return ends;
}

function keepsTabs(moves: Move[], path: RegionLoop) {
  const ends = tabEnds(moves);
  expect(ends).toHaveLength(12);
  for (const [i, pair] of ends.entries()) expect(pair).toEqual(ends[i % 4]);
  for (const height of [-6, -5.25, -4.5, -3.75, -3, -2.5, TAB_TOP - 0.001]) {
    const tabs = material(moves, path, height);
    expect(tabs).toHaveLength(4);
    for (const [a, b] of ends.slice(0, 4)) {
      const middle: Xy = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const holding = tabs.filter(([outer]) => inside(outer!, middle));
      expect(holding).toHaveLength(1);
      expect(across(holding[0]![0]!, a, b)).toBeCloseTo(3, 2);
    }
  }
  expect(material(moves, path, TAB_TOP + 0.001)).toHaveLength(0);
}

const secondLevel = (moves: Move[]) =>
  moves.findIndex(
    (move, i) => i > 2 && move.kind === "feed" && move.role === "plunge",
  );

describe("contour tabs", () => {
  it("keeps four 3 mm wide, 4 mm high tabs intact on every pass below the tab top", () => {
    const { moves } = cut({});
    keepsTabs(moves, outside);
  });

  it("cuts the passes above the tab top as an untabbed contour does", () => {
    const tabbed = cut({}).moves;
    const untabbed = contour(plain, () => [outside]).moves;
    expect(tabbed.slice(0, secondLevel(tabbed))).toEqual(
      untabbed.slice(0, secondLevel(untabbed)),
    );
  });

  it("drops beside a tab only through cut stock and ramps at the ramp feed", () => {
    const { moves } = cut({});
    const entry = moves[2]!;
    const deepest = new Map<string, number>();
    let at: Xyz | undefined;
    for (const move of moves) {
      if (!("to" in move)) continue;
      const [x, y, z] = move.to;
      if (at && z < at[2] && move.kind !== "rapid") {
        const still = x === at[0] && y === at[1];
        if (still && move.role === "plunge")
          expect([x, y]).toEqual("to" in entry && entry.to.slice(0, 2));
        else if (still)
          expect(z).toBeGreaterThanOrEqual(deepest.get(`${x},${y}`)!);
        else expect(move).toMatchObject({ role: "plunge", feed: 500 });
        if (!still) expect(at[2] - z).toBeLessThanOrEqual(preset.stepdown);
      }
      const key = `${x},${y}`;
      deepest.set(key, Math.min(z, deepest.get(key) ?? Infinity));
      at = move.to;
    }
  });

  it("splits the arcs of a round part exactly at the tab ends", () => {
    const path = ring(23);
    const section = cut({ loop: ring(20), start: [0, -40] }, path);
    keepsTabs(section.moves, path);
    for (const move of section.moves)
      if (move.kind === "arc") {
        expect(move.centre.slice(0, 2)).toEqual([0, 0]);
        expect(Math.hypot(move.to[0], move.to[1])).toBeCloseTo(23, 9);
      }
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

  it("refuses tabs that cannot sit a tool radius clear of corners and the start point", () => {
    expect(() => cut({ start: [-10, 15] })).toThrow(
      "4 evenly spaced tabs do not fit: each lifted span must lie on one line or arc of the path, 3 mm clear of every corner and of the start point",
    );
  });

  it("refuses more tabs than the path has room for", () => {
    expect(() => cut({ tabs: { count: 20, width: 3, height: 4 } })).toThrow(
      "20 tabs do not fit on the 150.265 mm path: each lifts over its 3 mm width plus the 6 mm tool diameter, then ramps down over another tool diameter",
    );
  });

  it("refuses a tab that reaches the stock top and tab sizes that are not positive", () => {
    expect(() => cut({ tabs: { count: 4, width: 3, height: 6 } })).toThrow(
      "a 6 mm tab reaches the stock top: the cut is only 6 mm deep",
    );
    for (const [tabs, message] of [
      [
        { count: 0, width: 3, height: 4 },
        "tab count must be a whole number above 0",
      ],
      [
        { count: 2.5, width: 3, height: 4 },
        "tab count must be a whole number above 0",
      ],
      [{ count: 4, width: 0, height: 4 }, "tab width must be above 0"],
      [{ count: 4, width: 3, height: -1 }, "tab height must be above 0"],
    ] as const)
      expect(() => cut({ tabs })).toThrow(message);
  });
});
