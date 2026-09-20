import { beforeAll, describe, expect, it } from "vitest";
import type {
  CadDocument,
  ExtrudeFeature,
  FilletFeature,
  SketchConstraint,
  SketchEntity,
  SketchFeature,
} from "@rockett/shared";
import { createEmptyDocument, projectEdge, modifySketch, offsetSketch } from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";

function rectSketch(
  id: string,
  w: number,
  h: number
): SketchFeature {
  const entities: SketchEntity[] = [
    { id: `${id}-pa`, kind: "point", x: 0, y: 0 },
    { id: `${id}-pb`, kind: "point", x: w, y: 0 },
    { id: `${id}-pc`, kind: "point", x: w, y: h },
    { id: `${id}-pd`, kind: "point", x: 0, y: h },
    { id: `${id}-l1`, kind: "line", p1: `${id}-pa`, p2: `${id}-pb` },
    { id: `${id}-l2`, kind: "line", p1: `${id}-pb`, p2: `${id}-pc` },
    { id: `${id}-l3`, kind: "line", p1: `${id}-pc`, p2: `${id}-pd` },
    { id: `${id}-l4`, kind: "line", p1: `${id}-pd`, p2: `${id}-pa` },
  ];
  const constraints: SketchConstraint[] = [
    { id: `${id}-f`, type: "fix", point: `${id}-pa` },
    { id: `${id}-h1`, type: "horizontal", line: `${id}-l1` },
    { id: `${id}-h2`, type: "horizontal", line: `${id}-l3` },
    { id: `${id}-v1`, type: "vertical", line: `${id}-l2` },
    { id: `${id}-v2`, type: "vertical", line: `${id}-l4` },
    { id: `${id}-d1`, type: "length", line: `${id}-l1`, value: w },
    { id: `${id}-d2`, type: "length", line: `${id}-l2`, value: h },
  ];
  return {
    id,
    type: "sketch",
    name: id,
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities,
    constraints,
  };
}

function docWith(features: CadDocument["features"]): CadDocument {
  const doc = createEmptyDocument("test-doc", "Test");
  doc.features = features;
  doc.timelinePosition = features.length;
  return doc;
}

beforeAll(async () => {
  await initKernel();
}, 120_000);

