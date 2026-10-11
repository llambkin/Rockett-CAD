import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { validateProgram, type Move, type Xy } from "../src/shared/ir.js";
import type { Box, Setup } from "../src/shared/setup.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import * as surface from "../src/surface/dropCutter.js";
import { waterline, type WaterlineInput } from "../src/toolpath/waterline.js";
import { base, tools } from "./helpers/meshes.js";

vi.mock("../src/surface/dropCutter.js", async (original) => {
  const real = await original<typeof surface>();
  return { ...real, dropCutter: vi.fn(real.dropCutter) };
});

const [flat, ball] = tools as [Tool, Tool, Tool];
const SIDES = 256;
const CHORD = 15 * (1 - Math.cos(Math.PI / SIDES));

const preset: Preset = {
  id: "p1",
  name: "Aluminium finish",
  rpm: 18000,
  cutFeed: 1200,
  plungeFeed: 300,
  rampFeed: 600,
  stepdown: 2.5,
  stepoverFraction: 0.1,
  coolant: "mist",
};

const setup: Pick<Setup, "safeHeight" | "clearance" | "tolerance"> = {
  safeHeight: 15,
  clearance: 3,
  tolerance: 0.01,
};

type Mesh = surface.Mesh;

function join(parts: Mesh[]): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...Array.from(part.positions));
    indices.push(...Array.from(part.indices, (index) => index + offset));
  }
  return { positions, indices };
}

function prism(outline: Xy[], bottom: number, top: number, apex = top): Mesh {
  const n = outline.length;
  const [cx, cy] = outline
    .reduce(([x, y], [u, v]) => [x + u, y + v], [0, 0])
    .map((sum) => sum / n) as Xy;
  const positions = [cx, cy, apex, cx, cy, bottom];
  for (const [x, y] of outline) positions.push(x, y, top, x, y, bottom);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [2 + 2 * i, 2 + 2 * ((i + 1) % n)];
    indices.push(0, a, b, 1, b + 1, a + 1, a, a + 1, b + 1, a, b + 1, b);
  }
  return { positions, indices };
}

const circle = (radius: number, sides = SIDES): Xy[] =>
  Array.from({ length: sides }, (_, i) => {
    const angle = (2 * Math.PI * i) / sides;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });

const rectangle = (x0: number, y0: number, x1: number, y1: number): Xy[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const boss = (top = 10, apex = top) => prism(circle(15), 0, top, apex);

function pocket(): Mesh {
  return join([
    prism(rectangle(-20, -20, -10, 20), 0, 10),
    prism(rectangle(10, -20, 20, 20), 0, 10),
    prism(rectangle(-10, -20, 10, -10), 0, 10),
    prism(rectangle(-10, 10, 10, 20), 0, 10),
    prism(rectangle(-20, -20, 20, 20), -2, 0),
  ]);
}

function stockOver(mesh: Mesh): Box {
  const p = Array.from(mesh.positions);
  const axis = (k: number) => p.filter((_, i) => i % 3 === k);
  const [xs, ys, zs] = [axis(0), axis(1), axis(2)];
  return {
    min: [Math.min(...xs) - 5, Math.min(...ys) - 5, Math.min(...zs)],
    max: [Math.max(...xs) + 5, Math.max(...ys) + 5, Math.max(...zs) + 1],
  };
}

function run(mesh: Mesh, changes: Partial<WaterlineInput> = {}) {
  return waterline({
    operationId: "op1",
    setup,
    stock: stockOver(mesh),
    mesh,
    tool: flat,
    preset,
    angle: 30,
    ...changes,
  });
}

type Pass = { z: number; points: Xy[] };

function passes(moves: Move[]): Pass[] {
  const found: Pass[] = [];
  for (const move of moves) {
    if (move.kind !== "feed") continue;
    const [x, y, z] = move.to;
    if (move.role === "plunge") found.push({ z, points: [[x, y]] });
    if (move.role === "cut") found.at(-1)!.points.push([x, y]);
  }
  return found;
}

const radius = ([x, y]: Xy) => Math.hypot(x, y);

function area(points: Xy[]) {
  return points.reduce((twice, [x, y], i) => {
    const [u, v] = points[(i + 1) % points.length]!;
    return twice + (x * v - u * y) / 2;
  }, 0);
}

const turn = (p: Xy, q: Xy, r: Xy) =>
  Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));

function crosses(a: Xy, b: Xy, c: Xy, d: Xy) {
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

function selfCrossings(points: Xy[]) {
  let count = 0;
  const n = points.length - 1;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++)
      if (crosses(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!))
        count++;
  return count;
}

