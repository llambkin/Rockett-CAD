import { beforeAll, expect, it } from "vitest";
import {
  createEmptyDocument,
  offsetSketch,
  type SketchEntity,
  type SketchFeature,
  type ExtrudeFeature,
} from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";

beforeAll(() => initKernel(), 120000);
it("extrudes a rounded offset as an exact closed solid", () => {
  const coords = [
    [2, 0],
    [18, 0],
    [20, 2],
    [20, 8],
    [18, 10],
    [2, 10],
    [0, 8],
    [0, 2],
    [18, 2],
    [18, 8],
    [2, 8],
    [2, 2],
  ];
  const source: SketchEntity[] = [
    ...coords.map(([x, y], i) => ({
      id: `p${i}`,
      kind: "point" as const,
      x,
      y,
    })),
    ...[0, 2, 4, 6].map((i) => ({
      id: `l${i}`,
      kind: "line" as const,
      p1: `p${i}`,
      p2: `p${i + 1}`,
    })),
    ...[1, 3, 5, 7].map((i, j) => ({
      id: `a${i}`,
      kind: "arc" as const,
      start: `p${i}`,
      end: `p${(i + 1) % 8}`,
      center: `p${8 + j}`,
    })),
  ];
  const doc = createEmptyDocument("rounded-offset-solid", "Offset");
  const sketch: SketchFeature = {
    id: "sk",
    type: "sketch",
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: offsetSketch(source, [], "l0", -1).entities.slice(source.length),
    constraints: [],
  };
  doc.features = [sketch];
  doc.timelinePosition = 1;
  const engine = engineFor(doc.id);
  try {
    const initial = engine.evaluate(doc);
    expect(initial.sketches[0].profiles).toHaveLength(1);
    const extrude: ExtrudeFeature = {
      id: "ex",
      type: "extrude",
      name: "Extrude",
      suppressed: false,
      profiles: [
        { sketchId: "sk", profileId: initial.sketches[0].profiles[0].id },
      ],
      operation: "newBody",
      distance: 2,
      direction: "normal",
    };
    doc.features.push(extrude);
    doc.timelinePosition = 2;
    const result = engine.evaluate(doc);
    expect(result.featureStatuses.every((s) => s.status === "ok")).toBe(true);
    expect(result.bodies).toHaveLength(1);
    expect(volumeOf(engine.stateAt(doc).bodies.get("b:ex")!.shape)).toBeCloseTo(
      (22 * 12 - (4 - Math.PI) * 9) * 2,
      4,
    );
  } finally {
    dropEngine(doc.id);
  }
});