describe("geometry pipeline", () => {
  it("builds real solids from trimmed arcs and offset loops", () => {
    const arcEntities: SketchEntity[] = [{ id: "center", kind: "point", x: 0, y: 0 },
      { id: "circle", kind: "circle", center: "center", radius: 5 },
      { id: "p1", kind: "point", x: 0, y: -10 }, { id: "p2", kind: "point", x: 0, y: 10 },
      { id: "axis", kind: "line", p1: "p1", p2: "p2" }];
    const trimmed = modifySketch(arcEntities, [], "circle", { x: 5, y: 0 }, "trim");
    const rectangle = rectSketch("rectangle", 20, 10);
    const offset = offsetSketch(rectangle.entities, [], "rectangle-l1", 2).entities.slice(rectangle.entities.length);
    for (const [entities, expectedVolume] of [[trimmed.entities, Math.PI * 25 * 5], [offset, 16 * 6 * 10]] as const) {
      const sketch: SketchFeature = { ...rectangle, id: "profile", entities, constraints: [] };
      const extrude: ExtrudeFeature = { id: "solid", name: "Solid", type: "extrude", suppressed: false,
        profiles: [], distance: 10, direction: "normal", operation: "newBody" };
      const doc = docWith([sketch, extrude]), engine = engineFor("modified-profile");
      const profiles = engine.evaluate(doc, 1).sketches[0].profiles;
      expect(profiles).toHaveLength(1);
      extrude.profiles = [{ sketchId: "profile", profileId: profiles[0].id }];
      expect(engine.evaluate(doc).featureStatuses).toEqual([
        { featureId: "profile", status: "ok" }, { featureId: "solid", status: "ok" }]);
      expect(volumeOf(engine.stateAt(doc).bodies.get("b:solid")!.shape)).toBeCloseTo(expectedVolume, 3);
      dropEngine("modified-profile");
    }
  });
  it("regenerates a projected model edge and its midpoint constraint after upstream resizing", () => {
    const sketch = rectSketch("source", 100, 50);
    const extrude: ExtrudeFeature = { id: "solid", type: "extrude", name: "Solid", suppressed: false,
      profiles: [], distance: 20, direction: "normal", operation: "newBody" };
    const doc = docWith([sketch, extrude]);
    const engine = engineFor("projection-regression");
    extrude.profiles = [{ sketchId: sketch.id, profileId: engine.evaluate(doc, 1).sketches[0].profiles[0].id }];
    let result = engine.evaluate(doc);
    const edge = result.bodies[0].edges.find(e => e.name.includes("cap:end") && e.name.includes("source-l1"))!;
    expect(edge).toBeTruthy();
    const frame = { origin: [0, 0, 20], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] } as any;
    const projected: SketchFeature = { id: "projected", type: "sketch", name: "Projected", suppressed: false,
      plane: { kind: "face", face: { kind: "face", bodyId: "b:solid", faceName: "f:solid:cap:end" } },
      entities: [...projectEdge(edge.curve, frame, "reference", { kind: "edge", bodyId: "b:solid", edgeName: edge.name }),
        { id: "mid", kind: "point", x: 50, y: 0 }],
      constraints: [{ id: "midpoint", type: "midpoint", point: "mid", line: "reference" }] };
    doc.features.push(projected); doc.timelinePosition++;
    result = engine.evaluate(doc);
    expect(result.featureStatuses.every(s => s.status === "ok")).toBe(true);
    (sketch.constraints.find(c => c.id === "source-d1") as any).value = 120;
    result = engine.evaluate(doc);
    expect(result.featureStatuses.every(s => s.status === "ok")).toBe(true);
    const mid = result.sketches.find(s => s.featureId === "projected")!.entities.find(e => e.id === "mid") as any;
    expect(mid.x).toBeCloseTo(60, 4);
    // Serialization and a cold engine must produce the same regenerated location.
    dropEngine("projection-regression");
    result = engineFor("projection-regression").evaluate(JSON.parse(JSON.stringify(doc)));
    expect((result.sketches.at(-1)!.entities.find(e => e.id === "mid") as any).x).toBeCloseTo(60, 4);
    (projected.entities.find(e => e.id === "reference") as any).projection.edgeName = "missing";
    result = engineFor("projection-regression").evaluate(doc);
    expect(result.featureStatuses.at(-1)!.error).toMatch(/Projected edge.*missing/);
    expect(result.bodies).toHaveLength(1);
    dropEngine("projection-regression");
  });
  it("extrudes a 100x50 rectangle 20mm into a correct box", () => {
    dropEngine("t1");
    const sketch = rectSketch("sk1", 100, 50);
    const extrude: ExtrudeFeature = {
      id: "ext1",
      type: "extrude",
      name: "Extrude1",
      suppressed: false,
      profiles: [{ sketchId: "sk1", profileId: "" }],
      distance: 20,
      direction: "normal",
      operation: "newBody",
    };
    const doc = docWith([sketch, extrude]);
    const engine = engineFor("t1");
    // resolve the actual profile id from sketch evaluation
    let result = engine.evaluate(doc, 1);
    const profile = result.sketches[0].profiles[0];
    expect(profile).toBeTruthy();
    (doc.features[1] as ExtrudeFeature).profiles[0].profileId = profile.id;
    result = engine.evaluate(doc);

    expect(result.featureStatuses.map((s) => s.status)).toEqual(["ok", "ok"]);
    expect(result.bodies).toHaveLength(1);
    const body = result.bodies[0];
    expect(body.bbox.min.map((v) => Math.round(v) || 0)).toEqual([0, 0, 0]);
    expect(body.bbox.max.map((v) => Math.round(v) || 0)).toEqual([100, 50, 20]);
    // 6 faces with persistent names
    expect(body.faces).toHaveLength(6);
    const names = body.faces.map((f) => f.name).sort();
    expect(names).toContain("f:ext1:cap:start");
    expect(names).toContain("f:ext1:cap:end");
    expect(names.filter((n) => n.startsWith("f:ext1:s:"))).toHaveLength(4);
    // 12 edges, 8 vertices
    expect(body.edges).toHaveLength(12);
    expect(body.vertices).toHaveLength(8);

    const state = engine.stateAt(doc);
    const solid = state.bodies.get("b:ext1")!;
    expect(volumeOf(solid.shape)).toBeCloseTo(100 * 50 * 20, 3);
  });

  it("cuts a hole via sketch-on-face + extrude cut, then fillets an edge, and regenerates parametrically", () => {
    dropEngine("t2");
    const sketch = rectSketch("sk1", 100, 50);
    const extrude: ExtrudeFeature = {
      id: "ext1",
      type: "extrude",
      name: "Extrude1",
      suppressed: false,
      profiles: [{ sketchId: "sk1", profileId: "" }],
      distance: 20,
      direction: "normal",
      operation: "newBody",
    };
    // circle sketch on the top face of the extrude
    const circleSketch: SketchFeature = {
      id: "sk2",
      type: "sketch",
      name: "Sketch2",
      suppressed: false,
      plane: {
        kind: "face",
        face: { kind: "face", bodyId: "b:ext1", faceName: "f:ext1:cap:end" },
      },
      entities: [
        { id: "sk2-c", kind: "point", x: 30, y: 25 },
        { id: "sk2-circ", kind: "circle", center: "sk2-c", radius: 5 },
      ],
      constraints: [
        { id: "sk2-f", type: "fix", point: "sk2-c" },
        { id: "sk2-r", type: "diameter", entity: "sk2-circ", value: 10 },
      ],
    };
    const cut: ExtrudeFeature = {
      id: "cut1",
      type: "extrude",
      name: "Cut1",
      suppressed: false,
      profiles: [{ sketchId: "sk2", profileId: "" }],
      distance: 25,
      direction: "reverse",
      operation: "cut",
    };
    const fillet: FilletFeature = {
      id: "fil1",
      type: "fillet",
      name: "Fillet1",
      suppressed: false,
      edges: [], // filled after inspecting edges
      radius: 3,
    };

    const doc = docWith([sketch, extrude, circleSketch, cut, fillet]);
    const engine = engineFor("t2");

    // Resolve profile ids progressively
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0].profileId =
      result.sketches[0].profiles[0].id;
    result = engine.evaluate(doc, 3);
    const sk2 = result.sketches.find((s) => s.featureId === "sk2")!;
    expect(sk2.profiles.length).toBeGreaterThan(0);
    (doc.features[3] as ExtrudeFeature).profiles[0].profileId =
      sk2.profiles[0].id;

    // Evaluate through the cut
    result = engine.evaluate(doc, 4);
    const statuses = result.featureStatuses.slice(0, 4).map((s) => s.status);
    expect(statuses).toEqual(["ok", "ok", "ok", "ok"]);
    const state4 = engine.stateAt(doc, 4);
    const cutVol = volumeOf(state4.bodies.get("b:ext1")!.shape);
    expect(cutVol).toBeCloseTo(100 * 50 * 20 - Math.PI * 25 * 20, 1);

    // Find a vertical corner edge at (0,0): line from (0,0,0)->(0,0,20)
    const bodyPayload = result.bodies[0];
    const cornerEdge = bodyPayload.edges.find((e) => {
      if (e.curve.type !== "line") return false;
      const { a, b } = e.curve;
      const isVertical =
        Math.abs(a[0]) < 1e-6 &&
        Math.abs(a[1]) < 1e-6 &&
        Math.abs(b[0]) < 1e-6 &&
        Math.abs(b[1]) < 1e-6;
      return isVertical;
    });
    expect(cornerEdge).toBeTruthy();
    (doc.features[4] as FilletFeature).edges = [
      { kind: "edge", bodyId: "b:ext1", edgeName: cornerEdge!.name },
    ];

    result = engine.evaluate(doc);
    expect(result.featureStatuses.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    const state5 = engine.stateAt(doc);
    const filletVol = volumeOf(state5.bodies.get("b:ext1")!.shape);
    const filletRemoved = (9 - (Math.PI * 9) / 4) * 20;
    expect(filletVol).toBeCloseTo(cutVol - filletRemoved, 1);

    // --- parametric edit: widen the rectangle to 120 ---
    const sk1 = doc.features[0] as SketchFeature;
    const widthDim = sk1.constraints.find((c) => c.id === "sk1-d1")! as any;
    widthDim.value = 120;
    result = engine.evaluate(doc);
    expect(result.featureStatuses.map((s) => s.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    const body = result.bodies[0];
    expect(Math.round(body.bbox.max[0])).toBe(120);
    const newVol = volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape);
    expect(newVol).toBeCloseTo(
      120 * 50 * 20 - Math.PI * 25 * 20 - filletRemoved,
      1
    );
  });

  it("rolls the timeline back and shows the model at that point", () => {
    dropEngine("t3");
    const sketch = rectSketch("sk1", 40, 40);
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
    const chamfer = {
      id: "ch1",
      type: "chamfer" as const,
      name: "Chamfer1",
      suppressed: false,
      edges: [] as any[],
      distance: 2,
    };
    const doc = docWith([sketch, extrude, chamfer]);
    const engine = engineFor("t3");
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0].profileId =
      result.sketches[0].profiles[0].id;
    result = engine.evaluate(doc, 2);
    const edge = result.bodies[0].edges.find((e) => e.curve.type === "line")!;
    chamfer.edges = [{ kind: "edge", bodyId: "b:ext1", edgeName: edge.name }];

    // full evaluation
    result = engine.evaluate(doc);
    const fullVol = volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape);
    expect(fullVol).toBeLessThan(40 * 40 * 10);

    // roll back before the chamfer
    doc.timelinePosition = 2;
    result = engine.evaluate(doc);
    expect(result.featureStatuses[2].status).toBe("rolledBack");
    const rolledVol = volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape);
    expect(rolledVol).toBeCloseTo(40 * 40 * 10, 3);
  });

  it("reports a broken downstream feature without corrupting the model", () => {
    dropEngine("t4");
    const sketch = rectSketch("sk1", 30, 30);
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
    const fillet: FilletFeature = {
      id: "fil1",
      type: "fillet",
      name: "Fillet1",
      suppressed: false,
      edges: [{ kind: "edge", bodyId: "b:ext1", edgeName: "e[nonexistent|x]" }],
      radius: 2,
    };
    const doc = docWith([sketch, extrude, fillet]);
    const engine = engineFor("t4");
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0].profileId =
      result.sketches[0].profiles[0].id;
    result = engine.evaluate(doc);
    expect(result.featureStatuses[2].status).toBe("error");
    expect(result.featureStatuses[2].error).toMatch(/no longer exists/);
    // body remains intact from before the failed feature
    expect(result.bodies).toHaveLength(1);
    expect(
      volumeOf(engine.stateAt(doc).bodies.get("b:ext1")!.shape)
    ).toBeCloseTo(30 * 30 * 10, 3);
  });
});