function gouges(mesh: Mesh, tool: Tool, pass: Pass, spacing: number) {
  const indexed = surface.indexMesh(mesh);
  let worst = -Infinity;
  for (let i = 1; i < pass.points.length; i++) {
    const [a, b] = [pass.points[i - 1]!, pass.points[i]!];
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing),
    );
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const y = a[1] + ((b[1] - a[1]) * k) / n;
      worst = Math.max(worst, surface.dropCutter(indexed, tool, x, y) - pass.z);
    }
  }
  return worst;
}

describe("waterline", () => {
  it("matches the golden IR for a 10 mm square block and a 6 mm flat tool", () => {
    const golden = JSON.parse(
      readFileSync(
        new URL("golden/ir/waterline.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    const block = prism(rectangle(-5, -5, 5, 5), 0, 5);
    expect(run(block, { preset: { ...preset, stepdown: 2.5 } })).toEqual(
      golden,
    );
  });

  it("gives closed loops at radius 18 mm round a 30 mm boss with a 6 mm flat tool", () => {
    const mesh = boss();
    const found = passes(run(mesh).moves);
    expect(found.map(({ z }) => z)).toEqual([7.5, 5, 2.5, 0]);
    for (const pass of found) {
      expect(pass.points.at(-1)).toEqual(pass.points[0]);
      for (const point of pass.points) {
        expect(radius(point)).toBeGreaterThanOrEqual(18 - CHORD - 1e-9);
        expect(radius(point)).toBeLessThanOrEqual(18 + setup.tolerance);
      }
      expect(area(pass.points)).toBeLessThan(0);
      expect(selfCrossings(pass.points)).toBe(0);
      expect(gouges(mesh, flat, pass, 0.002)).toBeLessThanOrEqual(0);
    }
  });

  it("skips the flat top with a 30 degree limit and keeps the wall to its edge", () => {
    const mesh = boss();
    const found = passes(
      run(mesh, { preset: { ...preset, stepdown: 0.1 } }).moves,
    );
    expect(found).toHaveLength(100);
    expect(found[0]!.z).toBeCloseTo(9.9, 12);
    for (const pass of found)
      for (const point of pass.points)
        expect(radius(point)).toBeGreaterThanOrEqual(18 - CHORD - 1e-9);
  });

  it("skips a 10 degree top at 30 degrees and finishes it at 5 degrees", () => {
    const top = 5 + 15 * Math.tan(Math.PI / 18);
    const mesh = boss(5, top);
    const onTop = (angle: number) =>
      passes(run(mesh, { angle, preset: { ...preset, stepdown: 1 } }).moves)
        .filter(({ z }) => z > 5)
        .map(({ z, points }) => ({ z, r: Math.min(...points.map(radius)) }));
    expect(onTop(30)).toEqual([]);
    const shallow = onTop(5);
    expect(shallow.map(({ z }) => z)).toEqual([top - 1, top - 2]);
    for (const { z, r } of shallow)
      expect(r).toBeCloseTo(3 + (top - z) / Math.tan(Math.PI / 18), 1);
  });

  it("judges a ball rolling over the boss edge by the offset surface slope", () => {
    const mesh = boss(1);
    const levels = (angle: number) =>
      passes(
        run(mesh, { tool: ball, angle, preset: { ...preset, stepdown: 0.25 } })
          .moves,
      ).map(({ z }) => z);
    expect(levels(30)).toEqual([0.5, 0.25, 0]);
    expect(levels(20)).toEqual([0.75, 0.5, 0.25, 0]);
    expect(levels(45)).toEqual([0]);
  });

  it("keeps a ball clear of the offset surface round the boss", () => {
    const mesh = boss(1);
    for (const pass of passes(
      run(mesh, { tool: ball, angle: 0, preset: { ...preset, stepdown: 0.25 } })
        .moves,
    )) {
      const d = Math.sqrt(9 - (pass.z + 2) ** 2);
      for (const point of pass.points) {
        expect(radius(point)).toBeGreaterThanOrEqual(15 + d - CHORD - 1e-9);
        expect(radius(point)).toBeLessThanOrEqual(15 + d + setup.tolerance);
      }
      expect(gouges(mesh, ball, pass, 0.002)).toBeLessThanOrEqual(0);
    }
  });

  it("finishes a square pocket into its corners and climbs round it", () => {
    const mesh = pocket();
    const inside = passes(run(mesh).moves).filter(({ points }) =>
      points.every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) < 10),
    );
    expect(inside.map(({ z }) => z)).toEqual([7.5, 5, 2.5, 0.0001]);
    for (const pass of inside) {
      expect(area(pass.points)).toBeGreaterThan(0);
      expect(selfCrossings(pass.points)).toBe(0);
      expect(gouges(mesh, flat, pass, 0.002)).toBeLessThanOrEqual(0);
      for (const point of pass.points)
        expect(Math.max(...point.map(Math.abs))).toBeLessThanOrEqual(
          7 + setup.tolerance,
        );
      for (const [cx, cy] of rectangle(-7, -7, 7, 7))
        expect(
          Math.min(...pass.points.map(([x, y]) => Math.hypot(x - cx, y - cy))),
        ).toBeLessThanOrEqual(2 * setup.tolerance);
    }
  });

  it("finishes a wall down to a floor that falls between levels", () => {
    const mesh = join([
      prism(circle(15), -1, 10),
      prism(rectangle(-30, -30, 30, 30), -4, -1),
    ]);
    const floor = passes(run(mesh).moves).filter(
      ({ z }) => Math.abs(z + 1 - 0.0001) < 1e-12,
    );
    expect(floor).toHaveLength(1);
    for (const point of floor[0]!.points)
      expect(radius(point)).toBeCloseTo(18, 2);
  });

  it("keeps loops simple where a 45 degree wall passes just beside the sample grid", () => {
    const lifted = 3 + setup.tolerance / 100;
    const size = lifted / 4;
    const beside = (setup.tolerance / 20) * Math.SQRT2;
    const a = (62 * size - 2 * lifted - lifted * Math.SQRT2 - beside) / 3;
    const mesh = prism(
      [
        [a, 0],
        [0, a],
        [-a, 0],
        [0, -a],
      ],
      0,
      5,
    );
    const found = passes(run(mesh).moves);
    expect(found.map(({ z }) => z)).toEqual([2.5, 0]);
    for (const pass of found) {
      const steps = pass.points.slice(1).map((p, i) => {
        const [x, y] = pass.points[i]!;
        return Math.hypot(p[0] - x, p[1] - y);
      });
      expect(Math.min(...steps)).toBeGreaterThan(0);
      expect(selfCrossings(pass.points)).toBe(0);
      expect(gouges(mesh, flat, pass, 0.002)).toBeLessThanOrEqual(0);
    }
  });

  it("holds the loop within a 0.001 mm tolerance", () => {
    const mesh = boss();
    const tight = { ...setup, tolerance: 0.001 };
    for (const pass of passes(run(mesh, { setup: tight }).moves))
      for (const point of pass.points) {
        expect(radius(point)).toBeGreaterThanOrEqual(18 - CHORD - 1e-9);
        expect(radius(point)).toBeLessThanOrEqual(18.001);
      }
  });

  it("rapids only above the stock top plus clearance and plunges into cleared columns", () => {
    const mesh = pocket();
    const stock = stockOver(mesh);
    const indexed = surface.indexMesh(mesh);
    const moves = run(mesh).moves;
    const clear = stock.max[2] + setup.clearance;
    let at: number[] = [0, 0, Infinity];
    for (const move of moves) {
      if (move.kind === "rapid") {
        expect(Math.min(at[2]!, move.to[2])).toBeGreaterThanOrEqual(clear);
      }
      if (move.kind === "feed" && move.role !== "cut") {
        expect(move.to.slice(0, 2)).toEqual(at.slice(0, 2));
        const low = Math.min(at[2]!, move.to[2]);
        expect(
          surface.dropCutter(indexed, flat, move.to[0], move.to[1]),
        ).toBeLessThanOrEqual(low);
      }
      if ("to" in move) at = move.to;
    }
    expect(moves[0]).toMatchObject({ kind: "rapid" });
    expect(at[2]).toBe(stock.max[2] + setup.safeHeight);
    expect(moves.at(-1)).toMatchObject({ kind: "rapid" });
  });

  it("forms a valid finishing program", () => {
    const section = run(boss());
    expect(section.pass).toBe("finish");
    expect(
      validateProgram({
        irVersion: 1,
        units: "mm",
        setupId: "s1",
        offsetIndex: 1,
        tools: [{ ...flat, number: 1 }],
        sections: [section],
      }),
    ).toEqual([]);
  });

  it("bounds the drop-cutter calls for the boss", () => {
    const calls = vi.mocked(surface.dropCutter);
    calls.mockClear();
    run(boss());
    const grid = (37.5 / 0.75 + 2) ** 2;
    const perLevel = (2 * Math.PI * 18) / 0.049;
    expect(calls.mock.calls.length).toBeLessThan(grid + 4 * 6 * perLevel);
  });

  it("refuses inputs it cannot cut", () => {
    const mesh = boss();
    const vbit: Tool = {
      ...base,
      id: "v",
      name: "V",
      kind: "vbit",
      tipAngle: 90,
    };
    for (const changes of [
      { preset: { ...preset, stepdown: 0 } },
      { angle: -1 },
      { angle: 90 },
      { setup: { ...setup, tolerance: 0 } },
      { setup: { ...setup, clearance: 0 } },
      { tool: vbit },
      { stock: { min: [-30, -30, 0], max: [30, 30, 9] } as Box },
      { mesh: { positions: [], indices: [] } },
    ])
      expect(() => run(mesh, changes)).toThrow(RangeError);
  });
});
