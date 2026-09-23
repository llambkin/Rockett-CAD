import { beforeAll, describe, expect, it } from "vitest";
import type {
  ExtrudeFeature,
  SketchEntity,
  SketchFeature,
} from "@rockett/shared";
import { createEmptyDocument } from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { validateFeature } from "../src/api/validate.js";

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
const square = [
  P("a", 0, 0),
  P("b", 20, 0),
  P("c", 20, 20),
  P("d", 0, 20),
  L("l1", "a", "b"),
  L("l2", "b", "c"),
  L("l3", "c", "d"),
  L("l4", "d", "a"),
];

function build(
  id: string,
  distance: number,
  direction: ExtrudeFeature["direction"],
  operation: ExtrudeFeature["operation"] = "newBody",
  startOffset?: number,
) {
  dropEngine(id);
  const sketch: SketchFeature = {
    id: "sk",
    type: "sketch",
    name: "S",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: square,
    constraints: [],
  };
  const ex: ExtrudeFeature = {
    id: "ex",
    type: "extrude",
    name: "E",
    suppressed: false,
    profiles: [],
    distance,
    direction,
    operation,
    ...(startOffset !== undefined ? { startOffset } : {}),
  };
  const doc = createEmptyDocument(id, "Signed");
  doc.features = [sketch, ex];
  doc.timelinePosition = 2;
  const engine = engineFor(id);
  const first = engine.evaluate(doc, 1);
  ex.profiles = [
    { sketchId: "sk", profileId: first.sketches[0]!.profiles[0]!.id },
  ];
  return { engine, doc, result: engine.evaluate(doc) };
}

describe("signed extrude distance", () => {
  it("a negative distance extrudes to the other side of the sketch plane", () => {
    const { result } = build("se1", -7, "normal");
    expect(result.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok"]);
    const b = result.bodies[0]!;
    expect(b.bbox.min[2]).toBeCloseTo(-7, 6);
    expect(b.bbox.max[2]).toBeCloseTo(0, 6);
  });

  it("negative + Reversed comes back to the front side; symmetric ignores the sign", () => {
    const back = build("se2", -7, "reverse").result.bodies[0]!;
    expect(back.bbox.min[2]).toBeCloseTo(0, 6);
    expect(back.bbox.max[2]).toBeCloseTo(7, 6);
    const sym = build("se3", -8, "symmetric").result.bodies[0]!;
    expect(sym.bbox.min[2]).toBeCloseTo(-4, 6);
    expect(sym.bbox.max[2]).toBeCloseTo(4, 6);
  });

  it("a negative cut removes material from a body behind the sketch plane", () => {
    dropEngine("se4");
    const base: SketchFeature = {
      id: "sk0",
      type: "sketch",
      name: "Base",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: [
        P("a", -10, -10),
        P("b", 40, -10),
        P("c", 40, 40),
        P("d", -10, 40),
        L("l1", "a", "b"),
        L("l2", "b", "c"),
        L("l3", "c", "d"),
        L("l4", "d", "a"),
      ],
      constraints: [],
    };
    const plate: ExtrudeFeature = {
      id: "plate",
      type: "extrude",
      name: "Plate",
      suppressed: false,
      profiles: [],
      distance: 10,
      direction: "reverse",
      operation: "newBody",
    };
    const sketch: SketchFeature = {
      id: "sk",
      type: "sketch",
      name: "S",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: square,
      constraints: [],
    };
    const cut: ExtrudeFeature = {
      id: "cut",
      type: "extrude",
      name: "Cut",
      suppressed: false,
      profiles: [],
      distance: -4,
      direction: "normal",
      operation: "cut",
    };
    const doc = createEmptyDocument("se4", "Cut");
    doc.features = [base, plate, sketch, cut];
    doc.timelinePosition = 4;
    const engine = engineFor("se4");
    let r = engine.evaluate(doc, 1);
    plate.profiles = [
      { sketchId: "sk0", profileId: r.sketches[0]!.profiles[0]!.id },
    ];
    r = engine.evaluate(doc, 3);
    cut.profiles = [
      {
        sketchId: "sk",
        profileId: r.sketches.find((s) => s.featureId === "sk")!.profiles[0]!
          .id,
      },
    ];
    r = engine.evaluate(doc);
    expect(r.featureStatuses.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    const vol = volumeOf(engine.stateAt(doc).bodies.get("b:plate")!.shape);
    expect(vol).toBeCloseTo(50 * 50 * 10 - 20 * 20 * 4, 3);
  });

  it("a start offset moves the whole prism along the profile normal", () => {
    const { result } = build("se5", 7, "normal", "newBody", 3);
    const b = result.bodies[0]!;
    expect(b.bbox.min[2]).toBeCloseTo(3, 6);
    expect(b.bbox.max[2]).toBeCloseTo(10, 6);
    // the offset is along the profile normal regardless of direction / sign
    const rev = build("se6", 7, "reverse", "newBody", 3).result.bodies[0]!;
    expect(rev.bbox.min[2]).toBeCloseTo(-4, 6);
    expect(rev.bbox.max[2]).toBeCloseTo(3, 6);
    const neg = build("se7", -7, "normal", "newBody", -2).result.bodies[0]!;
    expect(neg.bbox.min[2]).toBeCloseTo(-9, 6);
    expect(neg.bbox.max[2]).toBeCloseTo(-2, 6);
    const sym = build("se8", 8, "symmetric", "newBody", 10).result.bodies[0]!;
    expect(sym.bbox.min[2]).toBeCloseTo(6, 6);
    expect(sym.bbox.max[2]).toBeCloseTo(14, 6);
  });

  it("validation accepts negative distances but still rejects zero", () => {
    const f = (distance: number): ExtrudeFeature => ({
      id: "x",
      type: "extrude",
      name: "Extrude",
      suppressed: false,
      profiles: [{ sketchId: "s", profileId: "p" }],
      distance,
      direction: "normal",
      operation: "cut",
    });
    expect(() => validateFeature(f(-5))).not.toThrow();
    expect(() => validateFeature(f(0))).toThrow(/non-zero/);
  });
});
