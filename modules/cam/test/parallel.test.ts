import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHORD_FRACTION } from "../src/kernel/surfaceMesh.js";
import { validateProgram, type Move, type Xyz } from "../src/shared/ir.js";
import type { Preset } from "../src/shared/tools.js";
import type { Mesh } from "../src/surface/dropCutter.js";
import type { Loop } from "../src/toolpath/geometry.js";
import {
  MAX_SAMPLES,
  parallel,
  type ParallelInput,
} from "../src/toolpath/parallel.js";
import { grid, tools } from "./helpers/meshes.js";

const DOME = 20;
const RADIUS = 3;
const STEPOVER = 0.6;
const SLOPE = 1.5;
const EPSILON = 1e-9;
const [flat, ball] = tools as [(typeof tools)[0], (typeof tools)[0]];

const preset: Preset = {
  id: "p1",
  name: "Finish",
  rpm: 18000,
  cutFeed: 1500,
  plungeFeed: 400,
  rampFeed: 600,
  stepdown: 1,
  stepoverFraction: STEPOVER / ball.diameter,
  coolant: "off",
};

type Segment = { from: Xyz; move: Move & { to: Xyz } };

function dome(step: number, polar: number) {
  const bands = Math.ceil(polar / step);
  const columns = Math.ceil((2 * Math.PI) / step);
  const unit = [0, 0, 1];
  for (let i = 1; i <= bands; i++)
    for (let j = 0; j < columns; j++) {
      const down = (polar * i) / bands;
      const around = (2 * Math.PI * j) / columns;
      unit.push(
        Math.sin(down) * Math.cos(around),
        Math.sin(down) * Math.sin(around),
        Math.cos(down),
      );
    }
  const at = (i: number, j: number) => 1 + (i - 1) * columns + (j % columns);
  const indices: number[] = [];
  for (let j = 0; j < columns; j++) {
    indices.push(0, at(1, j), at(1, j + 1));
    for (let i = 1; i < bands; i++)
      indices.push(
        at(i, j),
        at(i + 1, j),
        at(i + 1, j + 1),
        at(i, j),
        at(i + 1, j + 1),
        at(i, j + 1),
      );
  }
  let near = Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      [0, 1, 2].map((n) => unit[3 * indices[t + k]! + n]!),
    ) as [number[], number[], number[]];
    const u = b.map((v, n) => v - a[n]!);
    const w = c.map((v, n) => v - a[n]!);
    const normal = [
      u[1]! * w[2]! - u[2]! * w[1]!,
      u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!,
    ];
    const reach = normal.reduce((sum, v, n) => sum + v * a[n]!, 0);
    near = Math.min(near, Math.abs(reach) / Math.hypot(...normal));
  }
  const mesh: Mesh = {
    positions: unit.map((v) => (v * DOME) / near),
    indices,
  };
  return { mesh, outward: DOME / near - DOME };
}

function square(half: number): Loop {
  return [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
}

const roof = grid(40, 40, (x) => -SLOPE * Math.abs(x));
const ridge: [number, number][] = [
  [-20, -20 * SLOPE],
  [0, 0],
  [20, -20 * SLOPE],
];

function input(changes: Partial<ParallelInput>): ParallelInput {
  return {
    operationId: "op1",
    setup: { safeHeight: 15, clearance: 3, tolerance: 0.01 },
    stock: { min: [-20, -20, -30], max: [20, 20, 0] },
    mesh: roof,
    boundary: [square(8)],
    angle: 0,
    tool: ball,
    preset,
    ...changes,
  };
}

function segments(moves: Move[]): Segment[] {
  const out: Segment[] = [];
  let at: Xyz | undefined;
  for (const move of moves) {
    if (!("to" in move)) continue;
    if (at) out.push({ from: at, move });
    at = move.to;
  }
  return out;
}

const cuts = (moves: Move[]) =>
  segments(moves).filter(
    ({ move }) => move.kind === "feed" && move.role === "cut",
  );

function along(from: Xyz, to: Xyz, count: number): Xyz[] {
  return Array.from(
    { length: count + 1 },
    (_, i) => from.map((v, k) => v + ((to[k]! - v) * i) / count) as Xyz,
  );
}

const centre = ([x, y, z]: Xyz): Xyz => [x, y, z + RADIUS];

function toRidge(x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k + 1 < ridge.length; k++) {
    const [ax, az] = ridge[k]!;
    const [bx, bz] = ridge[k + 1]!;
    const [dx, dz] = [bx - ax, bz - az];
    const t = Math.min(
      1,
      Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)),
    );
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

