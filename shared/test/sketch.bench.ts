import { test } from "vitest";
import { solveSketch } from "../src/solver.js";
import {
  arcAngles,
  detectProfiles,
  pointInPolygon,
  profileIdFor,
  sampleArc,
} from "../src/profiles.js";
import {
  findOffsetConnector,
  modifySketch,
  offsetSketch,
  offsetSketchSelection,
  offsetSourceIds,
} from "../src/sketchModify.js";
import type { SketchConstraint, SketchEntity } from "../src/model.js";

const SAMPLES = { time: 200, warmupTime: 50 };

const pt = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const ln = (id: string, p1: string, p2: string): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
});

const rectangle: SketchEntity[] = [
  pt("a", 0, 0),
  pt("b", 91, 2),
  pt("c", 88, 41),
  pt("d", -2, 39),
  ln("l1", "a", "b"),
  ln("l2", "b", "c"),
  ln("l3", "c", "d"),
  ln("l4", "d", "a"),
];
const dimensions: SketchConstraint[] = [
  { id: "f", type: "fix", point: "a" },
  { id: "h1", type: "horizontal", line: "l1" },
  { id: "h2", type: "horizontal", line: "l3" },
  { id: "v1", type: "vertical", line: "l2" },
  { id: "v2", type: "vertical", line: "l4" },
  { id: "d1", type: "length", line: "l1", value: 100 },
  { id: "d2", type: "length", line: "l2", value: 50 },
];

const plate: SketchEntity[] = [
  pt("a", 0, 0),
  pt("b", 100, 0),
  pt("c", 100, 50),
  pt("d", 0, 50),
  ln("l1", "a", "b"),
  ln("l2", "b", "c"),
  ln("l3", "c", "d"),
  ln("l4", "d", "a"),
  pt("hc", 30, 25),
  { id: "hole", kind: "circle", center: "hc", radius: 10 },
  pt("ac", 70, 25),
  pt("as", 80, 25),
  pt("ae", 60, 25),
  { id: "arc", kind: "arc", center: "ac", start: "as", end: "ae" },
  ln("chord", "ae", "as"),
];

const branchedBox: SketchEntity[] = [
  pt("a", 0, 0),
  pt("b", 20, 0),
  pt("c", 20, 10),
  pt("d", 0, 10),
  pt("e", -10, 0),
  ln("bottom", "a", "b"),
  ln("right", "c", "b"),
  ln("top", "c", "d"),
  ln("left", "d", "a"),
  ln("branch", "a", "e"),
];
const openSides = ["bottom", "right", "top"];
const openEnds = offsetSketchSelection(branchedBox, [], openSides, 1)
  .offsetChain!.ends;

const crossed: SketchEntity[] = [
  pt("base-a", 0, 0),
  pt("base-b", 20, 0),
  ln("base", "base-a", "base-b"),
  pt("x-a", 5, -5),
  pt("x-b", 5, 5),
  ln("x", "x-a", "x-b"),
  pt("y-a", 15, -5),
  pt("y-b", 15, 5),
  ln("y", "y-a", "y-b"),
];

const quarter = { cx: 0, cy: 0, sx: 10, sy: 0, ex: 0, ey: 10 };
const circle = sampleArc(0, 0, 10, 0, 10, 0, 64);

const call =
  <A extends unknown[]>(fn: (...args: A) => unknown, ...args: A) =>
  () =>
    fn(...args);

const cases: [string, () => unknown][] = [
  [
    "solveSketch dimensioned rectangle",
    call(solveSketch, { entities: rectangle, constraints: dimensions }),
  ],
  ["detectProfiles plate with hole and arc", call(detectProfiles, plate)],
  ["arcAngles quarter arc", call(arcAngles, quarter)],
  ["sampleArc quarter arc", call(sampleArc, 0, 0, 10, 0, 0, 10)],
  ["pointInPolygon 64 gon", call(pointInPolygon, 3, 4, circle)],
  [
    "profileIdFor plate with hole",
    call(profileIdFor, ["l1", "l2", "l3", "l4"], [["hole"]]),
  ],
  [
    "modifySketch trim middle",
    call(modifySketch, crossed, [], "base", { x: 10, y: 0 }, "trim"),
  ],
  [
    "offsetSketch chained box",
    call(offsetSketch, branchedBox, [], "bottom", 1),
  ],
  [
    "offsetSketchSelection box sides",
    call(offsetSketchSelection, branchedBox, [], openSides.concat("left"), 1),
  ],
  [
    "offsetSourceIds chained box",
    call(offsetSourceIds, branchedBox, ["bottom"], true),
  ],
  [
    "findOffsetConnector open box",
    call(findOffsetConnector, branchedBox, openSides, openEnds),
  ],
];

test.for(cases)("%s", async ([name, fn], { bench }) => {
  await bench(name, fn).run(SAMPLES);
});
