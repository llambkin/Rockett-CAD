import { expect, it } from "vitest";
import {
  defaultPlacement,
  importBounds,
  importSvg,
  placeImport,
  type SketchEntity,
} from "../src/index.js";

const square: SketchEntity[] = [
  { id: "a", kind: "point", x: 10, y: 10 },
  { id: "b", kind: "point", x: 30, y: 10 },
  { id: "c", kind: "point", x: 30, y: 20 },
  { id: "ab", kind: "line", p1: "a", p2: "b" },
  { id: "bc", kind: "line", p1: "b", p2: "c" },
  { id: "o", kind: "point", x: 20, y: 15 },
  { id: "ring", kind: "circle", center: "o", radius: 2 },
];
const at = (entities: SketchEntity[], id: string) =>
  entities.find((e) => e.id === id) as any;

it("measures the bounds of points, circles and arcs", () => {
  expect(importBounds(square)).toEqual({
    minX: 10,
    minY: 10,
    maxX: 30,
    maxY: 20,
  });
  const arc: SketchEntity[] = [
    { id: "c", kind: "point", x: 0, y: 0 },
    { id: "s", kind: "point", x: 5, y: 0 },
    { id: "e", kind: "point", x: -5, y: 0 },
    { id: "arc", kind: "arc", center: "c", start: "s", end: "e" },
  ];
  const b = importBounds(arc);
  expect(b.maxY).toBeCloseTo(5, 3);
  expect(b.minY).toBeCloseTo(0, 6);
});

it("scales, rotates about the centre of the drawing and moves it, keeping ids", () => {
  const placed = placeImport(square, { scale: 2, rotation: 90, x: 100, y: 50 });
  expect(placed.map((e) => e.id)).toEqual(square.map((e) => e.id));
  expect(at(placed, "o")).toMatchObject({ x: 100, y: 50 });
  expect(at(placed, "a").x).toBeCloseTo(110, 9);
  expect(at(placed, "a").y).toBeCloseTo(30, 9);
  expect(at(placed, "c").x).toBeCloseTo(90, 9);
  expect(at(placed, "c").y).toBeCloseTo(70, 9);
  expect(at(placed, "ring").radius).toBe(4);
  expect(at(square, "a")).toMatchObject({ x: 10, y: 10 });
});

it("defaults to the drawing's own size and the sketch origin", () => {
  expect(defaultPlacement(square, null)).toEqual({
    scale: 1,
    rotation: 0,
    x: 0,
    y: 0,
  });
});

it("centres on a target face and shrinks to fit within 80% of it, never enlarging", () => {
  const face = { x: -5, y: 7, width: 10, height: 40 };
  expect(defaultPlacement(square, face)).toEqual({
    scale: 0.4,
    rotation: 0,
    x: -5,
    y: 7,
  });
  const big = { x: 1, y: 2, width: 500, height: 500 };
  expect(defaultPlacement(square, big)).toEqual({
    scale: 1,
    rotation: 0,
    x: 1,
    y: 2,
  });
});

it("places a parsed SVG so its outline lands centred where asked", () => {
  const svg = importSvg(
    '<svg width="20mm" height="10mm" viewBox="0 0 20 10"><rect x="0" y="0" width="20" height="10"/></svg>',
  );
  const placed = placeImport(svg.entities, {
    scale: 3,
    rotation: 0,
    x: 40,
    y: -20,
  });
  const b = importBounds(placed);
  expect(
    [b.minX, b.maxX, b.minY, b.maxY].map((v) => Number(v.toFixed(6))),
  ).toEqual([10, 70, -35, -5]);
});
