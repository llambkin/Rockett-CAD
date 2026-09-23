import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type ChamferFeature,
  type EdgeRef,
  type FilletFeature,
  type SketchFeature,
} from "@rockett/shared";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { getKernel, initKernel, volumeOf } from "../src/geometry/kernel.js";

beforeAll(async () => {
  await initKernel();
}, 120_000);
afterAll(() => {
  dropEngine("fillet-validity-regression");
  dropEngine("edge-refs");
});

it("rejects a completed but invalid rim fillet and preserves the previous solid", () => {
  const { document: doc }: { document: CadDocument } = JSON.parse(
    readFileSync(
      new URL("./fixtures/invalid-top-fillet.json", import.meta.url),
      "utf8",
    ),
  );
  const engine = engineFor("fillet-validity-regression");
  const before = engine.evaluate(doc, doc.features.length - 1);
  expect(
    before.featureStatuses.slice(0, -1).every((s) => s.status === "ok"),
  ).toBe(true);
  const previous = [
    ...engine.stateAt(doc, doc.features.length - 1).bodies.values(),
  ][0]!;
  const volume = volumeOf(previous.shape);
  const fillet = doc.features.at(-1) as FilletFeature;
  for (const radius of [2, 0.5]) {
    fillet.radius = radius;
    const result = engine.evaluate(doc);
    expect(result.featureStatuses.at(-1)).toMatchObject({
      featureId: fillet.id,
      status: "error",
      error: expect.stringContaining("invalid geometry"),
    });
    expect(result.bodies).toEqual(before.bodies);
    const retained = [...engine.stateAt(doc).bodies.values()][0]!;
    expect(volumeOf(retained.shape)).toBeCloseTo(volume, 6);
    const check = new (getKernel().BRepCheck_Analyzer)(
      retained.shape,
      true,
      false,
    );
    try {
      expect(check.IsValid_2()).toBe(true);
    } finally {
      check.delete();
    }
  }
}, 120_000);

function boxWithEdgeOp(
  type: "fillet" | "chamfer",
  tangentChain: boolean,
  refs: (edge: EdgeRef) => EdgeRef[],
) {
  const doc = createEmptyDocument("edge-refs", "edge-refs");
  const engine = engineFor("edge-refs");
  const corners = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const sketch: SketchFeature = {
    id: "sk",
    name: "Sketch",
    type: "sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    constraints: [],
    entities: [
      ...corners.map(([x = 0, y = 0], i) => ({
        id: `p${i}`,
        kind: "point" as const,
        x,
        y,
      })),
      ...corners.map((_, i) => ({
        id: `l${i}`,
        kind: "line" as const,
        p1: `p${i}`,
        p2: `p${(i + 1) % corners.length}`,
      })),
    ],
  };
  doc.features = [sketch];
  doc.timelinePosition = 1;
  const profiles = engine.evaluate(doc).sketches.flatMap((s) => s.profiles);
  expect(profiles).toHaveLength(1);
  doc.features.push({
    id: "ext",
    name: "Extrude",
    type: "extrude",
    suppressed: false,
    operation: "newBody",
    profiles: profiles.map((p) => ({ sketchId: "sk", profileId: p.id })),
    distance: 10,
    direction: "normal",
  });
  doc.timelinePosition = 2;
  const edges = engine.evaluate(doc).bodies.flatMap((b) =>
    b.edges.map((e): EdgeRef => ({
      kind: "edge",
      bodyId: b.bodyId,
      edgeName: e.name,
    })),
  );
  expect(edges).toHaveLength(12);
  const base = { id: "op", name: "Edge op", suppressed: false, tangentChain };
  const edgeRefs = edges.slice(0, 1).flatMap(refs);
  const op: FilletFeature | ChamferFeature =
    type === "fillet"
      ? { ...base, type, edges: edgeRefs, radius: 1 }
      : { ...base, type, edges: edgeRefs, distance: 1 };
  doc.features.push(op);
  doc.timelinePosition = 3;
  return engine.evaluate(doc).featureStatuses.at(-1);
}

it.each([
  ["fillet", false],
  ["fillet", true],
  ["chamfer", false],
  ["chamfer", true],
] as const)(
  "%s (tangent chain %s) rejects edges from another body and missing edges",
  (type, tangentChain) => {
    expect(
      boxWithEdgeOp(type, tangentChain, (edge) => [
        edge,
        { ...edge, bodyId: "other-body" },
      ]),
    ).toMatchObject({
      featureId: "op",
      status: "error",
      error: `${type}: all ${type} edges must belong to the same body`,
    });
    expect(
      boxWithEdgeOp(type, tangentChain, (edge) => [
        edge,
        { ...edge, edgeName: "e:missing" },
      ]),
    ).toMatchObject({
      featureId: "op",
      status: "error",
      error: `${type}: referenced edge no longer exists: e:missing`,
    });
  },
  120_000,
);
