import { expect, it } from "vitest";
import { detectProfiles } from "../src/profiles.js";
import { touchingProfileGroups } from "../src/profileGroups.js";
import type { SketchEntity } from "../src/model.js";

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
const rect = (n: string, x: number, y: number, w: number, h: number) => [
  P(`${n}a`, x, y),
  P(`${n}b`, x + w, y),
  P(`${n}c`, x + w, y + h),
  P(`${n}d`, x, y + h),
  L(`${n}1`, `${n}a`, `${n}b`),
  L(`${n}2`, `${n}b`, `${n}c`),
  L(`${n}3`, `${n}c`, `${n}d`),
  L(`${n}4`, `${n}d`, `${n}a`),
];

function groups(entities: SketchEntity[], order: (x: number) => number) {
  const profiles = detectProfiles(entities).sort(
    (a, b) => order(a.polygon[0]!) - order(b.polygon[0]!),
  );
  return touchingProfileGroups(
    profiles.map((profile) => ({ sketchId: "sk", profile })),
  );
}

it("groups regions that share a sketch edge", () => {
  const split = [
    ...rect("r", 0, 0, 20, 10),
    P("m1", 10, 0),
    P("m2", 10, 10),
    L("m", "m1", "m2"),
  ];
  expect(groups(split, (x) => x)).toEqual([[0, 1]]);
});

it("keeps apart regions that do not touch or touch only at a corner", () => {
  expect(
    groups([...rect("a", 0, 0, 10, 10), ...rect("b", 30, 0, 10, 10)], (x) => x),
  ).toEqual([[0], [1]]);
  expect(
    groups(
      [...rect("a", 0, 0, 10, 10), ...rect("b", 10, 10, 10, 10)],
      (x) => x,
    ),
  ).toEqual([[0], [1]]);
});

it("groups a disc with the region it sits in", () => {
  const entities = [
    ...rect("r", 0, 0, 40, 20),
    P("cc", 20, 10),
    { id: "ci", kind: "circle", center: "cc", radius: 5 } as SketchEntity,
  ];
  expect(detectProfiles(entities)).toHaveLength(2);
  expect(
    touchingProfileGroups(
      detectProfiles(entities).map((profile) => ({ sketchId: "sk", profile })),
    ),
  ).toEqual([[0, 1]]);
});

it("orders groups by their first selected region", () => {
  const entities = [
    ...rect("r", 0, 0, 20, 10),
    P("m1", 10, 0),
    P("m2", 10, 10),
    L("m", "m1", "m2"),
    ...rect("s", 50, 0, 10, 10),
  ];
  const rank = (x: number) => (x < 10 ? 0 : x > 40 ? 1 : 2);
  expect(groups(entities, (x) => rank(x))).toEqual([[0, 2], [1]]);
});

it("keeps the same edge in different sketches apart", () => {
  const [left, right] = detectProfiles([
    ...rect("r", 0, 0, 20, 10),
    P("m1", 10, 0),
    P("m2", 10, 10),
    L("m", "m1", "m2"),
  ]);
  expect(
    touchingProfileGroups([
      { sketchId: "a", profile: left! },
      { sketchId: "b", profile: right! },
    ]),
  ).toEqual([[0], [1]]);
});
