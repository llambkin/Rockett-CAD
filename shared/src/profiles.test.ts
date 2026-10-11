import { describe, expect, it } from "vitest";
import type { SketchEntity } from "./model.js";
import {
  detectProfiles,
  findProfile,
  profileIdFor,
  type Profile,
} from "./profiles.js";

const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (id: string, p1: string, p2: string): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
});

const rect = (k: string, x: number, y: number, w: number, h: number) => [
  P(`${k}a`, x, y),
  P(`${k}b`, x + w, y),
  P(`${k}c`, x + w, y + h),
  P(`${k}d`, x, y + h),
  L(`${k}1`, `${k}a`, `${k}b`),
  L(`${k}2`, `${k}b`, `${k}c`),
  L(`${k}3`, `${k}c`, `${k}d`),
  L(`${k}4`, `${k}d`, `${k}a`),
];

const segment = (
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) => [P(`${id}s`, x1, y1), P(`${id}e`, x2, y2), L(id, `${id}s`, `${id}e`)];

const ids = (p: {
  outer: { entityId: string }[];
  holes: { entityId: string }[][];
}) =>
  [
    ...new Set([...p.outer, ...p.holes.flat()].map((c) => c.entityId)),
  ].toSorted();

const RECT = ["r1", "r2", "r3", "r4"];

const disc = (id: string, r: number): SketchEntity => ({
  id,
  kind: "circle",
  center: "o",
  radius: r,
});

function onlyTheRectangle(entities: SketchEntity[]) {
  const profiles = detectProfiles(entities);
  expect(profiles).toHaveLength(1);
  expect(ids(profiles[0]!)).toEqual(RECT);
  expect(profiles[0]!.area).toBeCloseTo(5000, 9);
  return profiles[0]!;
}

describe("dangling sketch pieces", () => {
  it("drops a line from one side that ends inside", () => {
    onlyTheRectangle([
      ...rect("r", 0, 0, 100, 50),
      ...segment("sp", 40, 0, 40, 30),
    ]);
  });

  it("drops a line that stops 0.2 mm short of the far side", () => {
    onlyTheRectangle([
      ...rect("r", 0, 0, 100, 50),
      ...segment("sp", 0, 25, 99.8, 25),
    ]);
  });

  it("drops a spur whose free end touches nothing", () => {
    onlyTheRectangle([
      ...rect("r", 0, 0, 100, 50),
      ...segment("sp", 60, 50, 60, 80),
    ]);
  });

  it("drops a branched spur piece by piece until no free end remains", () => {
    const profile = onlyTheRectangle([
      ...rect("r", 0, 0, 100, 50),
      ...segment("sp", 0, 25, 60, 25),
      ...segment("br", 30, 25, 30, 40),
    ]);
    expect(profile.outer).toHaveLength(5);
  });

  it("keeps a bridge with a spur at both ends only where it closes a loop", () => {
    const profiles = detectProfiles([
      ...rect("r", 0, 0, 100, 50),
      ...segment("bridge", 0, 25, 100, 25),
      ...segment("sl", 0, 25, 20, 35),
      ...segment("sr", 100, 25, 80, 15),
      ...rect("q", 150, 0, 50, 50),
      ...segment("link", 100, 40, 150, 40),
    ]);
    const regions = profiles
      .map((p) => ({ ids: ids(p), area: Math.round(p.area * 1e6) / 1e6 }))
      .toSorted((a, b) => a.ids.join().localeCompare(b.ids.join()));
    expect(regions).toEqual([
      { ids: ["bridge", "r1", "r2", "r4"], area: 2500 },
      { ids: ["bridge", "r2", "r3", "r4"], area: 2500 },
      { ids: ["q1", "q2", "q3", "q4"], area: 2500 },
    ]);
  });
});

const sumY = (p: { polygon: number[] }) =>
  p.polygon.filter((_, i) => i % 2 === 1).reduce((s, y) => s + y, 0);

