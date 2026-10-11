import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  arcSweep,
  validateProgram,
  type Move,
  type Section,
  type Xy,
  type Xyz,
} from "../src/shared/ir.js";
import type { Fixture } from "../src/shared/setup.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import type { Loop } from "../src/toolpath/geometry.js";
import { pocket, type PocketInput } from "../src/toolpath/pocket.js";

const tool: Tool = {
  id: "t1",
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 22,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const preset: Preset = {
  id: "p1",
  name: "MDF pocket",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off",
};

type Rect = [number, number, number, number];

const box = ([x0, y0, x1, y1]: Rect): Loop => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const dumbbell: Loop = [
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
].map(([x, y]) => ({ x: x!, y: y! }));

const base: PocketInput = {
  operationId: "op1",
  setup: { safeHeight: 15, clearance: 3, fixtures: [] },
  stock: { min: [-10, -10, -10], max: [50, 40, 0] },
  boundary: box([0, 0, 40, 30]),
  islands: [],
  bottom: -6,
  rampAngle: 5,
  tool,
  preset,
};

const cut = (changes: Partial<PocketInput>) => pocket({ ...base, ...changes });

const fixture = (name: string, rect: Rect, top: number): Fixture => ({
  name,
  min: [rect[0], rect[1], -10],
  max: [rect[2], rect[3], top],
});

function* travel(moves: Move[]) {
  let at: Xyz | undefined;
  for (const move of moves) {
    if (move.kind !== "rapid" && move.kind !== "feed" && move.kind !== "arc")
      continue;
    if (at) yield { from: at, move };
    at = move.to;
  }
}

function samples(from: Xyz, move: Move): Xyz[] {
  if (move.kind === "rapid" || move.kind === "feed") {
    const to = move.to;
    return Array.from({ length: 51 }, (_, i): Xyz => {
      const t = i / 50;
      return [0, 1, 2].map((k) => from[k]! + t * (to[k]! - from[k]!)) as Xyz;
    });
  }
  if (move.kind !== "arc") return [];
  const [cx, cy] = move.centre;
  const radius = Math.hypot(from[0] - cx, from[1] - cy);
  const start = Math.atan2(from[1] - cy, from[0] - cx);
  const turn = arcSweep(from, move) * (move.dir === "ccw" ? 1 : -1);
  return Array.from({ length: 51 }, (_, i): Xyz => {
    const t = i / 50;
    const angle = start + t * turn;
    return [
      cx + radius * Math.cos(angle),
      cy + radius * Math.sin(angle),
      from[2] + t * (move.to[2] - from[2]),
    ];
  });
}

function outside([x, y]: Xy, [x0, y0, x1, y1]: Rect): number {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
}

function within([x, y]: Xy, [x0, y0, x1, y1]: Rect): number {
  return Math.min(x - x0, x1 - x, y - y0, y1 - y);
}

function belowTop(section: Section): Xyz[] {
  return [...travel(section.moves)]
    .filter(({ move }) => move.kind !== "rapid")
    .flatMap(({ from, move }) => samples(from, move))
    .filter(([, , z]) => z < 0);
}

const plunges = (section: Section) =>
  [...travel(section.moves)].filter(
    ({ move }) => "role" in move && move.role === "plunge",
  );

describe("pocket", () => {
  it("matches the golden IR for a 40 by 30 pocket in two levels with a helix entry", () => {
    const golden = JSON.parse(
      readFileSync(new URL("golden/ir/pocket.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(cut({})).toEqual(golden);
  });

  it("forms a valid program", () => {
    expect(
      validateProgram({
        irVersion: 1,
        units: "mm",
        setupId: "s1",
        offsetIndex: 1,
        tools: [{ ...tool, number: 1 }],
        sections: [cut({})],
      }),
    ).toEqual([]);
  });

  it("keeps every cut move inside the region shrunk by the tool radius", () => {
    const island: Rect = [20, 15, 40, 25];
    for (const [changes, wall, islands] of [
      [{}, [0, 0, 40, 30], []],
      [
        {
          boundary: box([0, 0, 60, 40]),
          islands: [box(island)],
          stock: { min: [-10, -10, -10], max: [70, 50, 0] },
        },
        [0, 0, 60, 40],
        [island],
      ],
    ] as [Partial<PocketInput>, Rect, Rect[]][]) {
      const points = belowTop(cut(changes));
      expect(points.length).toBeGreaterThan(100);
      for (const point of points) {
        const at: Xy = [point[0], point[1]];
        expect(within(at, wall)).toBeGreaterThanOrEqual(3);
        for (const each of islands)
          expect(outside(at, each)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("enters each level by a helix no steeper than the ramp angle, last turn flat on the floor", () => {
    const section = cut({});
    const steepest = Math.tan((5 * Math.PI) / 180);
    const entries = plunges(section).filter(({ move }) => move.kind === "arc");
    expect(entries.length).toBeGreaterThan(0);
    for (const { from, move } of entries) {
      if (move.kind !== "arc") continue;
      const radius = Math.hypot(
        from[0] - move.centre[0],
        from[1] - move.centre[1],
      );
      expect(radius).toBeCloseTo(2.7, 9);
      const run = radius * arcSweep(from, move);
      expect((from[2] - move.to[2]) / run).toBeLessThanOrEqual(steepest);
    }
    for (const z of [-3, -6]) {
      const last =
        entries[entries.map(({ move }) => move.to[2]).lastIndexOf(z)]!;
      const index = section.moves.indexOf(last.move);
      const circle = section.moves.slice(index + 1, index + 3);
      expect(circle.map((move) => move.kind)).toEqual(["arc", "arc"]);
      for (const move of circle) expect("to" in move && move.to[2]).toBe(z);
    }
    const zs = belowTop(section).map(([, , z]) => z);
    expect(Math.min(...zs)).toBe(-6);
  });

  it("ramps along the ring when no helix fits, no steeper than the ramp angle", () => {
    const section = cut({ boundary: box([0, 0, 40, 10]) });
    expect(section.moves.some((move) => move.kind === "arc")).toBe(false);
    const steepest = Math.tan((5 * Math.PI) / 180);
    const ramps = plunges(section).filter(
      ({ from, move }) =>
        "to" in move &&
        Math.hypot(move.to[0] - from[0], move.to[1] - from[1]) > 0,
    );
    expect(ramps.length).toBeGreaterThan(0);
    for (const { from, move } of ramps) {
      if (move.kind !== "feed") continue;
      const run = Math.hypot(move.to[0] - from[0], move.to[1] - from[1]);
      expect((from[2] - move.to[2]) / run).toBeLessThanOrEqual(
        steepest + 1e-12,
      );
    }
  });

  it("rejects a pocket where neither a helix nor a ramp fits", () => {
    expect(() => cut({ boundary: box([0, 0, 10, 8]) })).toThrow(
      "no helix or ramp entry fits",
    );
  });

  it("rejects a stepover that leaves uncut material between rings", () => {
    expect(() => cut({ preset: { ...preset, stepoverFraction: 0.9 } })).toThrow(
      "leaves uncut material between rings",
    );
  });

  it("retracts and enters again where a link would leave cleared area", () => {
    const section = cut({ boundary: dumbbell });
    const helices = section.moves.filter(
      (move) =>
        move.kind === "arc" && move.role === "plunge" && move.to[2] === -3,
    );
    expect(helices.length).toBeGreaterThan(0);
    const starts = new Set(
      plunges(section)
        .filter(({ move }) => move.kind === "arc")
        .map(({ move }) => move.kind === "arc" && move.centre[0] < 25),
    );
    expect(starts).toEqual(new Set([true, false]));
    for (const { from, move } of travel(section.moves))
      if (move.kind !== "rapid" && from[2] < 0 && "to" in move)
        expect(
          (from[0] < 20 && move.to[0] > 30) ||
            (from[0] > 30 && move.to[0] < 20),
        ).toBe(false);
    const corners: Xy[] = [
      [20, 8],
      [20, 12],
      [30, 8],
      [30, 12],
    ];
    for (const [x, y] of belowTop(section)) {
      expect(x < 20 || x > 30).toBe(true);
      for (const corner of corners)
        expect(Math.hypot(x - corner[0], y - corner[1])).toBeGreaterThanOrEqual(
          3,
        );
    }
  });

  it("rejects a cut within the clearance of a fixture, naming it", () => {
    expect(() =>
      cut({
        setup: {
          ...base.setup,
          fixtures: [fixture("toe clamp 1", [42, 10, 46, 20], 5)],
        },
      }),
    ).toThrow("toe clamp 1");
  });

  it("raises a clearance rapid over a fixture to its top plus the clearance", () => {
    const changes = {
      boundary: dumbbell,
      stock: { min: [-10, -10, -10], max: [60, 30, 0] } as PocketInput["stock"],
    };
    const clear = cut(changes);
    const crossing = (section: Section) =>
      [...travel(section.moves)].filter(
        ({ from, move }) =>
          move.kind === "rapid" &&
          ((from[0] < 20 && move.to[0] > 30) ||
            (from[0] > 30 && move.to[0] < 20)),
      );
    expect(crossing(clear).length).toBeGreaterThan(0);
    for (const { move } of crossing(clear)) expect(move.to[2]).toBe(3);
    const clamped = cut({
      ...changes,
      setup: {
        ...base.setup,
        fixtures: [fixture("strap", [24, -5, 26, 25], 5)],
      },
    });
    expect(crossing(clamped).length).toBe(crossing(clear).length);
    for (const { move } of crossing(clamped)) expect(move.to[2]).toBe(8);
    expect(() =>
      cut({
        ...changes,
        setup: {
          ...base.setup,
          fixtures: [fixture("strap", [24, -5, 26, 25], 14)],
        },
      }),
    ).toThrow("strap reaches above the safe height");
  });

  it("shares the contour tool and setup checks", () => {
    expect(() => cut({ tool: { ...tool, kind: "ball" } })).toThrow(
      "pocket needs a flat or bull end mill, not a ball",
    );
    expect(() => cut({ bottom: -22.5 })).toThrow(
      "a 22.5 mm deep cut is past the 22 mm flute length of 6 mm flat",
    );
    expect(() => cut({ setup: { ...base.setup, clearance: 0 } })).toThrow(
      "clearance must be above 0",
    );
    for (const rampAngle of [0, 90, Number.NaN])
      expect(() => cut({ rampAngle })).toThrow(
        "ramp angle must be at least 0.5 and below 90 degrees",
      );
  });

  it("rejects a tool that does not fit the pocket", () => {
    expect(() => cut({ boundary: box([0, 0, 5, 30]) })).toThrow(
      "the 6 mm tool does not fit the pocket",
    );
  });
});
