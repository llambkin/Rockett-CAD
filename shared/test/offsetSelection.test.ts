import { expect, it } from "vitest";
import {
  findOffsetConnector,
  offsetSketchSelection,
} from "../src/sketchModify.js";
import { detectProfiles } from "../src/profiles.js";
import type { SketchEntity } from "../src/model.js";

const box = (): SketchEntity[] => [
  { id: "a", kind: "point", x: 0, y: 0 },
  { id: "b", kind: "point", x: 20, y: 0 },
  { id: "c", kind: "point", x: 20, y: 10 },
  { id: "d", kind: "point", x: 0, y: 10 },
  { id: "e", kind: "point", x: -10, y: 0 },
  { id: "bottom", kind: "line", p1: "a", p2: "b" },
  { id: "right", kind: "line", p1: "c", p2: "b" }, // reversed intentionally
  { id: "top", kind: "line", p1: "c", p2: "d" },
  { id: "left", kind: "line", p1: "d", p2: "a" },
  { id: "branch", kind: "line", p1: "a", p2: "e" },
];

it("joins a box selected out of order without including an unselected branch", () => {
  const source = box();
  const added = offsetSketchSelection(
    source,
    [],
    ["bottom", "top", "left", "right"],
    1,
  ).entities.slice(source.length);
  expect(added.filter((e) => e.kind === "line")).toHaveLength(4);
  const profiles = detectProfiles(added);
  expect(profiles).toHaveLength(1);
  expect(profiles[0]!.area).toBeCloseTo(18 * 8, 6);
});

it("waits for connecting curves instead of offsetting part of a disconnected selection", () => {
  expect(() => offsetSketchSelection(box(), [], ["bottom", "top"], 1)).toThrow(
    /connected chain yet/,
  );
  const source = box();
  const added = offsetSketchSelection(
    source,
    [],
    ["bottom", "top", "right"],
    1,
  ).entities.slice(source.length);
  expect(added.filter((e) => e.kind === "line")).toHaveLength(3);
  expect(detectProfiles(added)).toHaveLength(0);
});

it("does not restore deselected curves when only one manual selection remains", () => {
  const source = box();
  const added = offsetSketchSelection(
    source,
    [],
    ["bottom"],
    1,
    false,
  ).entities.slice(source.length);
  expect(added.filter((e) => e.kind === "line")).toHaveLength(1);
});

it("rejects a selected branching path and invalid inputs", () => {
  expect(() =>
    offsetSketchSelection(box(), [], ["bottom", "left", "branch"], 1),
  ).toThrow(/branch/);
  expect(() => offsetSketchSelection(box(), [], ["bottom", "a"], 1)).toThrow(
    /connected lines and arcs/,
  );
  expect(() =>
    offsetSketchSelection(box(), [], ["bottom", "right"], 0),
  ).toThrow(/non-zero/);
});

function segmentedOutline(): SketchEntity[] {
  // Same dimensions and small mismatch as the reported outline. Endpoints
  // are separate sketch points, as when adjoining rectangles are drawn.
  const segments: [[number, number], [number, number]][] = [
    [
      [9.7, 0],
      [9.7, 16],
    ],
    [
      [9.7, 16],
      [0, 16],
    ],
    [
      [-9.7, 16],
      [0, 16],
    ],
    [
      [-9.7, 0],
      [-9.7, 16],
    ],
    [
      [9.7, 0],
      [9.7, -16.275],
    ],
    [
      [9.7, -18.475],
      [9.7, -16.275],
    ],
    [
      [0, -18.475],
      [9.7, -18.475],
    ],
    [
      [0, -18.475],
      [-9.7, -18.475],
    ],
    [
      [-9.7, -18.475],
      [-9.7, -16.276079261604345],
    ],
    [
      [-9.7, -16.275],
      [-9.7, 0],
    ],
  ];
  return segments.flatMap(([a, b], i): SketchEntity[] => [
    { id: `a${i}`, kind: "point", x: a[0], y: a[1] },
    { id: `b${i}`, kind: "point", x: b[0], y: b[1] },
    { id: `edge${i}`, kind: "line", p1: `a${i}`, p2: `b${i}` },
  ]);
}

it("offsets the reported segmented outline across its tiny endpoint gap without editing the source", () => {
  const source = segmentedOutline(),
    before = JSON.stringify(source);
  const ids = source.filter((e) => e.kind === "line").map((e) => e.id);
  const result = offsetSketchSelection(source, [], ids, -1);
  expect(result.joinedGaps?.count).toBe(1);
  expect(result.joinedGaps?.maxDistance).toBeCloseTo(0.001079261604345, 10);
  const profiles = detectProfiles(result.entities.slice(source.length));
  expect(profiles).toHaveLength(1);
  expect(profiles[0]!.area).toBeCloseTo(21.4 * 36.475, 5);
  expect(JSON.stringify(source)).toBe(before);
  expect(result.entities.slice(0, source.length)).toEqual(source);
  expect(
    offsetSketchSelection(source, [], ids, -1, false, 0).offsetChain?.closed,
  ).toBe(false);
});

it("reports a missing outline segment instead of bridging a real gap", () => {
  const source = segmentedOutline();
  const ids = source
    .filter((e) => e.kind === "line" && e.id !== "edge8")
    .map((e) => e.id);
  expect(ids).toHaveLength(9);
  const result = offsetSketchSelection(source, [], ids, -1);
  expect(result.offsetChain?.closed).toBe(false);
  expect(result.offsetChain?.endGap).toBeCloseTo(2.2, 6);
  const connector = findOffsetConnector(source, ids, result.offsetChain!.ends);
  expect(connector).toBe("edge8");
  const complete = offsetSketchSelection(source, [], [...ids, connector!], -1);
  expect(complete.offsetChain?.closed).toBe(true);
  expect(detectProfiles(complete.entities.slice(source.length))).toHaveLength(
    1,
  );
});

it("does not merge the vertices of a valid short segment", () => {
  const source: SketchEntity[] = [
    { id: "a", kind: "point", x: 0, y: 0 },
    { id: "b", kind: "point", x: 10, y: 0 },
    { id: "c", kind: "point", x: 10.005, y: 0 },
    { id: "d", kind: "point", x: 20, y: 0 },
    { id: "ab", kind: "line", p1: "a", p2: "b" },
    { id: "bc", kind: "line", p1: "b", p2: "c" },
    { id: "cd", kind: "line", p1: "c", p2: "d" },
  ];
  const result = offsetSketchSelection(source, [], ["ab", "bc", "cd"], 1);
  expect(result.joinedGaps).toBeUndefined();
  expect(
    result.entities.slice(source.length).filter((e) => e.kind === "line"),
  ).toHaveLength(3);
});
