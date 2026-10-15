import { beforeAll, describe, expect, it } from "vitest";
import type {
  ChamferFeature,
  EdgeRef,
  ExtrudeFeature,
  SketchEntity,
  SketchFeature,
} from "@rockett/shared";
import { createEmptyDocument } from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
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
const star = [
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

/** A 7 mm ninja-star plate (all regions joined) plus its top/bottom edge loops. */
function starPlate(id: string) {
  dropEngine(id);
  const sketch: SketchFeature = {
    id: "sk1",
    type: "sketch",
    name: "S",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: star,
    constraints: [],
  };
  const ex: ExtrudeFeature = {
    id: "ex1",
    type: "extrude",
    name: "E",
    suppressed: false,
    profiles: [],
    distance: 7,
    direction: "normal",
    operation: "join",
  };
  const doc = createEmptyDocument(id, "Chamfer");
  doc.features = [sketch, ex];
  doc.timelinePosition = 2;
  const engine = engineFor(id);
  const first = engine.evaluate(doc, 1);
  ex.profiles = first.sketches[0]!.profiles.map((p) => ({
    sketchId: "sk1",
    profileId: p.id,
  }));
  const r = engine.evaluate(doc);
  const body = r.bodies[0]!;
  const loop = (cap: string): EdgeRef[] =>
    body.edges
      .filter((e) => e.name.includes(cap))
      .map((e) => ({ kind: "edge", bodyId: body.bodyId, edgeName: e.name }));
  return {
    engine,
    doc,
    top: loop("cap:end"),
    bot: loop("cap:start"),
    prismVolume: volumeOf(engine.stateAt(doc).bodies.get(body.bodyId)!.shape),
  };
}
const chamfer = (
  id: string,
  edges: EdgeRef[],
  distance: number,
): ChamferFeature => ({
  id,
  type: "chamfer",
  name: id,
  suppressed: false,
  edges,
  distance,
});

describe("chamfer that consumes a face (3.5 + 3.5 on a 7 mm plate)", () => {
  it("both loops in one feature meet at a knife edge: 18 faces, no walls left", () => {
    const { engine, doc, top, bot, prismVolume } = starPlate("che1");
    expect(top).toHaveLength(8);
    expect(bot).toHaveLength(8);
    doc.features.push(chamfer("c1", [...top, ...bot], 3.5));
    doc.timelinePosition = 3;
    const r = engine.evaluate(doc);
    expect(r.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
    expect(r.bodies).toHaveLength(1);
    // 8 top chamfer faces + 8 bottom chamfer faces + 2 caps; the walls are gone
    expect(r.bodies[0]!.faces).toHaveLength(18);
    const vol = volumeOf(
      engine.stateAt(doc).bodies.get(r.bodies[0]!.bodyId)!.shape,
    );
    expect(vol).toBeLessThan(prismVolume);
    expect(vol).toBeGreaterThan(prismVolume * 0.5);
    expect(r.bodies[0]!.bbox.max[2]).toBeCloseTo(7, 6);
  });

  it("top then bottom as two features also succeeds at exactly half the height", () => {
    const { engine, doc, top, bot } = starPlate("che2");
    doc.features.push(chamfer("c1", top, 3.5), chamfer("c2", bot, 3.5));
    doc.timelinePosition = 4;
    const r = engine.evaluate(doc);
    expect(r.featureStatuses.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(r.bodies[0]!.faces).toHaveLength(18);
    // chamfer faces keep the per-edge naming scheme of the normal path
    expect(
      r.bodies[0]!.faces.filter((f) => f.name.startsWith("f:c2:fe:")),
    ).toHaveLength(8);
  });

  it("a star with a central hole (radials construction) chamfers to a knife edge too", () => {
    dropEngine("che5");
    const entities: SketchEntity[] = [
      ...star.map((e) =>
        e.kind === "line" && e.id.startsWith("rad")
          ? { ...e, construction: true }
          : e,
      ),
      P("cc", 0, 0),
      { id: "ci", kind: "circle", center: "cc", radius: 12.5 },
    ];
    const sketch: SketchFeature = {
      id: "sk1",
      type: "sketch",
      name: "S",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities,
      constraints: [],
    };
    const ex: ExtrudeFeature = {
      id: "ex1",
      type: "extrude",
      name: "E",
      suppressed: false,
      profiles: [],
      distance: 7,
      direction: "normal",
      operation: "join",
    };
    const doc = createEmptyDocument("che5", "Holed");
    doc.features = [sketch, ex];
    doc.timelinePosition = 2;
    const engine = engineFor("che5");
    const first = engine.evaluate(doc, 1);
    // 4 points + square-with-hole + the disc: extrude everything but the disc
    const regions = first.sketches[0]!.profiles;
    expect(regions).toHaveLength(6);
    const disc = regions.find(
      (p) => p.outer.length === 1 && p.outer[0]!.entityId === "ci",
    )!;
    ex.profiles = regions
      .filter((p) => p !== disc)
      .map((p) => ({ sketchId: "sk1", profileId: p.id }));
    let r = engine.evaluate(doc);
    const body = r.bodies[0]!;
    // 8 walls + 2 caps + the hole wall
    expect(body.faces).toHaveLength(11);
    const loop = (cap: string): EdgeRef[] =>
      body.edges
        .filter((e) => e.name.includes(cap) && !e.name.includes(":s:ci"))
        .map((e) => ({ kind: "edge", bodyId: body.bodyId, edgeName: e.name }));
    doc.features.push(
      chamfer("c1", loop("cap:end"), 3.5),
      chamfer("c2", loop("cap:start"), 3.5),
    );
    doc.timelinePosition = 4;
    r = engine.evaluate(doc);
    expect(r.featureStatuses.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    // 8 + 8 chamfers + 2 caps + the untouched hole wall
    expect(r.bodies[0]!.faces).toHaveLength(19);
    expect(
      r.bodies[0]!.faces.filter((f) => f.name.startsWith("f:c2:fe:")),
    ).toHaveLength(8);
  });

  it("an ordinary chamfer still goes through the kernel's chamfer algorithm", () => {
    const { engine, doc, top } = starPlate("che3");
    doc.features.push(chamfer("c1", top, 2));
    doc.timelinePosition = 3;
    const r = engine.evaluate(doc);
    expect(r.featureStatuses[2]!.status).toBe("ok");
    // 8 chamfer + 8 walls + 2 caps
    expect(r.bodies[0]!.faces).toHaveLength(18);
    expect(
      r.bodies[0]!.faces.filter((f) => f.name.startsWith("f:c1:fe:")),
    ).toHaveLength(8);
  });

  it("a genuinely impossible chamfer still reports an error", () => {
    const { engine, doc, top } = starPlate("che4");
    doc.features.push(chamfer("c1", top, 10)); // deeper than the plate
    doc.timelinePosition = 3;
    const r = engine.evaluate(doc);
    expect(r.featureStatuses[2]!.status).toBe("error");
  });
});
