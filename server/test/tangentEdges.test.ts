import { beforeAll, expect, it } from "vitest";
import {
  createEmptyDocument,
  type SketchFeature,
  type ExtrudeFeature,
  type EdgeRef,
} from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { tangentEdges } from "../src/geometry/tangentEdges.js";

beforeAll(initKernel, 120000);

it.each([0.001079261604345, 0.1])(
  "only chains tiny connecting steps (%s mm) between parallel edges",
  (step) => {
    const id = `step-chain-${step}`,
      doc = createEmptyDocument(id, id),
      engine = engineFor(id);
    const points: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, step],
      [20, step],
      [20, 10],
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
        ...points.map(([x, y], i) => ({
          id: `p${i}`,
          kind: "point" as const,
          x,
          y,
        })),
        ...points.map((_, i) => ({
          id: `l${i}`,
          kind: "line" as const,
          p1: `p${i}`,
          p2: `p${(i + 1) % points.length}`,
        })),
      ],
    };
    doc.features = [sketch];
    doc.timelinePosition = 1;
    const profile = engine.evaluate(doc).sketches[0]!.profiles[0]!;
    doc.features.push({
      id: "ext",
      name: "Extrude",
      type: "extrude",
      suppressed: false,
      operation: "newBody",
      profiles: [{ sketchId: "sk", profileId: profile.id }],
      distance: 2,
      direction: "normal",
    });
    doc.timelinePosition = 2;
    const payload = engine.evaluate(doc).bodies[0]!;
    const seed: EdgeRef = {
      kind: "edge",
      bodyId: payload.bodyId,
      edgeName: payload.edges.find(
        (e) => e.name.includes("cap:end") && e.name.includes("s:l0"),
      )!.name,
    };
    const body = engine.stateAt(doc).bodies.get(seed.bodyId)!;
    const refs = tangentEdges(body, [seed]);
    expect(refs).toHaveLength(step < 0.01 ? 3 : 1);
    expect(refs.every((r) => r.edgeName.includes("cap:end"))).toBe(true);
    if (step < 0.01)
      expect(refs.some((r) => r.edgeName.includes("s:l1"))).toBe(true);
    dropEngine(id);
  },
);

export function slotSketch(): SketchFeature {
  return {
    id: "slot",
    name: "Slot",
    type: "sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    constraints: [],
    entities: [
      { id: "a", kind: "point", x: 0, y: 10 },
      { id: "b", kind: "point", x: 40, y: 10 },
      { id: "c", kind: "point", x: 40, y: -10 },
      { id: "d", kind: "point", x: 0, y: -10 },
      { id: "left", kind: "point", x: 0, y: 0 },
      { id: "right", kind: "point", x: 40, y: 0 },
      { id: "top", kind: "line", p1: "a", p2: "b" },
      { id: "bottom", kind: "line", p1: "c", p2: "d" },
      { id: "rightArc", kind: "arc", center: "right", start: "c", end: "b" },
      { id: "leftArc", kind: "arc", center: "left", start: "a", end: "d" },
    ],
  };
}

it.each(["fillet", "chamfer"] as const)(
  "chains a rounded perimeter for %s and regenerates after an upstream edit",
  (type) => {
    const id = `tangent-${type}`,
      engine = engineFor(id),
      doc = createEmptyDocument(id, id);
    const sketch = slotSketch();
    doc.features = [sketch];
    doc.timelinePosition = 1;
    const profile = engine.evaluate(doc).sketches[0]!.profiles[0]!;
    const extrude: ExtrudeFeature = {
      id: "solid",
      name: "Solid",
      type: "extrude",
      suppressed: false,
      profiles: [{ sketchId: "slot", profileId: profile.id }],
      distance: 10,
      direction: "normal",
      operation: "newBody",
    };
    doc.features.push(extrude);
    doc.timelinePosition = 2;
    const payload = engine.evaluate(doc).bodies[0]!;
    const seed: EdgeRef = {
      kind: "edge",
      bodyId: payload.bodyId,
      edgeName: payload.edges.find(
        (e) => e.name.includes("cap:end") && e.name.includes("s:top"),
      )!.name,
    };
    const body = engine.stateAt(doc).bodies.get(seed.bodyId)!;
    const refs = tangentEdges(body, [seed]);
    expect(refs).toHaveLength(4);
    expect(refs.every((r) => r.edgeName.includes("cap:end"))).toBe(true);
    expect(tangentEdges(body, [...refs, seed])).toHaveLength(4);
    const vertical = payload.edges.find(
      (e) =>
        e.curve.type === "line" && Math.abs(e.curve.a[2] - e.curve.b[2]) > 5,
    )!;
    expect(
      tangentEdges(body, [{ ...seed, edgeName: vertical.name }]),
    ).toHaveLength(1);
    const baseVolume = volumeOf(body.shape);
    const feature = {
      id: "finish",
      name: "Finish",
      suppressed: false,
      edges: [seed],
      tangentChain: true,
      ...(type === "fillet" ? { type, radius: 1 } : { type, distance: 1 }),
    };
    doc.features.push(feature);
    doc.timelinePosition = 3;
    let result = engine.evaluate(doc);
    expect(result.featureStatuses.at(-1)).toEqual({
      featureId: "finish",
      status: "ok",
    });
    const chainedVolume = volumeOf(
      engine.stateAt(doc).bodies.get(seed.bodyId)!.shape,
    );
    expect(chainedVolume).toBeLessThan(baseVolume);
    feature.edges = refs;
    feature.tangentChain = false;
    result = engine.evaluate(doc);
    expect(result.featureStatuses.at(-1)!.status).toBe("ok");
    expect(
      volumeOf(engine.stateAt(doc).bodies.get(seed.bodyId)!.shape),
    ).toBeCloseTo(chainedVolume, 4);
    feature.edges = [seed];
    feature.tangentChain = true;
    extrude.distance = 15;
    result = engine.evaluate(doc);
    expect(result.featureStatuses.at(-1)!.status).toBe("ok");
    dropEngine(id);
    expect(
      engineFor(id)
        .evaluate(JSON.parse(JSON.stringify(doc)))
        .featureStatuses.at(-1)!.status,
    ).toBe("ok");
    dropEngine(id);
  },
);
