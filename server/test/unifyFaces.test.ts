import { beforeAll, describe, expect, it } from "vitest";
import type {
  ExtrudeFeature,
  SketchEntity,
  SketchFeature,
} from "@rockett/shared";
import { createEmptyDocument } from "@rockett/shared";
import {
  getKernel,
  initKernel,
  solids,
  volumeOf,
} from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";

beforeAll(async () => {
  await initKernel();
}, 120_000);

const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (id: string, p1: string, p2: string): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
});

/** Evaluate the sketch alone, then extrude ALL of its regions in one feature. */
function extrudeAllRegions(
  projectId: string,
  entities: SketchEntity[],
  distance: number,
  operation: ExtrudeFeature["operation"] = "join",
) {
  dropEngine(projectId);
  const sketch: SketchFeature = {
    id: "sk1",
    type: "sketch",
    name: "Sketch1",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities,
    constraints: [],
  };
  const extrude: ExtrudeFeature = {
    id: "ext1",
    type: "extrude",
    name: "Extrude1",
    suppressed: false,
    profiles: [],
    distance,
    direction: "normal",
    operation,
  };
  const doc = createEmptyDocument(projectId, "Unify");
  doc.features = [sketch, extrude];
  doc.timelinePosition = 2;
  const engine = engineFor(projectId);
  const first = engine.evaluate(doc, 1);
  extrude.profiles = first.sketches[0].profiles.map((p) => ({
    sketchId: "sk1",
    profileId: p.id,
  }));
  const result = engine.evaluate(doc);
  return { result, regions: first.sketches[0].profiles.length, engine, doc };
}

const twoRects = () => [
  P("a", 0, 0),
  P("b", 10, 0),
  P("c", 20, 0),
  P("d", 20, 10),
  P("e", 10, 10),
  P("f", 0, 10),
  L("l1", "a", "b"),
  L("l2", "b", "c"),
  L("l3", "c", "d"),
  L("l4", "d", "e"),
  L("l5", "e", "f"),
  L("l6", "f", "a"),
  L("mid", "b", "e"),
];

