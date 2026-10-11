import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateProgram, type Move } from "../src/shared/ir.js";
import { stockBox, type Setup } from "../src/shared/setup.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import { facing } from "../src/toolpath/facing.js";

const tool: Tool = {
  id: "t1",
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const preset: Preset = {
  id: "p1",
  name: "Aluminium face",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 1,
  stepoverFraction: 0.5,
  coolant: "mist",
};

const setup: Setup = {
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  stock: {
    kind: "boxAround",
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 2.5 },
  },
  wcs: {
    origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
    axes: { x: "+x", z: "+z" },
    offsetIndex: 1,
    machine: { kind: "unknown" },
  },
  safeHeight: 15,
  clearance: 3,
  tolerance: 0.01,
  fixtures: [],
};

const stock = stockBox(setup, { b1: { min: [0, 0, 0], max: [100, 50, 17.5] } });

function face(changes: { modelTop?: number; tool?: Tool; preset?: Preset }) {
  return facing({
    operationId: "op1",
    setup,
    stock,
    modelTop: -2.5,
    tool,
    preset,
    ...changes,
  });
}

function cuts(moves: Move[]) {
  return moves.flatMap((move) =>
    move.kind === "feed" && move.role === "cut" ? [move.to] : [],
  );
}

describe("facing", () => {
  it("matches the golden IR for 100 by 50 stock and a 6 mm tool", () => {
    const golden = JSON.parse(
      readFileSync(new URL("golden/ir/facing.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(face({})).toEqual(golden);
  });

  it("zigzags 17 rows from y 0 to 48 across x -3 to 103 at z -1, -2, -2.5", () => {
    const section = face({});
    const ends = cuts(section.moves);
    expect(stock.min).toEqual([0, 0, -20]);
    expect(stock.max).toEqual([100, 50, 0]);
    expect(ends).toHaveLength(3 * 17);
    expect([...new Set(ends.map(([, , z]) => z))]).toEqual([-1, -2, -2.5]);
    expect(ends.slice(0, 17).map(([, y]) => y)).toEqual(
      Array.from({ length: 17 }, (_, k) => 3 * k),
    );
    expect(new Set(ends.map(([x]) => x))).toEqual(new Set([-3, 103]));
    expect(section.moves[0]).toEqual({ kind: "rapid", to: [-3, 0, 15] });
    expect(section.moves[1]).toEqual({ kind: "rapid", to: [-3, 0, 3] });
    expect(section.moves.at(-1)).toEqual({ kind: "rapid", to: [103, 48, 15] });
  });

  it("forms a valid program", () => {
    const section = face({});
    expect(
      validateProgram({
        irVersion: 1,
        units: "mm",
        setupId: setup.id,
        offsetIndex: 1,
        tools: [{ ...tool, number: 1 }],
        sections: [section],
      }),
    ).toEqual([]);
  });

  it("adds no extra level when the stepdown divides the depth", () => {
    const levels = cuts(face({ modelTop: -2 }).moves).map(([, , z]) => z);
    expect([...new Set(levels)]).toEqual([-1, -2]);
  });

  it("covers the far edge when the stepover does not divide the width", () => {
    const rows = cuts(
      face({ preset: { ...preset, stepoverFraction: 0.7 } }).moves,
    ).map(([, y]) => y);
    const last = Math.max(...rows);
    expect(last + 3).toBeGreaterThanOrEqual(50);
    expect(last - 4.2 + 3).toBeLessThan(50);
    expect(Math.min(...rows)).toBeCloseTo(1.2, 12);
  });

  it("refuses stock whose top is not above the model top", () => {
    expect(() => face({ modelTop: 0 })).toThrow(RangeError);
  });

  it("refuses a tool with no diameter", () => {
    expect(() => face({ tool: { ...tool, diameter: 0 } })).toThrow(RangeError);
  });

  it("refuses a stepover or stepdown it cannot cut", () => {
    for (const change of [
      { stepoverFraction: 0 },
      { stepoverFraction: 1.01 },
      { stepdown: 0 },
    ])
      expect(() => face({ preset: { ...preset, ...change } })).toThrow(
        RangeError,
      );
  });
});