describe("profile ids saved with a spur", () => {
  it("resolve to the pruned profile covering the same region", () => {
    const entities = [
      ...rect("r", 0, 0, 100, 50),
      ...segment("sp", 40, 0, 40, 30),
    ];
    const profiles = detectProfiles(entities);
    const saved = profileIdFor([...RECT, "sp"], []);
    const found = findProfile({ profiles, entities }, saved);
    expect(found).toBe(profiles[0]);
    expect(ids(found!)).toEqual(RECT);
  });

  it("resolve in the pre-tangent-split detection too", () => {
    const S = 40;
    const entities: SketchEntity[] = [
      ...rect("r", 0, 0, S, S),
      P("o", S / 2, S / 2),
      disc("ci", S / 2),
      ...segment("sp", 3, 0, 3, 2),
    ];
    const sketch = { profiles: detectProfiles(entities), entities };
    const before = findProfile(sketch, profileIdFor(RECT, []));
    expect(before).toBeDefined();
    expect(ids(before!)).toEqual(RECT);
    expect(findProfile(sketch, profileIdFor([...RECT, "sp"], []))).toBe(before);
  });

  const halves = (to: number) => {
    const entities: SketchEntity[] = [
      P("o", 0, 0),
      disc("c", 10),
      ...segment("d", -10, 0, 10, 0),
      ...segment("sp", 0, 0, 0, to),
    ];
    const profiles = detectProfiles(entities);
    expect(profiles.map(ids)).toEqual([
      ["c", "d"],
      ["c", "d"],
    ]);
    const side = (sign: number) =>
      profiles.find((p) => Math.sign(sumY(p)) === sign)!;
    return {
      sketch: { profiles, entities },
      spurred: side(Math.sign(to)),
      bare: side(-Math.sign(to)),
    };
  };

  it.each([
    ["up", 5],
    ["down", -5],
  ])("resolve the half holding a spur %s to that half", (_, to) => {
    const { sketch, spurred } = halves(to);
    const saved = profileIdFor(["c", "d", "sp"], []);
    expect(findProfile(sketch, saved)).toBe(spurred);
  });

  it.each([
    ["up", 5],
    ["down", -5],
  ])("resolve the half beside a spur %s to that half", (_, to) => {
    const { sketch, bare } = halves(to);
    const saved = profileIdFor(["c", "d"], []);
    expect(findProfile(sketch, saved)).toBe(bare);
  });

  it("leave a sketch without spurs and its ids unchanged", () => {
    const entities = rect("r", 0, 0, 100, 50);
    expect(detectProfiles(entities).map((p) => p.id)).toEqual([
      profileIdFor(RECT, []),
    ]);
  });
});

const sumX = (p: { polygon: number[] }) =>
  p.polygon.filter((_, i) => i % 2 === 0).reduce((s, x) => s + x, 0);

const legacyId = (p: Profile) =>
  profileIdFor(
    p.outer.map((c) => c.entityId),
    p.holes.map((h) => h.map((c) => c.entityId)),
  );

describe("profile ids in a sketch without spurs", () => {
  const chord = Math.sqrt(99.75);
  const strips = (cx: number, cy: number, turn: boolean) => {
    const at = (x: number, y: number) =>
      turn ? ([cx + y, cy + x] as const) : ([cx + x, cy + y] as const);
    const line = (id: string, y: number) =>
      segment(id, ...at(-chord, y), ...at(chord, y));
    return [
      P("o", ...at(0, 0)),
      disc("B", 10),
      disc("C", 2),
      ...line("L1", -0.5),
      ...line("L2", 0.5),
    ];
  };

  it("resolve a legacy id tied between two strips to the right strip", () => {
    const entities = strips(0, 0.5, false);
    const profiles = detectProfiles(entities);
    const saved = profileIdFor(["B", "L1", "L2", "C"], []);
    const found = findProfile({ profiles, entities }, saved);
    expect(found).toBeDefined();
    expect(ids(found!)).toEqual(["B", "C", "L1", "L2"]);
    expect(sumX(found!)).toBeGreaterThan(0);
  });

  const touching = [...rect("r", 0, 0, 40, 40), P("o", 20, 20), disc("ci", 20)];

  it("resolve the rectangle id saved before tangent splitting", () => {
    const sketch = { profiles: detectProfiles(touching), entities: touching };
    expect(findProfile(sketch, profileIdFor(RECT, []))).toMatchObject({
      outer: RECT.map((entityId) => ({ entityId, reversed: false })),
      holes: [],
      area: 1600,
    });
  });

  it.each([
    ["two strips", strips(0, 0.5, false)],
    ["two turned strips", strips(3, -2, true)],
    [
      "two halves",
      [P("o", 0, 0), disc("c", 10), ...segment("d", -10, 0, 10, 0)],
    ],
    ["a rectangle", rect("r", 0, 0, 100, 50)],
    [
      "a bridged rectangle beside a square",
      [
        ...rect("r", 0, 0, 100, 50),
        ...segment("bridge", 0, 25, 100, 25),
        ...rect("q", 150, 0, 50, 50),
        ...segment("link", 100, 40, 150, 40),
      ],
    ],
    ["a rectangle round a touching circle", touching],
  ])("resolve every id in %s as before pruning", (_, entities) => {
    const profiles = detectProfiles(entities);
    const sketch = { profiles, entities };
    for (const p of profiles) {
      const first = profiles.find((q) => legacyId(q) === legacyId(p))!;
      expect(findProfile(sketch, p.id)).toBe(p);
      expect(findProfile(sketch, legacyId(p))).toEqual({
        ...first,
        id: legacyId(p),
      });
    }
  });
});
