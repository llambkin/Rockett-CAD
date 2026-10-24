import { beforeAll, expect, it } from "vitest";
import { createEmptyDocument, type SketchEntity } from "@rockett/shared";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import {
  bboxOf,
  initKernel,
  isValidShape,
  volumeOf,
  release,
} from "../src/geometry/kernel.js";
import { tangentEdges } from "../src/geometry/tangentEdges.js";
import { computeEdgeNames } from "../src/geometry/naming.js";

beforeAll(initKernel, 120_000);

function rectangle(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  split = false,
): SketchEntity[] {
  const points = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  if (split) points.splice(1, 0, [x + w / 2, y]);
  return [
    ...points.map(([x, y], i) => ({
      kind: "point" as const,
      id: id + i,
      x: x!,
      y: y!,
    })),
    ...points.map((_, i) => ({
      kind: "line" as const,
      id: id + "l" + i,
      p1: id + i,
      p2: id + ((i + 1) % points.length),
    })),
  ];
}

it.each([
  [1, true, false],
  [2, true, false],
  [1, false, false],
  [2, false, false],
  [2, true, true],
  [4, true, false],
] as const)(
  "keeps a valid solid for a %s mm inner chamfer (chain %s, split boundary %s)",
  (distance, tangentChain, split) => {
    const doc = createEmptyDocument("inner-chamfer", "Inner chamfer");
    const engine = engineFor(doc.id);
    try {
      doc.features = [
        {
          id: "sk",
          type: "sketch",
          name: "Sketch",
          suppressed: false,
          plane: { kind: "origin", plane: "XY" },
          constraints: [],
          entities: [
            ...rectangle("base", 0, 0, 20, 20),
            ...rectangle("left", -3, 0, 3, 20, split),
            ...rectangle("bottom", 0, -3, 20, 3),
            ...rectangle("top", 0, 20, 20, 3),
          ],
        },
      ];
      doc.timelinePosition = 1;
      const profiles = engine.evaluate(doc).sketches[0]!.profiles;
      const refs = (area: number) =>
        profiles
          .filter((p) => Math.abs(p.area - area) < 1e-5)
          .map((p) => ({ sketchId: "sk", profileId: p.id }));
      doc.features.push(
        {
          id: "base",
          type: "extrude",
          name: "Base",
          suppressed: false,
          profiles: refs(400),
          distance: 12,
          direction: "normal",
          operation: "newBody",
        },
        {
          id: "fins",
          type: "extrude",
          name: "Fins",
          suppressed: false,
          profiles: refs(60),
          distance: 0.8,
          startOffset: 3,
          direction: "normal",
          operation: "join",
        },
      );
      doc.timelinePosition = 3;
      engine.evaluate(doc);
      const body = engine.stateAt(doc).bodies.get("b:base")!;
      const before = volumeOf(body.shape);
      const byName = computeEdgeNames(body).byName;
      const edge = [...byName].find(([, e]) => {
        const b = bboxOf(e);
        return (
          Math.abs(b.min[0]) < 1e-5 &&
          Math.abs(b.max[0]) < 1e-5 &&
          Math.abs(b.min[2] - 3) < 1e-5 &&
          Math.abs(b.max[2] - 3) < 1e-5 &&
          b.max[1] - b.min[1] > 19.9
        );
      })!;
      expect(edge).toBeDefined();
      release(byName.values());
      const seed = {
        kind: "edge" as const,
        bodyId: body.bodyId,
        edgeName: edge[0],
      };
      expect(tangentEdges(body, [seed])).toHaveLength(3);
      expect(tangentEdges(body, [seed], true)).toEqual([seed]);
      doc.features.push({
        id: "chamfer",
        type: "chamfer",
        name: "Chamfer",
        suppressed: false,
        distance,
        tangentChain,
        edges: [seed],
      });
      doc.timelinePosition = 4;
      const result = engine.evaluate(doc);
      expect(result.featureStatuses.at(-1)).toMatchObject({
        status: distance > 3 ? "error" : "ok",
      });
      const final = engine.stateAt(doc).bodies.get(body.bodyId)!;
      expect(isValidShape(final.shape)).toBe(true);
      if (distance <= 3)
        expect([...final.names.values()]).toContain("f:chamfer:fe:1");
      expect(volumeOf(final.shape)).toBeCloseTo(
        distance > 3 ? before : before + (20 * distance * distance) / 2,
        4,
      );
    } finally {
      dropEngine(doc.id);
    }
  },
);

it("stops an inner chamfer at a flat seam left by intersecting cuts", () => {
  const doc = createEmptyDocument("pocket-seam", "Pocket seam");
  const engine = engineFor(doc.id);
  try {
    const profiles = [
      ["base", 0, 0, 20, 30],
      ["pocket", 3, 3, 14, 24],
      ["slot", 0, 10, 20, 10],
    ] as const;
    for (const [id, x, y, w, h] of profiles) {
      doc.features.push({
        id: id + "sk",
        type: "sketch",
        name: id,
        suppressed: false,
        plane: { kind: "origin", plane: "XY" },
        entities: rectangle(id, x, y, w, h),
        constraints: [],
      });
      doc.timelinePosition = doc.features.length;
      const profile = engine.evaluate(doc).sketches.at(-1)!.profiles[0]!;
      doc.features.push({
        id,
        type: "extrude",
        name: id,
        suppressed: false,
        profiles: [{ sketchId: id + "sk", profileId: profile.id }],
        distance: id === "base" ? 6 : 3,
        startOffset: id === "base" ? 0 : 3,
        direction: "normal",
        operation: id === "base" ? "newBody" : "cut",
      });
      doc.timelinePosition = doc.features.length;
    }
    engine.evaluate(doc);
    const body = engine.stateAt(doc).bodies.get("b:base")!;
    const before = volumeOf(body.shape);
    const byName = computeEdgeNames(body).byName;
    const entry = [...byName].find(([, e]) => {
      const b = bboxOf(e);
      return (
        Math.abs(b.min[0] - 3) < 1e-5 &&
        Math.abs(b.max[0] - 3) < 1e-5 &&
        Math.abs(b.min[2] - 3) < 1e-5 &&
        Math.abs(b.max[2] - 3) < 1e-5 &&
        Math.abs(b.min[1] - 3) < 1e-5 &&
        Math.abs(b.max[1] - 10) < 1e-5
      );
    })!;
    release(byName.values());
    expect(entry).toBeDefined();
    const seed = {
      kind: "edge" as const,
      bodyId: body.bodyId,
      edgeName: entry[0],
    };
    expect(tangentEdges(body, [seed]).length).toBeGreaterThan(1);
    expect(tangentEdges(body, [seed], true)).toEqual([seed]);
    doc.features.push({
      id: "chamfer",
      type: "chamfer",
      name: "Chamfer",
      suppressed: false,
      distance: 2.9,
      tangentChain: true,
      edges: [seed],
    });
    doc.timelinePosition = doc.features.length;
    expect(engine.evaluate(doc).featureStatuses.at(-1)).toMatchObject({
      status: "ok",
    });
    const final = engine.stateAt(doc).bodies.get(body.bodyId)!;
    expect(isValidShape(final.shape)).toBe(true);
    expect(volumeOf(final.shape)).toBeCloseTo(before + (7 * 2.9 ** 2) / 2, 4);
  } finally {
    dropEngine(doc.id);
  }
});
