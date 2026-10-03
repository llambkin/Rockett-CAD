import { describe, expect, it } from "vitest";
import type { SketchEntity } from "./model.js";
import { detectProfiles, findProfile, profileIdFor } from "./profiles.js";

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
  [...new Set([...p.outer, ...p.holes.flat()].map((c) => c.entityId))].sort();

const RECT = ["r1", "r2", "r3", "r4"];

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
      .sort((a, b) => a.ids.join().localeCompare(b.ids.join()));
    expect(regions).toEqual([
      { ids: ["bridge", "r1", "r2", "r4"], area: 2500 },
      { ids: ["bridge", "r2", "r3", "r4"], area: 2500 },
      { ids: ["q1", "q2", "q3", "q4"], area: 2500 },
    ]);
  });
});

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
      { id: "ci", kind: "circle", center: "o", radius: S / 2 },
      ...segment("sp", 3, 0, 3, 2),
    ];
    const sketch = { profiles: detectProfiles(entities), entities };
    const before = findProfile(sketch, profileIdFor(RECT, []));
    expect(before).toBeDefined();
    expect(ids(before!)).toEqual(RECT);
    expect(findProfile(sketch, profileIdFor([...RECT, "sp"], []))).toBe(before);
  });

  it("leave a sketch without spurs and its ids unchanged", () => {
    const entities = rect("r", 0, 0, 100, 50);
    expect(detectProfiles(entities).map((p) => p.id)).toEqual([
      profileIdFor(RECT, []),
    ]);
  });
});