function cusp(a: [number, number], b: [number, number]): number {
  const [dy, dz] = [b[0] - a[0], b[1] - a[1]];
  const half = Math.hypot(dy, dz) / 2;
  const rise = Math.sqrt(RADIUS * RADIUS - half * half) / (2 * half);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const low = Math.min(
    Math.hypot(mid[0] - rise * dz, mid[1] + rise * dy),
    Math.hypot(mid[0] + rise * dz, mid[1] - rise * dy),
  );
  return low - DOME;
}

function scallop(lower: number, upper: number): number {
  const reach = DOME + RADIUS;
  const half = (Math.asin(upper / reach) - Math.asin(lower / reach)) / 2;
  return (
    reach * Math.cos(half) -
    Math.sqrt(RADIUS ** 2 - (reach * Math.sin(half)) ** 2) -
    DOME
  );
}

describe("parallel", () => {
  const tolerance = 0.0004;
  const budget = tolerance * (1 - CHORD_FRACTION);
  const { mesh, outward } = dome(0.01, 1.2);
  const domed = parallel(
    input({
      setup: { safeHeight: 15, clearance: 3, tolerance },
      stock: { min: [-25, -25, 0], max: [25, 25, 22] },
      mesh,
      boundary: [square(14)],
    }),
  );

  it("keeps every dome sample on the offset surface and every chord within the tolerance", () => {
    expect(outward).toBeLessThan(5e-4);
    const passes = cuts(domed.moves);
    expect(passes.length).toBeGreaterThan(10_000);
    for (const { from, move } of passes) {
      for (const at of [from, move.to]) {
        const gap = Math.hypot(...centre(at)) - DOME - RADIUS;
        expect(gap).toBeGreaterThanOrEqual(-EPSILON);
        expect(gap).toBeLessThanOrEqual(outward + EPSILON);
      }
      for (const at of along(from, move.to, 16))
        expect(DOME + RADIUS - Math.hypot(...centre(at))).toBeLessThanOrEqual(
          budget + EPSILON,
        );
    }
  });

  it("leaves the analytic scallop of a ball on a sphere between passes", () => {
    const apex = new Map<number, number>();
    for (const { from, move } of cuts(domed.moves)) {
      const [a, b] = from[0] <= move.to[0] ? [from, move.to] : [move.to, from];
      if (!(a[0] <= 0 && b[0] > 0)) continue;
      const t = -a[0] / (b[0] - a[0]);
      apex.set(a[1], a[2] + t * (b[2] - a[2]) + RADIUS);
    }
    const rows = [...apex.keys()];
    expect(rows).toHaveLength(47);
    rows.forEach((y, k) => expect(y).toBeCloseTo((k - 23) * STEPOVER, 9));
    const heights = rows.slice(1).map((y, k) => {
      const lower = rows[k]!;
      const measured = cusp([lower, apex.get(lower)!], [y, apex.get(y)!]);
      const expected = scallop((k - 23) * STEPOVER, (k - 22) * STEPOVER);
      expect(Math.abs(measured - expected)).toBeLessThanOrEqual(1e-3);
      return expected;
    });
    expect(Math.max(...heights)).toBeGreaterThan(0.013);
  });

  it("rides over a sharp ridge without a chord cutting into it", () => {
    const passes = cuts(parallel(input({})).moves);
    let deepest = -Infinity;
    for (const { from, move } of passes)
      for (const [x, , z] of along(from, move.to, 32))
        deepest = Math.max(deepest, RADIUS - toRidge(x, z + RADIUS));
    expect(deepest).toBeGreaterThan(0);
    expect(deepest).toBeLessThanOrEqual(0.01 * (1 - CHORD_FRACTION) + EPSILON);
  });

  it("links above the stock top plus clearance and never drags across the part", () => {
    const plane = 22 + 3;
    const moves = domed.moves;
    expect(moves[0]).toMatchObject({ kind: "rapid" });
    expect((moves[0] as { to: Xyz }).to[2]).toBe(22 + 15);
    expect(moves.at(-1)).toMatchObject({ kind: "rapid" });
    expect((moves.at(-1) as { to: Xyz }).to[2]).toBe(22 + 15);
    for (const { from, move } of segments(moves)) {
      if (move.kind === "rapid") {
        expect(Math.min(from[2], move.to[2])).toBeGreaterThanOrEqual(plane);
        continue;
      }
      if (move.kind === "feed" && move.role === "cut") continue;
      expect([move.to[0], move.to[1]]).toEqual([from[0], from[1]]);
      expect(Math.max(from[2], move.to[2])).toBe(plane);
    }
  });

  it("cuts only inside the boundary, around a hole, at the set angle", () => {
    const section = parallel(
      input({ boundary: [square(8), square(2)], angle: 30 }),
    );
    const passes = cuts(section.moves);
    const [ux, uy] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const rows = new Set<number>();
    for (const { from, move } of passes) {
      const [dx, dy] = [move.to[0] - from[0], move.to[1] - from[1]];
      expect(Math.abs(dx * uy - dy * ux)).toBeLessThan(EPSILON);
      rows.add(Math.round((move.to[1] * ux - move.to[0] * uy) * 1e6));
      for (const [x, y] of along(from, move.to, 4)) {
        const out = Math.max(Math.abs(x), Math.abs(y));
        expect(out).toBeLessThanOrEqual(8 + EPSILON);
        expect(out).toBeGreaterThanOrEqual(2 - EPSILON);
      }
    }
    const plunges = section.moves.filter(
      (move) => move.kind === "feed" && move.role === "plunge",
    );
    expect(plunges.length).toBeGreaterThan(rows.size);
  });

  it("matches the golden IR across the ridge and forms a valid program", () => {
    const section = parallel(
      input({
        setup: { safeHeight: 15, clearance: 3, tolerance: 0.05 },
        boundary: [
          [
            { x: -3, y: -3.5 },
            { x: 3, y: -3.5 },
            { x: 3, y: 3.5 },
            { x: -3, y: 3.5 },
          ],
        ],
        preset: { ...preset, stepoverFraction: 0.5 },
      }),
    );
    const golden = JSON.parse(
      readFileSync(new URL("golden/ir/parallel.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(section).toEqual(golden);
    expect(
      validateProgram({
        irVersion: 1,
        units: "mm",
        setupId: "s1",
        offsetIndex: 1,
        tools: [{ ...ball, number: 1 }],
        sections: [section, domed],
      }),
    ).toEqual([]);
  });

  it("refuses a job it cannot finish", () => {
    const refused: Partial<ParallelInput>[] = [
      { tool: flat },
      { stock: { min: [-20, -20, -30], max: [20, 20, -1] } },
      { setup: { safeHeight: 15, clearance: 3, tolerance: 0 } },
      { setup: { safeHeight: 2, clearance: 3, tolerance: 0.01 } },
      { preset: { ...preset, stepoverFraction: 0 } },
      { preset: { ...preset, stepoverFraction: 1.01 } },
      { angle: Number.NaN },
      { boundary: [] },
      { mesh: { positions: [], indices: [] } },
    ];
    for (const changes of refused)
      expect(() => parallel(input(changes))).toThrow(RangeError);
  });

  it(`refuses a job past ${MAX_SAMPLES} drop cutter samples`, () => {
    expect(() =>
      parallel(
        input({
          setup: { safeHeight: 15, clearance: 3, tolerance: 1e-4 },
          boundary: [square(1000)],
        }),
      ),
    ).toThrow(/drop cutter samples/);
  });
});
