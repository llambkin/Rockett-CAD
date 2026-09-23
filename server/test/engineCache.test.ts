import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  detectProfiles,
  type ExtrudeFeature,
  type SketchFeature,
} from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import {
  engineFor,
  dropEngine,
  type DocumentEngine,
} from "../src/geometry/engine.js";
import { evaluateFeature } from "../src/geometry/features.js";
import { tessellateBody } from "../src/geometry/tessellate.js";
import { manyBodyPart } from "./helpers/perfFixtures.js";

vi.mock("../src/geometry/features.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/geometry/features.js")>();
  return { ...actual, evaluateFeature: vi.fn(actual.evaluateFeature) };
});
vi.mock("../src/geometry/tessellate.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/geometry/tessellate.js")>();
  return { ...actual, tessellateBody: vi.fn(actual.tessellateBody) };
});

beforeAll(initKernel, 120000);

const evaluated = vi.mocked(evaluateFeature);
const tessellated = vi.mocked(tessellateBody);
beforeEach(() => {
  evaluated.mockClear();
  tessellated.mockClear();
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

function boxDoc(id: string) {
  const doc = createEmptyDocument(id, id),
    sketch = square("s0", 2);
  doc.features = [
    sketch,
    {
      id: "box",
      name: "box",
      type: "extrude",
      suppressed: false,
      profiles: [
        { sketchId: "s0", profileId: detectProfiles(sketch.entities)[0]!.id },
      ],
      distance: 1,
      direction: "normal",
      operation: "newBody",
    },
  ];
  doc.timelinePosition = doc.features.length;
  return doc;
}

it("keeps the 8 most recently used engines and releases the one it evicts", () => {
  const docs = Array.from({ length: 20 }, (_, i) => boxDoc(`lru-${i}`));
  const engines: DocumentEngine[] = [];
  const shapes = docs.map((doc, i) => {
    const engine = engineFor(doc.id);
    engines[i] = engine;
    engine.evaluate(doc);
    if (i === 15) expect(engineFor(docs[8]!.id)).toBe(engines[8]);
    return engine.stateAt(doc).bodies.get("b:box")!.shape;
  });

  const kept = [8, 13, 14, 15, 16, 17, 18, 19];
  const evicted = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12];
  for (const i of kept) expect(shapes[i]!.isDeleted()).toBe(false);
  for (const i of evicted) expect(shapes[i]!.isDeleted()).toBe(true);
  for (const i of kept) expect(engineFor(docs[i]!.id)).toBe(engines[i]);

  evaluated.mockClear();
  const again = engineFor(docs[0]!.id);
  expect(again).not.toBe(engines[0]);
  expect(again.evaluate(docs[0]!).bodies).toHaveLength(1);
  expect(evaluatedIds()).toEqual(["s0", "box"]);
  expect(shapes[8]!.isDeleted()).toBe(true);
  expect(shapes[13]!.isDeleted()).toBe(false);
  for (const doc of docs) dropEngine(doc.id);
});

it(
  "re-evaluates an unchanged or renamed 1,000-body document without tessellating",
  {
    timeout: 300_000,
  },
  () => {
    const doc = manyBodyPart(),
      engine = engineFor(doc.id);
    expect(engine.evaluate(doc).bodies).toHaveLength(1000);
    expect(tessellated.mock.calls.length).toBe(1000);

    tessellated.mockClear();
    expect(engine.evaluate(doc).bodies).toHaveLength(1000);
    expect(tessellated.mock.calls.length).toBe(0);

    doc.bodyMeta["b:box"] = { name: "Renamed", visible: false };
    const renamed = engine
      .evaluate(doc)
      .bodies.find((b) => b.bodyId === "b:box");
    expect(renamed).toMatchObject({ name: "Renamed", visible: false });
    expect(tessellated.mock.calls.length).toBe(0);
    dropEngine(doc.id);
  },
);
