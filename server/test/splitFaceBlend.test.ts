import { beforeAll, expect, it } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type SketchEntity,
} from "@rockett/shared";
import {
  getKernel,
  handles,
  initKernel,
  volumeOf,
} from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";

beforeAll(initKernel, 120_000);

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
const W = 85,
  H = 22.5,
  C = 7.4,
  HOLE = 1.55;

const plate = (split: boolean): SketchEntity[] => [
  P("a", 0, 0),
  P("b", W, 0),
  P("c", W, H),
  P("d", 0, H),
  L("ab", "a", "b"),
  L("bc", "b", "c"),
  L("cd", "c", "d"),
  L("da", "d", "a"),
  P("hc", C, C),
  { id: "h", kind: "circle", center: "hc", radius: HOLE },
  { id: "g", kind: "circle", center: "hc", radius: 2 },
  ...(split
    ? [
        P("v1", C, 0),
        P("v2", C, H),
        L("vl", "v1", "v2"),
        P("n1", 0, C),
        L("hl", "n1", "hc"),
      ]
    : []),
];

function combinedPlate(id: string, split: boolean) {
  dropEngine(id);
  const doc: CadDocument = createEmptyDocument(id, "Split");
  doc.features = [
    {
      id: "sk",
      type: "sketch",
      name: "S",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: plate(split),
      constraints: [],
    },
  ];
  doc.timelinePosition = 1;
  const engine = engineFor(id);
  const regions = engine.evaluate(doc, 1).sketches[0]!.profiles.filter((p) => {
    for (let i = 0; i < p.polygon.length; i += 2)
      if (Math.hypot(p.polygon[i]! - C, p.polygon[i + 1]! - C) > HOLE + 0.01)
        return true;
    return false;
  });
  regions.forEach((p, i) =>
    doc.features.push({
      id: `ex${i}`,
      type: "extrude",
      name: `E${i}`,
      suppressed: false,
      profiles: [{ sketchId: "sk", profileId: p.id }],
      faces: [],
      distance: 10,
      direction: "normal",
      operation: "newBody",
    }),
  );
  doc.timelinePosition = doc.features.length;
  const ids = engine.evaluate(doc).bodies.map((b) => b.bodyId);
  expect(ids).toHaveLength(regions.length);
  doc.features.push({
    id: "cb",
    type: "combine",
    name: "C",
    suppressed: false,
    operation: "join",
    targetBody: ids[0]!,
    toolBodies: ids.slice(1),
    keepTools: false,
  });
  doc.timelinePosition = doc.features.length;
  const body = engine.evaluate(doc).bodies[0]!;
  const corner = body.edges.find(
    (e) =>
      [0, 1, 3, 4].every((i) => Math.abs(e.polyline[i]!) < 1e-6) &&
      Math.abs(e.polyline[5]! - e.polyline[2]!) > 5,
  )!;
  const before = engine.stateAt(doc).bodies.get(body.bodyId)!.shape;
  return {
    engine,
    doc,
    bodyId: body.bodyId,
    corner: { kind: "edge" as const, bodyId: body.bodyId, edgeName: corner.name },
    volume: volumeOf(before),
    holes: handles(before),
  };
}

it("counts through-holes from the Euler-Poincare formula", () => {
  const k = getKernel();
  const box = new k.BRepPrimAPI_MakeBox_2(20, 10, 5);
  const axis = new k.gp_Ax2_3(
    new k.gp_Pnt_3(10, 5, -1),
    new k.gp_Dir_4(0, 0, 1),
  );
  const pin = new k.BRepPrimAPI_MakeCylinder_3(axis, 2, 7);
  const cut = new k.BRepAlgoAPI_Cut_3(box.Shape(), pin.Shape(), new k.Message_ProgressRange_1());
  try {
    expect(handles(box.Shape())).toBe(0);
    expect(handles(cut.Shape())).toBe(1);
  } finally {
    for (const o of [cut, pin, axis, box]) o.delete();
  }
});

it("fillets a corner of a combined body whose faces are split around a hole", () => {
  const { engine, doc, bodyId, corner, volume, holes } = combinedPlate("sfb1", true);
  expect(holes).toBe(1);
  doc.features.push({
    id: "fl",
    type: "fillet",
    name: "F",
    suppressed: false,
    edges: [corner],
    radius: 10,
  });
  doc.timelinePosition = doc.features.length;
  const r = engine.evaluate(doc);
  expect(r.featureStatuses.at(-1)).toMatchObject({ status: "ok" });
  const shape = engine.stateAt(doc).bodies.get(bodyId)!.shape;
  expect(handles(shape)).toBe(1);
  expect(volumeOf(shape)).toBeCloseTo(volume - 100 * (1 - Math.PI / 4) * 10, 3);
});

it("chamfers that corner too, keeping the hole", () => {
  const { engine, doc, bodyId, corner, volume } = combinedPlate("sfb2", true);
  doc.features.push({
    id: "ch",
    type: "chamfer",
    name: "Ch",
    suppressed: false,
    edges: [corner],
    distance: 6,
  });
  doc.timelinePosition = doc.features.length;
  const r = engine.evaluate(doc);
  expect(r.featureStatuses.at(-1)).toMatchObject({ status: "ok" });
  const shape = engine.stateAt(doc).bodies.get(bodyId)!.shape;
  expect(handles(shape)).toBe(1);
  expect(volumeOf(shape)).toBeCloseTo(volume - 18 * 10, 3);
});

it("leaves a fillet on unsplit faces exactly as before", () => {
  const { engine, doc, bodyId, corner, volume } = combinedPlate("sfb3", false);
  doc.features.push({
    id: "fl",
    type: "fillet",
    name: "F",
    suppressed: false,
    edges: [corner],
    radius: 10,
  });
  doc.timelinePosition = doc.features.length;
  const r = engine.evaluate(doc);
  expect(r.featureStatuses.at(-1)).toMatchObject({ status: "ok" });
  const body = r.bodies.find((b) => b.bodyId === bodyId)!;
  expect(body.faces.filter((f) => f.name.startsWith("f:fl:fe:"))).toHaveLength(1);
  const shape = engine.stateAt(doc).bodies.get(bodyId)!.shape;
  expect(volumeOf(shape)).toBeCloseTo(volume - 100 * (1 - Math.PI / 4) * 10, 3);
});
