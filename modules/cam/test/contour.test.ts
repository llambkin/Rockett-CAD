import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
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
import offset from "../src/kernel/offset.js";
import {
  contour,
  type ContourInput,
  type Offset,
} from "../src/toolpath/contour.js";
import type { Loop } from "../src/toolpath/geometry.js";
import { oc, scoped, startKernel } from "./helpers/kernel.js";

const job = offset["rockett.cam.offset"]!;

beforeAll(startKernel, 120_000);

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
  name: "MDF profile",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off",
};

const rounded: RegionLoop = {
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

const clockwise: RegionLoop = {
  start: [5, 0],
  segments: [
    { kind: "arc", to: [0, 5], centre: [5, 5], dir: "cw" },
    { kind: "line", to: [0, 25] },
    { kind: "arc", to: [5, 30], centre: [5, 25], dir: "cw" },
    { kind: "line", to: [35, 30] },
    { kind: "arc", to: [40, 25], centre: [35, 25], dir: "cw" },
    { kind: "line", to: [40, 5] },
    { kind: "arc", to: [35, 0], centre: [35, 5], dir: "cw" },
    { kind: "line", to: [5, 0] },
  ],
};

const circle = (r: number): RegionLoop => ({
  start: [r, 0],
  segments: [{ kind: "arc", to: [r, 0], centre: [0, 0], dir: "ccw" }],
});

const rectangle: Loop = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 30 },
  { x: 0, y: 30 },
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

const base: ContourInput = {
  operationId: "op1",
  setup: { safeHeight: 15, clearance: 3 },
  stock: { min: [-10, -10, -10], max: [50, 40, 0] },
  loop: rounded,
  side: "outside",
  direction: "climb",
  bottom: -6,
  start: [-10, 15],
  tool,
  preset,
};

const run: Offset = (input) =>
  scoped(
    (own) =>
      job(input as never, { oc, own, progress: () => {} }) as RegionLoop[],
  );

const cut = (changes: Partial<ContourInput>) =>
  contour({ ...base, ...changes }, run);

const offsetTo = (path: RegionLoop) => (changes: Partial<ContourInput>) =>
  contour({ ...base, ...changes }, () => [path]);

function ends(moves: Move[]): Xyz[] {
  return moves.flatMap((move) =>
    move.kind === "feed" || move.kind === "arc" ? [move.to] : [],
  );
}

function level(section: Section, z: number): Xy[] {
  return ends(section.moves)
    .filter((to) => to[2] === z)
    .map(([x, y]): Xy => [x, y]);
}

function area(points: Xy[]): number {
  return (
    points.reduce((twice, [ax, ay], i) => {
      const [bx, by] = points[(i + 1) % points.length]!;
      return twice + ax * by - bx * ay;
    }, 0) / 2
  );
}

const snapped = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_, item: unknown) =>
      typeof item === "number" ? Math.round(item * 1e9) / 1e9 || 0 : item,
    ),
  );

function fromCore([x, y]: Xy, [x0, y0, x1, y1]: number[]): number {
  const dx = Math.max(x0! - x, 0, x - x1!);
  const dy = Math.max(y0! - y, 0, y - y1!);
  return Math.hypot(dx, dy);
}

