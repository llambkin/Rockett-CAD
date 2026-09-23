import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type ExtrudeFeature,
  type SketchFeature,
} from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { evaluateFeature } from "../src/geometry/features.js";

vi.mock("../src/geometry/features.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/geometry/features.js")>();
  return { ...actual, evaluateFeature: vi.fn(actual.evaluateFeature) };
});

beforeAll(initKernel, 120000);

const evaluated = vi.mocked(evaluateFeature);
beforeEach(() => {
  evaluated.mockClear();
});
const evaluatedIds = () => evaluated.mock.calls.map(([, f]) => f.id);

function square(id: string, size: number): SketchFeature {
  const pts: [number, number][] = [
    [0, 0],
    [size, 0],
    [size, size],
    [0, size],
  ];
  return {
    id,
    name: id,
    type: "sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    constraints: [],
    entities: [
      ...pts.map(([x, y], i) => ({
        id: `p${i}`,
        kind: "point" as const,
        x,
        y,
      })),
      ...pts.map((_, i) => ({
        id: `l${i}`,
        kind: "line" as const,
        p1: `p${i}`,
        p2: `p${(i + 1) % pts.length}`,
      })),
    ],
  };
}

function fourSketchDoc(id: string) {
  const doc = createEmptyDocument(id, id);
  doc.features = ["s0", "s1", "s2", "s3"].map((f, i) => square(f, i + 1));
  doc.timelinePosition = doc.features.length;
  return doc;
}

it("keeps downstream snapshots when a query evaluates an earlier position", () => {
  const id = "cache-rewind",
    doc = fourSketchDoc(id),
    engine = engineFor(id);
  engine.evaluate(doc);
  expect(evaluatedIds()).toEqual(["s0", "s1", "s2", "s3"]);

  evaluated.mockClear();
  engine.evaluate(doc, 1);
  engine.stateAt(doc, 2);
  const full = engine.evaluate(doc);
  expect(evaluatedIds()).toEqual([]);
  expect(full.featureStatuses.map((s) => s.status)).toEqual([
    "ok",
    "ok",
    "ok",
    "ok",
  ]);
  dropEngine(id);
});

it("still re-evaluates from an edited feature onward", () => {
  const id = "cache-edit",
    doc = fourSketchDoc(id),
    engine = engineFor(id);
  engine.evaluate(doc);
  doc.features[1] = square("s1", 7);

  evaluated.mockClear();
  engine.evaluate(doc, 1);
  expect(evaluatedIds()).toEqual([]);
  engine.evaluate(doc);
  expect(evaluatedIds()).toEqual(["s1", "s2", "s3"]);
  dropEngine(id);
});

it("move ignores later features", () => {
  const id = "cache-move-later",
    doc = createEmptyDocument(id, id),
    engine = engineFor(id);
  doc.features = [square("s0", 1), square("free", 3)];
  doc.timelinePosition = doc.features.length;
  const sketchesOf = () => engine.evaluate(doc).sketches;
  const [p0, pFree] = ["s0", "free"].map(
    (skId) => sketchesOf().find((s) => s.featureId === skId)!.profiles[0]!.id,
  );
  const extrude = (
    fid: string,
    sketchId: string,
    profileId: string,
  ): ExtrudeFeature => ({
    id: fid,
    name: fid,
    type: "extrude",
    suppressed: false,
    profiles: [{ sketchId, profileId }],
    distance: 1,
    direction: "normal",
    operation: "newBody",
  });
  doc.features = [
    square("s0", 1),
    extrude("box:s2", "s0", p0!),
    square("free", 3),
    {
      id: "mv",
      name: "mv",
      type: "move",
      suppressed: false,
      bodies: ["b:box:s2"],
      translation: [0, 0, 5],
    },
    extrude("box", "free", pFree!),
  ];
  doc.timelinePosition = doc.features.length;
  const origin = (skId: string) =>
    sketchesOf().find((s) => s.featureId === skId)!.frame.origin;
  expect(origin("s0")).toEqual([0, 0, 5]);
  expect(origin("free")).toEqual([0, 0, 0]);
  dropEngine(id);
});
