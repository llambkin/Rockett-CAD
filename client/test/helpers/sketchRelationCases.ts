import type { SketchEntity } from "@rockett/shared";

export const entities: SketchEntity[] = [
  { id: "q", kind: "point", x: 5, y: 3 },
  { id: "a", kind: "point", x: 1, y: 0 },
  { id: "b", kind: "point", x: 9.5, y: 0 },
  { id: "l1", kind: "line", p1: "a", p2: "b" },
  { id: "d", kind: "point", x: 0, y: 5 },
  { id: "e", kind: "point", x: 4, y: 9 },
  { id: "l2", kind: "line", p1: "d", p2: "e" },
  { id: "c0", kind: "point", x: 0, y: 0 },
  { id: "o1", kind: "circle", center: "c0", radius: 10 },
  { id: "c1", kind: "point", x: 20, y: 0 },
  { id: "s", kind: "point", x: 25, y: 0 },
  { id: "t", kind: "point", x: 20, y: 5 },
  { id: "r1", kind: "arc", center: "c1", start: "s", end: "t" },
];

export const TYPES = [
  "horizontal",
  "vertical",
  "coincident",
  "parallel",
  "perpendicular",
  "tangent",
  "equal",
  "concentric",
  "midpoint",
  "collinear",
  "fix",
] as const;

type Expected = Partial<Record<(typeof TYPES)[number], Record<string, string>>>;

export const toolbarCases: Array<{ ids: string[]; made: Expected }> = [
  {
    ids: ["l1"],
    made: {
      horizontal: { type: "horizontal", line: "l1" },
      vertical: { type: "vertical", line: "l1" },
    },
  },
  {
    ids: ["l1", "l2"],
    made: {
      horizontal: { type: "horizontal", line: "l1" },
      vertical: { type: "vertical", line: "l1" },
      parallel: { type: "parallel", a: "l1", b: "l2" },
      perpendicular: { type: "perpendicular", a: "l1", b: "l2" },
      equal: { type: "equal", a: "l1", b: "l2" },
      collinear: { type: "collinear", a: "l1", b: "l2" },
    },
  },
  { ids: ["q"], made: { fix: { type: "fix", point: "q" } } },
  {
    ids: ["q", "o1"],
    made: {
      coincident: { type: "pointOnCircle", point: "q", circle: "o1" },
      fix: { type: "fix", point: "q" },
    },
  },
  {
    ids: ["q", "l1"],
    made: {
      horizontal: { type: "horizontal", line: "l1" },
      vertical: { type: "vertical", line: "l1" },
      coincident: { type: "pointOnLine", point: "q", line: "l1" },
      midpoint: { type: "midpoint", point: "q", line: "l1" },
      fix: { type: "fix", point: "q" },
    },
  },
  {
    ids: ["a", "l1"],
    made: {
      horizontal: { type: "horizontal", line: "l1" },
      vertical: { type: "vertical", line: "l1" },
      midpoint: { type: "midpoint", point: "a", line: "l1" },
      fix: { type: "fix", point: "a" },
    },
  },
  {
    ids: ["l1", "o1"],
    made: {
      horizontal: { type: "horizontal", line: "l1" },
      vertical: { type: "vertical", line: "l1" },
      coincident: { type: "pointOnCircle", point: "b", circle: "o1" },
      tangent: { type: "tangent", a: "l1", b: "o1" },
    },
  },
  {
    ids: ["o1", "r1"],
    made: {
      tangent: { type: "tangent", a: "o1", b: "r1" },
      equal: { type: "equal", a: "o1", b: "r1" },
      concentric: { type: "concentric", a: "o1", b: "r1" },
    },
  },
  {
    ids: ["q", "b"],
    made: {
      coincident: { type: "coincident", a: "q", b: "b" },
      fix: { type: "fix", point: "q" },
    },
  },
  {
    ids: ["q", "l1", "o1"],
    made: {
      horizontal: { type: "horizontal", line: "l1" },
      vertical: { type: "vertical", line: "l1" },
      coincident: { type: "pointOnCircle", point: "q", circle: "o1" },
      tangent: { type: "tangent", a: "l1", b: "o1" },
      midpoint: { type: "midpoint", point: "q", line: "l1" },
      fix: { type: "fix", point: "q" },
    },
  },
];