describe("contour", () => {
  it("matches the golden IR for an outside climb contour of 40 by 30 R5", () => {
    const golden = JSON.parse(
      readFileSync(new URL("golden/ir/contour.json", import.meta.url), "utf8"),
    ) as unknown;
    expect(cut({})).toEqual(golden);
  });

  it("rejects a plunge with a tool that is not centre cutting", () => {
    expect(() => cut({ tool: { ...tool, centreCutting: false } })).toThrow(
      "6 mm flat is not centre cutting and cannot plunge",
    );
  });

  it("forms a valid program", () => {
    const section = cut({});
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

  it("enters and retracts at the start point, rapids only above the clearance", () => {
    const { moves } = cut({});
    expect(moves.slice(0, 3)).toEqual([
      { kind: "rapid", to: [-3, 15, 15] },
      { kind: "rapid", to: [-3, 15, 3] },
      { kind: "feed", to: [-3, 15, -3], feed: 300, role: "plunge" },
    ]);
    expect(moves.at(-1)).toEqual({ kind: "rapid", to: [-3, 15, 15] });
    for (const move of moves)
      if (move.kind === "rapid") expect(move.to[2]).toBeGreaterThanOrEqual(3);
    const plunges = moves.filter(
      (move) => move.kind === "feed" && move.role === "plunge",
    );
    expect(plunges.map((move) => "to" in move && move.to)).toEqual([
      [-3, 15, -3],
      [-3, 15, -6],
    ]);
    const before = moves.indexOf(plunges[1]!) - 1;
    expect(ends([moves[before]!])).toEqual([[-3, 15, -3]]);
    expect(ends([moves.at(-2)!])).toEqual([[-3, 15, -6]]);
  });

  it("plunges at the path point nearest the start point", () => {
    const { moves } = cut({ start: [60, 15] });
    expect(moves[0]).toEqual({ kind: "rapid", to: [43, 15, 15] });
  });

  it("steps down no more than the stepdown and ends at the final depth", () => {
    for (const [stepdown, bottom, want] of [
      [3, -6, [-3, -6]],
      [4, -6, [-4, -6]],
      [2.5, -6, [-2.5, -5, -6]],
      [10, -6, [-6]],
    ] as const) {
      const { moves } = cut({ bottom, preset: { ...preset, stepdown } });
      const zs = moves.flatMap((move) =>
        move.kind === "feed" && move.role === "plunge" ? [move.to[2]] : [],
      );
      expect(zs).toEqual(want);
    }
  });

  it("cuts outside at the tool radius on R8 arcs and inside on R2 arcs", () => {
    for (const [side, radius] of [
      ["outside", 8],
      ["inside", 2],
    ] as const) {
      const section = cut({ side });
      for (const point of level(section, -6))
        expect(fromCore(point, [5, 5, 35, 25])).toBeCloseTo(radius, 9);
      const arcs = section.moves.flatMap((move) =>
        move.kind === "arc" ? [move] : [],
      );
      expect(arcs).toHaveLength(8);
      for (const { to, centre } of arcs) {
        expect(fromCore([centre[0], centre[1]], [5, 5, 35, 25])).toBe(0);
        expect(Math.hypot(to[0] - centre[0], to[1] - centre[1])).toBeCloseTo(
          radius,
          9,
        );
      }
    }
  });

  it("runs climb clockwise outside and counter-clockwise inside", () => {
    for (const [side, direction, clockwiseWanted, dir] of [
      ["outside", "climb", true, "cw"],
      ["outside", "conventional", false, "ccw"],
      ["inside", "climb", false, "ccw"],
      ["inside", "conventional", true, "cw"],
    ] as const) {
      const section = cut({ side, direction });
      expect(area(level(section, -3)) < 0).toBe(clockwiseWanted);
      for (const move of section.moves)
        if (move.kind === "arc") expect(move.dir).toBe(dir);
    }
  });

  it("cuts the same path from a loop given clockwise", () => {
    for (const side of ["outside", "inside"] as const)
      expect(snapped(cut({ loop: clockwise, side }))).toEqual(
        snapped(cut({ side })),
      );
  });

  it("offsets a full circle and plunges where the start point says", () => {
    const section = cut({ loop: circle(5), start: [0, 20] });
    expect(snapped(section.moves[0])).toEqual({
      kind: "rapid",
      to: [0, 8, 15],
    });
    const arcs = section.moves.filter((move) => move.kind === "arc");
    expect(arcs).toHaveLength(4);
    for (const arc of arcs) expect(arc.dir).toBe("cw");
    const [x, y] = ends(section.moves)[0]!;
    expect(ends(section.moves).findLast(([, , z]) => z === -6)).toEqual([
      x,
      y,
      -6,
    ]);
  });

  it("never emits an arc short enough to read as a full circle", () => {
    const kinked: RegionLoop = {
      start: [0, 0],
      segments: [
        { kind: "line", to: [20, 0] },
        { kind: "line", to: [40, 0.00001] },
        { kind: "line", to: [40, 20] },
        { kind: "line", to: [0, 20] },
        { kind: "line", to: [0, 0] },
      ],
    };
    const { moves } = cut({ loop: kinked, start: [-10, 10] });
    let at: Xyz | undefined;
    for (const move of moves) {
      if (move.kind === "arc" && at)
        expect(
          Math.hypot(move.to[0] - at[0], move.to[1] - at[1]),
        ).toBeGreaterThan(0.001);
      if (move.kind === "rapid" || move.kind === "feed" || move.kind === "arc")
        at = move.to;
    }
    expect(moves.filter((move) => move.kind === "arc")).toHaveLength(8);
  });

  it("cuts a near full arc closed by a sub-micron line as its whole circle", () => {
    const short = 0.0005 / 8;
    const { moves } = offsetTo({
      start: [8, 0],
      segments: [
        {
          kind: "arc",
          to: [8 * Math.cos(short), -8 * Math.sin(short)],
          centre: [0, 0],
          dir: "ccw",
        },
        { kind: "line", to: [8, 0] },
      ],
    })({ start: [-10, 0] });
    let at: Xyz | undefined;
    let turned = 0;
    for (const move of moves) {
      if (move.kind === "arc" && at && move.to[2] === -6)
        turned += arcSweep(at, move);
      if (move.kind === "rapid" || move.kind === "feed" || move.kind === "arc")
        at = move.to;
    }
    expect(turned).toBeCloseTo(2 * Math.PI - short, 6);
  });

  it("rejects a path whose only area is in arc joins shorter than a micron", () => {
    expect(() =>
      offsetTo({
        start: [0, 0],
        segments: [
          { kind: "line", to: [20, 0] },
          { kind: "arc", to: [20, 1e-6], centre: [17, 5e-7], dir: "ccw" },
          { kind: "line", to: [0, 1e-6] },
          { kind: "arc", to: [0, 0], centre: [3, 5e-7], dir: "ccw" },
        ],
      })({}),
    ).toThrow("leaves a path with no area");
  });

  it("rejects an inside contour of a loop smaller than the tool", () => {
    expect(() => cut({ loop: circle(2), side: "inside" })).toThrow(
      "inside offset by the 3 mm tool radius leaves no path: the loop is smaller than the tool",
    );
  });

  it("offsets a point loop through clipper at the tool radius", () => {
    for (const loop of [rectangle, rectangle.toReversed()]) {
      const section = cut({ loop });
      const points = level(section, -6);
      expect(points.length).toBeGreaterThan(8);
      for (const point of points)
        expect(Math.abs(fromCore(point, [0, 0, 40, 30]) - 3)).toBeLessThan(
          0.01,
        );
      expect(area(points)).toBeLessThan(0);
      expect(section.moves[0]).toEqual({ kind: "rapid", to: [-3, 15, 15] });
      expect(section.moves.at(-1)).toEqual({
        kind: "rapid",
        to: [-3, 15, 15],
      });
    }
  });

  it("rejects an inside path with no area in a slot as wide as the tool", () => {
    const slot: RegionLoop = {
      start: [0, 0],
      segments: [
        { kind: "line", to: [20, 0] },
        { kind: "arc", to: [20, 6], centre: [20, 3], dir: "ccw" },
        { kind: "line", to: [0, 6] },
        { kind: "arc", to: [0, 0], centre: [0, 3], dir: "ccw" },
      ],
    };
    expect(() => cut({ loop: slot, side: "inside" })).toThrow(
      "inside offset by the 3 mm tool radius leaves a path with no area: the loop is no wider than the tool",
    );
  });

  it("rejects an inside offset that splits where the tool does not fit", () => {
    expect(() => cut({ loop: dumbbell, side: "inside" })).toThrow(
      "inside offset by the 3 mm tool radius splits into 2 loops: the tool does not fit everywhere",
    );
  });

  it("rejects tools that are not flat or bull end mills", () => {
    for (const other of [
      { ...tool, kind: "ball" as const },
      { ...tool, kind: "drill" as const, tipAngle: 118 },
      { ...tool, kind: "vbit" as const, tipAngle: 90 },
    ])
      expect(() => cut({ tool: other })).toThrow(
        `contour needs a flat or bull end mill, not a ${other.kind}`,
      );
    expect(
      cut({ tool: { ...tool, kind: "bull", cornerRadius: 1 } }),
    ).toBeDefined();
  });

  it("rejects a cut past the flute length", () => {
    expect(() => cut({ bottom: -22.5 })).toThrow(
      "a 22.5 mm deep cut is past the 22 mm flute length of 6 mm flat",
    );
  });

  it("rejects a final depth not below the stock top and a clearance it cannot keep", () => {
    expect(() => cut({ bottom: 0 })).toThrow(RangeError);
    expect(() => cut({ setup: { safeHeight: 15, clearance: 0 } })).toThrow(
      RangeError,
    );
    expect(() => cut({ setup: { safeHeight: 2, clearance: 3 } })).toThrow(
      RangeError,
    );
    expect(() => cut({ preset: { ...preset, plungeFeed: 0 } })).toThrow(
      "plungeFeed must be greater than 0",
    );
  });
});
