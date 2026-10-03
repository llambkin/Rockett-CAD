import { describe, expect, it } from "vitest";
import {
  programStats,
  validateProgram,
  type Move,
  type Program,
} from "../src/shared/ir.js";

const tool = {
  id: "t1",
  number: 1,
  name: "6 mm flat",
  kind: "flat" as const,
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

function program(moves: Move[]): Program {
  return {
    irVersion: 1,
    units: "mm",
    setupId: "s1",
    offsetIndex: 1,
    tools: [tool],
    sections: [
      {
        operationId: "op1",
        toolId: "t1",
        pass: "rough",
        spindle: { rpm: 18000, dir: "cw" },
        coolant: "off",
        moves,
      },
    ],
  };
}

const every: Move[] = [
  { kind: "comment", text: "start" },
  { kind: "rapid", to: [10, 0, 5] },
  { kind: "feed", to: [10, 0, 0], feed: 300, role: "plunge" },
  {
    kind: "arc",
    to: [0, 10, 0],
    centre: [0, 0, 0],
    dir: "ccw",
    plane: "xy",
    feed: 600,
    role: "cut",
  },
  {
    kind: "arc",
    to: [0, 10, -2],
    centre: [0, 0, 0],
    dir: "cw",
    plane: "xy",
    feed: 600,
    role: "plunge",
  },
  { kind: "feed", to: [0, 10, 3], feed: 1000, role: "link", power: 50 },
  {
    kind: "arc",
    to: [0, 10, 3],
    centre: [0, 10, 0],
    dir: "cw",
    plane: "yz",
    feed: 600,
    role: "cut",
  },
  {
    kind: "arc",
    to: [3, 10, 0],
    centre: [0, 10, 0],
    dir: "ccw",
    plane: "zx",
    feed: 600,
    role: "cut",
  },
  {
    kind: "cycle",
    cycle: "peck",
    points: [
      [20, 20],
      [30, 20],
    ],
    clear: 2,
    top: 0,
    bottom: -5,
    peck: 2,
    feed: 200,
  },
  {
    kind: "cycle",
    cycle: "drill",
    points: [[40, 20]],
    clear: 2,
    top: 0,
    bottom: -3,
    dwell: 0.5,
    feed: 200,
  },
  { kind: "dwell", seconds: 1 },
  { kind: "stop", optional: true },
  { kind: "raw", post: "grbl", text: "M0" },
];

function arcTo(end: number): Move[] {
  return [
    { kind: "rapid", to: [10, 0, 0] },
    {
      kind: "arc",
      to: [0, end, 0],
      centre: [0, 0, 0],
      dir: "ccw",
      plane: "xy",
      feed: 600,
      role: "cut",
    },
  ];
}

describe("validateProgram", () => {
  it("accepts every move kind", () => {
    expect(validateProgram(program(every))).toEqual([]);
  });

  it("rejects non-finite coordinates", () => {
    const moves: Move[] = [
      { kind: "rapid", to: [Number.NaN, 0, 5] },
      {
        kind: "arc",
        to: [0, 10, 0],
        centre: [0, Number.POSITIVE_INFINITY, 0],
        dir: "ccw",
        plane: "xy",
        feed: 600,
        role: "cut",
      },
    ];
    expect(validateProgram(program(moves))).toEqual([
      "sections[0].moves[0].to[0] must be finite",
      "sections[0].moves[1].centre[1] must be finite",
    ]);
  });

  it("rejects a feed of 0 or less on feeds, arcs and cycles", () => {
    const moves: Move[] = [
      { kind: "rapid", to: [10, 0, 0] },
      { kind: "feed", to: [10, 0, -1], feed: 0, role: "plunge" },
      {
        kind: "arc",
        to: [0, 10, -1],
        centre: [0, 0, -1],
        dir: "ccw",
        plane: "xy",
        feed: -1,
        role: "cut",
      },
      {
        kind: "cycle",
        cycle: "drill",
        points: [[0, 0]],
        clear: 2,
        top: 0,
        bottom: -3,
        feed: 0,
      },
    ];
    expect(validateProgram(program(moves))).toEqual([
      "sections[0].moves[1].feed must be greater than 0",
      "sections[0].moves[2].feed must be greater than 0",
      "sections[0].moves[3].feed must be greater than 0",
    ]);
  });

  it("rejects an arc whose radii differ by more than 1e-4 mm", () => {
    expect(validateProgram(program(arcTo(10.00009)))).toEqual([]);
    expect(validateProgram(program(arcTo(10.00011)))).toEqual([
      "sections[0].moves[1] arc start and end radii differ by more than 1e-4 mm",
    ]);
  });

  it("measures arc radii in the arc's plane", () => {
    const moves: Move[] = [
      { kind: "rapid", to: [0, 0, 10] },
      {
        kind: "arc",
        to: [10, 7, 0],
        centre: [0, 5, 0],
        dir: "cw",
        plane: "zx",
        feed: 600,
        role: "cut",
      },
    ];
    expect(validateProgram(program(moves))).toEqual([]);
  });

  it("rejects an arc with no start point", () => {
    const moves: Move[] = [
      {
        kind: "arc",
        to: [0, 10, 0],
        centre: [0, 0, 0],
        dir: "ccw",
        plane: "xy",
        feed: 600,
        role: "cut",
      },
    ];
    expect(validateProgram(program(moves))).toEqual([
      "sections[0].moves[0] arc has no start point",
    ]);
  });

  it("rejects a peck of 0 or less", () => {
    const moves: Move[] = [
      {
        kind: "cycle",
        cycle: "peck",
        points: [[0, 0]],
        clear: 2,
        top: 0,
        bottom: -3,
        peck: 0,
        feed: 200,
      },
    ];
    expect(validateProgram(program(moves))).toEqual([
      "sections[0].moves[0].peck must be greater than 0",
    ]);
  });

  it("rejects unknown tool ids", () => {
    const p = program([{ kind: "rapid", to: [0, 0, 5] }]);
    p.sections.push({ ...p.sections[0]!, toolId: "t9" });
    expect(validateProgram(p)).toEqual(["sections[1].toolId t9 is unknown"]);
  });
});

describe("programStats", () => {
  it("returns feed length and time from feeds, rapids and dwells", () => {
    const moves: Move[] = [
      { kind: "rapid", to: [10, 0, 5] },
      { kind: "feed", to: [10, 0, -1], feed: 100, role: "plunge" },
      {
        kind: "arc",
        to: [0, 10, -1],
        centre: [0, 0, -1],
        dir: "ccw",
        plane: "xy",
        feed: 600,
        role: "cut",
      },
      {
        kind: "arc",
        to: [0, 10, -3],
        centre: [0, 0, -1],
        dir: "cw",
        plane: "xy",
        feed: 600,
        role: "cut",
      },
      { kind: "rapid", to: [0, 10, 2] },
      {
        kind: "cycle",
        cycle: "peck",
        points: [
          [0, 20],
          [0, 30],
        ],
        clear: 2,
        top: 0,
        bottom: -5,
        peck: 2,
        dwell: 0.5,
        feed: 200,
      },
      { kind: "dwell", seconds: 1 },
      { kind: "comment", text: "done" },
    ];
    const helix = Math.hypot(2 * Math.PI * 10, 2);
    const cut = 6 + 5 * Math.PI + helix + 2 * 7;
    const rapid = 5 + 10 + 2 * (8 + 12 + 7) + 10;
    const seconds =
      (6 / 100) * 60 +
      ((5 * Math.PI + helix) / 600) * 60 +
      ((2 * 7) / 200) * 60 +
      (rapid / 3000) * 60 +
      2 * 0.5 +
      1;
    const stats = programStats(program(moves), 3000);
    expect(stats.cutLength).toBeCloseTo(cut, 9);
    expect(stats.seconds).toBeCloseTo(seconds, 9);
  });
});