describe("multi-region extrude: New body keeps regions apart, Join merges them", () => {
  it("removes the shared seam when adjacent regions are extruded in separate features", () => {
    const { engine, doc } = extrudeAllRegions("uni-sequential", twoRects(), 5);
    const first = doc.features[1] as ExtrudeFeature;
    const [left, right] = first.profiles;
    first.profiles = [left];
    first.operation = "newBody";
    doc.features.push({
      ...first,
      id: "ext2",
      name: "Extrude2",
      profiles: [right],
      operation: "join",
    });
    doc.timelinePosition = 3;
    const result = engine.evaluate(doc);
    expect(result.featureStatuses.every((s) => s.status === "ok")).toBe(true);
    expect(result.bodies).toHaveLength(1);
    expect(result.bodies[0].bodyId).toBe("b:ext1");
    expect(result.bodies[0].faces).toHaveLength(6);
    expect(result.bodies[0].edges).toHaveLength(12);
    const body = engine.stateAt(doc).bodies.get("b:ext1")!;
    expect(solids(body.shape)).toHaveLength(1);
    expect(volumeOf(body.shape)).toBeCloseTo(1000, 6);
    const check = new (getKernel().BRepCheck_Analyzer)(body.shape, true, false);
    expect(check.IsValid_2()).toBe(true);
    check.delete();
  });

  it("New body makes one body per region, ids b:<feature> and b:<feature>:2", () => {
    const { result, engine, doc } = extrudeAllRegions(
      "uni0",
      twoRects(),
      5,
      "newBody",
    );
    expect(result.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok"]);
    expect(result.bodies.map((b) => b.bodyId).sort()).toEqual([
      "b:ext1",
      "b:ext1:2",
    ]);
    for (const b of result.bodies) expect(b.faces).toHaveLength(6);
    const state = engine.stateAt(doc);
    expect(volumeOf(state.bodies.get("b:ext1")!.shape)).toBeCloseTo(
      10 * 10 * 5,
      2,
    );
    expect(volumeOf(state.bodies.get("b:ext1:2")!.shape)).toBeCloseTo(
      10 * 10 * 5,
      2,
    );
  });

  it("Join of two rectangles sharing an edge gives a plain box: 6 faces, one cap name", () => {
    const { result, regions, engine, doc } = extrudeAllRegions(
      "uni1",
      twoRects(),
      5,
    );
    expect(regions).toBe(2);
    expect(result.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok"]);
    expect(result.bodies).toHaveLength(1);
    const names = result.bodies[0].faces.map((f) => f.name).sort();
    expect(names).toHaveLength(6);
    expect(names).toContain("f:ext1:cap:start");
    expect(names).toContain("f:ext1:cap:end");
    // no ~n split suffixes survive the merge
    expect(names.some((n) => n.includes("~"))).toBe(false);
    expect(
      volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape),
    ).toBeCloseTo(20 * 10 * 5, 2);
  });

  it("the ninja star's 12 regions joined extrude to one 10-face solid", () => {
    const entities = [
      P("A", -25, -25),
      P("B", 25, -25),
      P("C", 25, 25),
      P("D", -25, 25),
      L("sq1", "A", "B"),
      L("sq2", "B", "C"),
      L("sq3", "C", "D"),
      L("sq4", "D", "A"),
      P("O", 0, 0),
      P("Dn", 0, -75),
      P("Rt", 75, 0),
      P("Up", 0, 75),
      P("Lf", -75, 0),
      L("rad1", "O", "Dn"),
      L("rad2", "O", "Rt"),
      L("rad3", "O", "Up"),
      L("rad4", "O", "Lf"),
      L("o1", "A", "Lf"),
      L("o2", "Lf", "D"),
      L("o3", "D", "Up"),
      L("o4", "Up", "C"),
      L("o5", "C", "Rt"),
      L("o6", "Rt", "B"),
      L("o7", "B", "Dn"),
      L("o8", "Dn", "A"),
    ];
    const { result, regions, engine, doc } = extrudeAllRegions(
      "uni2",
      entities,
      4,
    );
    expect(regions).toBe(12);
    expect(result.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok"]);
    expect(result.bodies).toHaveLength(1);
    // 8 outline walls + 2 caps; the radials and square edges leave no trace
    expect(result.bodies[0].faces).toHaveLength(10);
    expect(
      volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape),
    ).toBeCloseTo(7500 * 4, 1);
  });

  it("a circle split by a crossing line extrudes as two half-disc bodies", () => {
    dropEngine("uni4");
    const entities: SketchEntity[] = [
      P("a", 0, 0),
      P("b", 40, 0),
      P("c", 40, 20),
      P("d", 0, 20),
      L("l1", "a", "b"),
      L("l2", "b", "c"),
      L("l3", "c", "d"),
      L("l4", "d", "a"),
      P("cc", 20, 10),
      { id: "ci", kind: "circle", center: "cc", radius: 5 },
      P("m1", 0, 10),
      P("m2", 40, 10),
      L("cut", "m1", "m2"),
    ];
    const sketch: SketchFeature = {
      id: "sk1",
      type: "sketch",
      name: "Sketch1",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities,
      constraints: [],
    };
    const extrude: ExtrudeFeature = {
      id: "ext1",
      type: "extrude",
      name: "Extrude1",
      suppressed: false,
      profiles: [],
      distance: 10,
      direction: "normal",
      operation: "newBody",
    };
    const doc = createEmptyDocument("uni4", "HalfDiscs");
    doc.features = [sketch, extrude];
    doc.timelinePosition = 2;
    const engine = engineFor("uni4");
    const first = engine.evaluate(doc, 1);
    const halves = first.sketches[0].profiles.filter((p) => p.area < 100);
    expect(halves).toHaveLength(2);
    extrude.profiles = halves.map((p) => ({
      sketchId: "sk1",
      profileId: p.id,
    }));
    const result = engine.evaluate(doc);
    expect(result.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok"]);
    expect(result.bodies).toHaveLength(2);
    const state = engine.stateAt(doc);
    for (const id of ["b:ext1", "b:ext1:2"]) {
      expect(volumeOf(state.bodies.get(id)!.shape)).toBeCloseTo(
        (Math.PI * 25 * 10) / 2,
        1,
      );
    }
  });

  it("a single region is untouched by the merge", () => {
    const entities = [
      P("a", 0, 0),
      P("b", 30, 0),
      P("c", 30, 20),
      P("d", 0, 20),
      L("l1", "a", "b"),
      L("l2", "b", "c"),
      L("l3", "c", "d"),
      L("l4", "d", "a"),
    ];
    const { result } = extrudeAllRegions("uni3", entities, 10);
    const names = result.bodies[0].faces.map((f) => f.name).sort();
    expect(names).toEqual(
      [
        "f:ext1:cap:end",
        "f:ext1:cap:start",
        "f:ext1:s:l1",
        "f:ext1:s:l2",
        "f:ext1:s:l3",
        "f:ext1:s:l4",
      ].sort(),
    );
  });
});
