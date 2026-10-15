import { beforeAll, describe, expect, it } from "vitest";
import type { ExtrudeFeature, SketchFeature } from "@rockett/shared";
import { createEmptyDocument } from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";

beforeAll(async () => {
  await initKernel();
}, 120_000);

describe("face extrude (extrude from a body surface)", () => {
  it("extrudes the top cap face of a box as a boss", () => {
    dropEngine("fx1");
    const sketch: SketchFeature = {
      id: "sk1",
      type: "sketch",
      name: "Sketch1",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: [
        { id: "pa", kind: "point", x: 0, y: 0 },
        { id: "pb", kind: "point", x: 30, y: 0 },
        { id: "pc", kind: "point", x: 30, y: 20 },
        { id: "pd", kind: "point", x: 0, y: 20 },
        { id: "l1", kind: "line", p1: "pa", p2: "pb" },
        { id: "l2", kind: "line", p1: "pb", p2: "pc" },
        { id: "l3", kind: "line", p1: "pc", p2: "pd" },
        { id: "l4", kind: "line", p1: "pd", p2: "pa" },
      ],
      constraints: [],
    };
    const extrude: ExtrudeFeature = {
      id: "ext1",
      type: "extrude",
      name: "Extrude1",
      suppressed: false,
      profiles: [{ sketchId: "sk1", profileId: "" }],
      distance: 10,
      direction: "normal",
      operation: "newBody",
    };
    const faceBoss: ExtrudeFeature = {
      id: "ext2",
      type: "extrude",
      name: "Extrude2",
      suppressed: false,
      profiles: [],
      faces: [{ kind: "face", bodyId: "b:ext1", faceName: "f:ext1:cap:end" }],
      distance: 5,
      direction: "normal",
      operation: "join",
    };
    const doc = createEmptyDocument("fx1", "FaceExtrude");
    doc.features = [sketch, extrude, faceBoss];
    doc.timelinePosition = 3;

    const engine = engineFor("fx1");
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0]!.profileId =
      result.sketches[0]!.profiles[0]!.id;
    result = engine.evaluate(doc);
    expect(result.featureStatuses.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
    expect(result.bodies).toHaveLength(1);
    // box 30x20x10 plus boss 30x20x5 on top = single body 30x20x15
    expect(Math.round(result.bodies[0]!.bbox.max[2])).toBe(15);
    const vol = volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape);
    expect(vol).toBeCloseTo(30 * 20 * 15, 2);
  });

  it("cuts a pocket by reverse-extruding a face", () => {
    dropEngine("fx2");
    const doc = createEmptyDocument("fx2", "FacePocket");
    doc.features = [
      {
        id: "sk1",
        type: "sketch",
        name: "Sketch1",
        suppressed: false,
        plane: { kind: "origin", plane: "XY" },
        entities: [
          { id: "pa", kind: "point", x: 0, y: 0 },
          { id: "pb", kind: "point", x: 40, y: 0 },
          { id: "pc", kind: "point", x: 40, y: 40 },
          { id: "pd", kind: "point", x: 0, y: 40 },
          { id: "l1", kind: "line", p1: "pa", p2: "pb" },
          { id: "l2", kind: "line", p1: "pb", p2: "pc" },
          { id: "l3", kind: "line", p1: "pc", p2: "pd" },
          { id: "l4", kind: "line", p1: "pd", p2: "pa" },
        ],
        constraints: [],
      },
      {
        id: "ext1",
        type: "extrude",
        name: "Extrude1",
        suppressed: false,
        profiles: [{ sketchId: "sk1", profileId: "" }],
        distance: 20,
        direction: "normal",
        operation: "newBody",
      } as ExtrudeFeature,
      {
        id: "ext2",
        type: "extrude",
        name: "Extrude2",
        suppressed: false,
        profiles: [],
        faces: [{ kind: "face", bodyId: "b:ext1", faceName: "f:ext1:cap:end" }],
        distance: 8,
        direction: "reverse",
        operation: "cut",
      } as ExtrudeFeature,
    ];
    doc.timelinePosition = 3;
    const engine = engineFor("fx2");
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0]!.profileId =
      result.sketches[0]!.profiles[0]!.id;
    result = engine.evaluate(doc);
    expect(result.featureStatuses.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
    ]);
    // full-face pocket 8 deep → height reduced to 12
    const vol = volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape);
    expect(vol).toBeCloseTo(40 * 40 * 12, 2);
  });
});
