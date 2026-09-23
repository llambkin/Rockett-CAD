/**
 * Golden tests: one timeline per feature evaluator, pinning status, body ids,
 * volume, bounding box, face count and sample persistent face names before
 * the evaluator registry refactor. "analytic" tests assert values derived by
 * hand; "pinned snapshot" tests assert the kernel output as it stands today.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type {
  AxisRef,
  EvaluateResult,
  ExtrudeFeature,
  Feature,
  PlaneRef,
  ProfileRef,
  SketchEntity,
  SketchFeature,
  Vec3,
} from "@rockett/shared";
import { createEmptyDocument } from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { stepFixture } from "./helpers/stepFixture.js";

beforeAll(initKernel, 120_000);

const XY: PlaneRef = { kind: "origin", plane: "XY" };
const XZ: PlaneRef = { kind: "origin", plane: "XZ" };
const YZ: PlaneRef = { kind: "origin", plane: "YZ" };
const Z_AXIS: AxisRef = { kind: "originAxis", axis: "Z" };
const construction = (featureId: string): PlaneRef => ({
  kind: "construction",
  featureId,
});
const face = (bodyId: string, faceName: string) => ({
  kind: "face" as const,
  bodyId,
  faceName,
});
const onFace = (bodyId: string, faceName: string): PlaneRef => ({
  kind: "face",
  face: face(bodyId, faceName),
});
/** Profile placeholder, resolved by `run` to the sketch's n-th detected profile. */
const prof = (sketchId: string, n = 0): ProfileRef => ({
  sketchId,
  profileId: `#${n}`,
});
const meta = (id: string) => ({ id, name: id, suppressed: false });

const P = (id: string, x: number, y: number): SketchEntity => ({
  id,
  kind: "point",
  x,
  y,
});
const L = (
  id: string,
  p1: string,
  p2: string,
  construction?: boolean,
): SketchEntity => ({
  id,
  kind: "line",
  p1,
  p2,
  ...(construction ? { construction } : {}),
});

function sketch(
  id: string,
  plane: PlaneRef,
  entities: SketchEntity[],
): SketchFeature {
  return { ...meta(id), type: "sketch", plane, entities, constraints: [] };
}

/** Axis-aligned rectangle with lines `${id}-l1..l4` (bottom, right, top, left). */
function rect(
  id: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
  plane: PlaneRef = XY,
): SketchFeature {
  return sketch(id, plane, [
    P(`${id}-a`, x0, y0),
    P(`${id}-b`, x0 + w, y0),
    P(`${id}-c`, x0 + w, y0 + h),
    P(`${id}-d`, x0, y0 + h),
    L(`${id}-l1`, `${id}-a`, `${id}-b`),
    L(`${id}-l2`, `${id}-b`, `${id}-c`),
    L(`${id}-l3`, `${id}-c`, `${id}-d`),
    L(`${id}-l4`, `${id}-d`, `${id}-a`),
  ]);
}

function extrude(
  id: string,
  sketchId: string,
  distance: number,
  operation: ExtrudeFeature["operation"] = "newBody",
): ExtrudeFeature {
  return {
    ...meta(id),
    type: "extrude",
    profiles: [prof(sketchId)],
    distance,
    direction: "normal",
    operation,
  };
}

/** Sketch `${id}Sk` plus extrude `id`: body `b:${id}` spanning [x0,x0+w]x[y0,y0+h]x[0,d]. */
function box(
  id: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
  d: number,
): Feature[] {
  return [rect(`${id}Sk`, x0, y0, w, h), extrude(id, `${id}Sk`, d)];
}

/** The 20 x 30 x 10 base box used by most timelines: body b:box, volume 6000. */
const baseBox = () => box("box", 0, 0, 20, 30, 10);

let seq = 0;
/** Evaluate a timeline on a fresh engine, resolving `#n` profile placeholders. */
function run(features: Feature[]) {
  const id = `golden-${++seq}`;
  const doc = createEmptyDocument(id, id);
  doc.features = features;
  doc.timelinePosition = features.length;
  const engine = engineFor(id);
  features.forEach((f, i) => {
    const refs: ProfileRef[] = [
      ...((f as any).profiles ?? []),
      ...((f as any).sections ?? []),
    ];
    const pending = refs.filter((r) => r.profileId.startsWith("#"));
    if (pending.length === 0) return;
    const sketches = engine.evaluate(doc, i).sketches;
    for (const r of pending) {
      const p = sketches.find((s) => s.featureId === r.sketchId)?.profiles[
        Number(r.profileId.slice(1))
      ];
      if (!p)
        throw new Error(
          `test setup: no profile ${r.profileId} in ${r.sketchId}`,
        );
      r.profileId = p.id;
    }
  });
  const result = engine.evaluate(doc);
  const state = engine.stateAt(doc);
  dropEngine(id);
  return {
    result,
    status: (featureId: string) =>
      result.featureStatuses.find((s) => s.featureId === featureId),
    bodyIds: () => result.bodies.map((b) => b.bodyId),
    body: (bodyId: string) => {
      const b = result.bodies.find((x) => x.bodyId === bodyId);
      if (!b)
        throw new Error(
          `no body ${bodyId}; have ${result.bodies.map((x) => x.bodyId)}`,
        );
      return b;
    },
    volume: (bodyId: string) => volumeOf(state.bodies.get(bodyId)!.shape),
  };
}

type Run = ReturnType<typeof run>;

function expectOk(r: Run) {
  expect(r.result.featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
}

function expectVolume(actual: number, expected: number, rel = 1e-6) {
  expect(
    Math.abs(actual - expected) / expected,
    `volume ${actual} vs ${expected}`,
  ).toBeLessThan(rel);
}

function expectBox(r: Run, bodyId: string, min: Vec3, max: Vec3, digits = 3) {
  const { bbox } = r.body(bodyId);
  bbox.min.forEach((v, i) =>
    expect(v, `min[${i}]`).toBeCloseTo(min[i], digits),
  );
  bbox.max.forEach((v, i) =>
    expect(v, `max[${i}]`).toBeCloseTo(max[i], digits),
  );
}

const faceNames = (r: Run, bodyId: string) =>
  r
    .body(bodyId)
    .faces.map((f) => f.name)
    .sort();

function expectError(r: Run, featureId: string, message: RegExp) {
  const s = r.status(featureId);
  expect(s?.status).toBe("error");
  expect(s?.error).toMatch(message);
}

describe("revolve", () => {
  it("full 360 about Z gives a tube of volume pi(10^2 - 5^2)10 (analytic)", () => {
    const r = run([
      rect("sk", 5, 0, 5, 10, XZ),
      {
        ...meta("rev"),
        type: "revolve",
        profiles: [prof("sk")],
        axis: Z_AXIS,
        angle: 360,
        operation: "newBody",
      },
    ]);
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:rev"]);
    expectVolume(r.volume("b:rev"), Math.PI * 75 * 10);
    expectBox(r, "b:rev", [-10, -10, 0], [10, 10, 10]);
    // Pinned snapshot: the end annuli (l1, l3) fall back to x names.
    expect(faceNames(r, "b:rev")).toEqual([
      "f:rev:s:sk-l2",
      "f:rev:s:sk-l4",
      "f:rev:x1",
      "f:rev:x2",
    ]);
  });

  it("90 degrees about a construction sketch line gives a quarter tube with caps (analytic)", () => {
    const sk = rect("sk", 5, 0, 5, 10, XZ);
    sk.entities.push(
      P("ax1", 0, 0),
      P("ax2", 0, 10),
      L("axis", "ax1", "ax2", true),
    );
    const r = run([
      sk,
      {
        ...meta("rev"),
        type: "revolve",
        profiles: [prof("sk")],
        axis: { kind: "sketchLine", sketchId: "sk", entityId: "axis" },
        angle: 90,
        operation: "newBody",
      },
    ]);
    expectOk(r);
    expectVolume(r.volume("b:rev"), (Math.PI * 75 * 10) / 4);
    expectBox(r, "b:rev", [0, 0, 0], [10, 10, 10]);
    expect(faceNames(r, "b:rev")).toEqual([
      "f:rev:cap:end",
      "f:rev:cap:start",
      "f:rev:s:sk-l1",
      "f:rev:s:sk-l2",
      "f:rev:s:sk-l3",
      "f:rev:s:sk-l4",
    ]);
  });

  it("a missing axis line is a feature error", () => {
    const r = run([
      rect("sk", 5, 0, 5, 10, XZ),
      {
        ...meta("rev"),
        type: "revolve",
        profiles: [prof("sk")],
        axis: { kind: "sketchLine", sketchId: "sk", entityId: "nope" },
        angle: 360,
        operation: "newBody",
      },
    ]);
    expectError(r, "rev", /axis line nope not found/);
    expect(r.result.bodies).toHaveLength(0);
  });
});

describe("sweep", () => {
  const circle = sketch("prof", XY, [
    P("c", 0, 0),
    { id: "circ", kind: "circle", center: "c", radius: 2 },
  ]);

  it("a circle along a straight 20 mm path is a cylinder of volume 80 pi (analytic)", () => {
    const path = sketch("path", XZ, [
      P("p0", 0, 0),
      P("p1", 0, 20),
      L("seg", "p0", "p1"),
    ]);
    const r = run([
      structuredClone(circle),
      path,
      {
        ...meta("sw"),
        type: "sweep",
        profiles: [prof("prof")],
        pathSketchId: "path",
        operation: "newBody",
      },
    ]);
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:sw"]);
    expectVolume(r.volume("b:sw"), Math.PI * 4 * 20);
    expectBox(r, "b:sw", [-2, -2, 0], [2, 2, 20]);
    expect(faceNames(r, "b:sw")).toEqual(["f:sw:x1", "f:sw:x2", "f:sw:x3"]);
  });

  // Known bug, pinned: GC_MakeArcOfCircle.Value() is a Handle_Geom_TrimmedCurve and
  // BRepBuilderAPI_MakeEdge_24 wants a Handle_Geom_Curve, so any arc in a path fails.
  // Once fixed, the body should hold pi * 2^2 * (20 + 5 pi) by Pappus.
  it("a line then a quarter arc fails today with a kernel binding error (pinned snapshot, known bug)", () => {
    const path = sketch("path", XZ, [
      P("p0", 0, 0),
      P("p1", 0, 20),
      L("seg", "p0", "p1"),
      P("ac", 10, 20),
      P("as", 10, 30),
      { id: "arc", kind: "arc", center: "ac", start: "as", end: "p1" },
    ]);
    const r = run([
      structuredClone(circle),
      path,
      {
        ...meta("sw"),
        type: "sweep",
        profiles: [prof("prof")],
        pathSketchId: "path",
        operation: "newBody",
      },
    ]);
    expectError(
      r,
      "sw",
      /^sweep path: Expected null or instance of Handle_Geom_Curve, got an instance of Handle_Geom_TrimmedCurve$/,
    );
    expect(r.result.bodies).toEqual([]);
  });

  it("a missing path sketch is a feature error", () => {
    const r = run([
      structuredClone(circle),
      {
        ...meta("sw"),
        type: "sweep",
        profiles: [prof("prof")],
        pathSketchId: "gone",
        operation: "newBody",
      },
    ]);
    expectError(r, "sw", /path sketch gone not found/);
  });
});

describe("loft", () => {
  const timeline = (): Feature[] => [
    rect("lo1", -10, -10, 20, 20),
    {
      ...meta("cp"),
      type: "constructionPlane",
      method: { kind: "offset", base: XY, distance: 10 },
    },
    rect("lo2", -5, -5, 10, 10, construction("cp")),
  ];

  it("20 mm square to 10 mm square over 10 mm is a frustum of volume 7000/3 (analytic)", () => {
    const r = run([
      ...timeline(),
      {
        ...meta("loft"),
        type: "loft",
        sections: [prof("lo1"), prof("lo2")],
        operation: "newBody",
      },
    ]);
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:loft"]);
    expectVolume(r.volume("b:loft"), 7000 / 3);
    expectBox(r, "b:loft", [-10, -10, 0], [10, 10, 10]);
    expect(faceNames(r, "b:loft")).toEqual([
      "f:loft:x1",
      "f:loft:x2",
      "f:loft:x3",
      "f:loft:x4",
      "f:loft:x5",
      "f:loft:x6",
    ]);
  });

  it("a single section is a feature error", () => {
    const r = run([
      ...timeline(),
      {
        ...meta("loft"),
        type: "loft",
        sections: [prof("lo1")],
        operation: "newBody",
      },
    ]);
    expectError(r, "loft", /at least two sections/);
  });
});

describe("emboss", () => {
  const EMBOSS_NAMES = [
    "f:box:cap:end",
    "f:box:cap:start",
    "f:box:s:boxSk-l1",
    "f:box:s:boxSk-l2",
    "f:box:s:boxSk-l3",
    "f:box:s:boxSk-l4",
    "f:emb:cap:end",
    "f:emb:s:em-l1",
    "f:emb:s:em-l2",
    "f:emb:s:em-l3",
    "f:emb:s:em-l4",
  ];
  const timeline = (mode: "emboss" | "deboss"): Feature[] => [
    ...baseBox(),
    rect("em", 5, 5, 5, 5, onFace("b:box", "f:box:cap:end")),
    { ...meta("emb"), type: "emboss", profiles: [prof("em")], depth: 2, mode },
  ];

  it("emboss raises a 5x5x2 pad on the top face: 6000 + 50 (analytic)", () => {
    const r = run(timeline("emboss"));
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box"]);
    expectVolume(r.volume("b:box"), 6050);
    expectBox(r, "b:box", [0, 0, 0], [20, 30, 12]);
    expect(faceNames(r, "b:box")).toEqual(EMBOSS_NAMES);
  });

  it("deboss sinks a 5x5x2 pocket into the top face: 6000 - 50 (analytic)", () => {
    const r = run(timeline("deboss"));
    expectOk(r);
    expectVolume(r.volume("b:box"), 5950);
    expectBox(r, "b:box", [0, 0, 0], [20, 30, 10]);
    expect(faceNames(r, "b:box")).toEqual(EMBOSS_NAMES);
  });
});

describe("shell", () => {
  it("1 mm shell open at the top leaves 6000 - 18*28*9 (analytic)", () => {
    const r = run([
      ...baseBox(),
      {
        ...meta("sh"),
        type: "shell",
        openFaces: [face("b:box", "f:box:cap:end")],
        thickness: 1,
      },
    ]);
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box"]);
    expectVolume(r.volume("b:box"), 6000 - 18 * 28 * 9);
    // The shell result carries 1e-3 tolerance, so the bbox grows by that gap.
    expectBox(r, "b:box", [0, 0, 0], [20, 30, 10], 2);
    expect(faceNames(r, "b:box")).toEqual([
      "f:box:cap:end",
      "f:box:cap:start",
      "f:box:s:boxSk-l1",
      "f:box:s:boxSk-l2",
      "f:box:s:boxSk-l3",
      "f:box:s:boxSk-l4",
      "f:sh:x1",
      "f:sh:x2",
      "f:sh:x3",
      "f:sh:x4",
      "f:sh:x5",
    ]);
  });

  // Suspect, pinned: a hollow closed shell should keep 6000 - 18*28*8 = 1968. Today the
  // body is replaced by the 18 x 28 x 8 inner offset solid instead.
  it("closed 1 mm shell with no open faces yields the inner offset solid (pinned snapshot, suspect)", () => {
    const r = run([
      ...baseBox(),
      { ...meta("sh"), type: "shell", openFaces: [], thickness: 1 },
    ]);
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box"]);
    expectVolume(r.volume("b:box"), 18 * 28 * 8);
    expectBox(r, "b:box", [1, 1, 1], [19, 29, 9], 2);
    expect(faceNames(r, "b:box")).toEqual([
      "f:sh:x1",
      "f:sh:x2",
      "f:sh:x3",
      "f:sh:x4",
      "f:sh:x5",
      "f:sh:x6",
    ]);
  });

  it("a missing open face is a feature error", () => {
    const r = run([
      ...baseBox(),
      {
        ...meta("sh"),
        type: "shell",
        openFaces: [face("b:box", "f:box:nope")],
        thickness: 1,
      },
    ]);
    expectError(r, "sh", /face f:box:nope no longer exists/);
    expectVolume(r.volume("b:box"), 6000);
  });
});

describe("combine", () => {
  // b:box [0,20]x[0,30]x[0,10] and b:tool [10,30]x[10,40]x[0,10] overlap in 10x20x10 = 2000.
  const timeline = (
    operation: "join" | "cut" | "intersect",
    keepTools = false,
  ): Feature[] => [
    ...baseBox(),
    ...box("tool", 10, 10, 20, 30, 10),
    {
      ...meta("cmb"),
      type: "combine",
      operation,
      targetBody: "b:box",
      toolBodies: ["b:tool"],
      keepTools,
    },
  ];

  // Face counts are pinned snapshots: combine does not unify coplanar faces.
  it.each([
    ["join", 10000, [0, 0, 0], [30, 40, 10], 14],
    ["cut", 4000, [0, 0, 0], [20, 30, 10], 8],
    ["intersect", 2000, [10, 10, 0], [20, 30, 10], 6],
  ] as const)(
    "%s gives volume %d and consumes the tool (analytic)",
    (op, vol, min, max, faces) => {
      const r = run(timeline(op));
      expectOk(r);
      expect(r.bodyIds()).toEqual(["b:box"]);
      expectVolume(r.volume("b:box"), vol);
      expectBox(r, "b:box", [...min], [...max]);
      expect(r.body("b:box").faces).toHaveLength(faces);
    },
  );

  it("join names: box faces survive, split tool caps get ~n suffixes (pinned snapshot)", () => {
    expect(faceNames(run(timeline("join")), "b:box")).toEqual([
      "f:box:cap:end",
      "f:box:cap:start",
      "f:box:s:boxSk-l1",
      "f:box:s:boxSk-l2",
      "f:box:s:boxSk-l3",
      "f:box:s:boxSk-l4",
      "f:tool:cap:end~1",
      "f:tool:cap:end~2",
      "f:tool:cap:start~1",
      "f:tool:cap:start~2",
      "f:tool:s:toolSk-l1",
      "f:tool:s:toolSk-l2",
      "f:tool:s:toolSk-l3",
      "f:tool:s:toolSk-l4",
    ]);
  });

  it("keepTools leaves the tool body in place (analytic)", () => {
    const r = run(timeline("cut", true));
    expectOk(r);
    expect(r.bodyIds().sort()).toEqual(["b:box", "b:tool"]);
    expectVolume(r.volume("b:tool"), 6000);
  });

  it("a missing target body is a feature error", () => {
    const r = run([
      ...baseBox(),
      {
        ...meta("cmb"),
        type: "combine",
        operation: "join",
        targetBody: "b:gone",
        toolBodies: ["b:box"],
        keepTools: false,
      },
    ]);
    expectError(r, "cmb", /target body b:gone not found/);
  });
});

describe("splitBody", () => {
  const timeline = (x: number): Feature[] => [
    ...baseBox(),
    {
      ...meta("cp"),
      type: "constructionPlane",
      method: { kind: "offset", base: YZ, distance: x },
    },
    {
      ...meta("split"),
      type: "splitBody",
      body: "b:box",
      tool: construction("cp"),
    },
  ];

  it("a plane at x = 5 splits the box into 1500 and 4500 ordered along the normal (analytic)", () => {
    const r = run(timeline(5));
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box", "b:box:s2"]);
    expectVolume(r.volume("b:box"), 1500);
    expectVolume(r.volume("b:box:s2"), 4500);
    expectBox(r, "b:box", [0, 0, 0], [5, 30, 10]);
    expectBox(r, "b:box:s2", [5, 0, 0], [20, 30, 10]);
    expect(faceNames(r, "b:box")).toEqual([
      "f:box:cap:end~1",
      "f:box:cap:start~1",
      "f:box:s:boxSk-l1~1",
      "f:box:s:boxSk-l3~1",
      "f:box:s:boxSk-l4",
      "f:split:x1",
    ]);
    expect(faceNames(r, "b:box:s2")).toEqual([
      "f:box:cap:end~2",
      "f:box:cap:start~2",
      "f:box:s:boxSk-l1~2",
      "f:box:s:boxSk-l2",
      "f:box:s:boxSk-l3~2",
      "f:split:x1",
    ]);
  });

  it("a plane that misses the body is a feature error", () => {
    const r = run(timeline(50));
    expectError(r, "split", /does not intersect the body/);
    expect(r.bodyIds()).toEqual(["b:box"]);
  });
});

describe("offsetFace", () => {
  const timeline = (distance: number): Feature[] => [
    ...baseBox(),
    {
      ...meta("off"),
      type: "offsetFace",
      faces: [face("b:box", "f:box:cap:end")],
      distance,
    },
  ];

  it("+5 on the top face grows the box to 20x30x15 (analytic)", () => {
    const r = run(timeline(5));
    expectOk(r);
    expectVolume(r.volume("b:box"), 9000);
    expectBox(r, "b:box", [0, 0, 0], [20, 30, 15]);
    // Pinned snapshot: f:box:cap:end is lost and the sides are split in two.
    expect(faceNames(r, "b:box")).toEqual([
      "f:box:cap:start",
      "f:box:s:boxSk-l1",
      "f:box:s:boxSk-l2",
      "f:box:s:boxSk-l3",
      "f:box:s:boxSk-l4",
      "f:off:x1",
      "f:off:x2",
      "f:off:x4",
      "f:off:x5",
      "f:off:x6",
    ]);
  });

  it("-3 on the top face shrinks the box to 20x30x7 (analytic)", () => {
    const r = run(timeline(-3));
    expectOk(r);
    expectVolume(r.volume("b:box"), 4200);
    expectBox(r, "b:box", [0, 0, 0], [20, 30, 7]);
    // Pinned snapshot: the new top face is renamed, f:box:cap:end is lost.
    expect(faceNames(r, "b:box")).toEqual([
      "f:box:cap:start",
      "f:box:s:boxSk-l1",
      "f:box:s:boxSk-l2",
      "f:box:s:boxSk-l3",
      "f:box:s:boxSk-l4",
      "f:off:x3",
    ]);
  });

  it("a zero distance is a feature error", () => {
    expectError(run(timeline(0)), "off", /non-zero/);
  });
});

describe("mirror", () => {
  const timeline = (combine: boolean): Feature[] => [
    ...baseBox(),
    { ...meta("mir"), type: "mirror", bodies: ["b:box"], plane: YZ, combine },
  ];

  it("across YZ as a new body gives a second 6000 box at x in [-20, 0] (analytic)", () => {
    const r = run(timeline(false));
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box", "b:mir:b:box"]);
    expectVolume(r.volume("b:mir:b:box"), 6000);
    expectBox(r, "b:mir:b:box", [-20, 0, 0], [0, 30, 10]);
    expect(faceNames(r, "b:mir:b:box")).toContain("m:mir:f:box:cap:end");
  });

  it("combined across YZ fuses into one 40x30x10 body (analytic)", () => {
    const r = run(timeline(true));
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box"]);
    expectVolume(r.volume("b:box"), 12000);
    expectBox(r, "b:box", [-20, 0, 0], [20, 30, 10]);
    // Pinned snapshot: no unify, so the fused box keeps 10 faces.
    expect(faceNames(r, "b:box")).toEqual([
      "f:box:cap:end",
      "f:box:cap:start",
      "f:box:s:boxSk-l1",
      "f:box:s:boxSk-l2",
      "f:box:s:boxSk-l3",
      "m:mir:f:box:cap:end",
      "m:mir:f:box:cap:start",
      "m:mir:f:box:s:boxSk-l1",
      "m:mir:f:box:s:boxSk-l2",
      "m:mir:f:box:s:boxSk-l3",
    ]);
  });

  it("a missing body is a feature error", () => {
    const r = run([
      ...baseBox(),
      {
        ...meta("mir"),
        type: "mirror",
        bodies: ["b:gone"],
        plane: YZ,
        combine: false,
      },
    ]);
    expectError(r, "mir", /body b:gone not found/);
  });
});

describe("linearPattern", () => {
  const timeline = (
    spacing: number,
    combine: boolean,
    count = 3,
  ): Feature[] => [
    ...baseBox(),
    {
      ...meta("lp"),
      type: "linearPattern",
      bodies: ["b:box"],
      direction: { kind: "axis", axis: "X" },
      count,
      spacing,
      combine,
    },
  ];

  it("3 copies 30 mm apart along X as separate bodies (analytic)", () => {
    const r = run(timeline(30, false));
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box", "b:lp:b:box:1", "b:lp:b:box:2"]);
    expectVolume(r.volume("b:lp:b:box:2"), 6000);
    expectBox(r, "b:lp:b:box:2", [60, 0, 0], [80, 30, 10]);
    expect(faceNames(r, "b:lp:b:box:2")).toContain("p2:lp:f:box:cap:end");
  });

  it("3 touching copies combined give one 60x30x10 body (analytic)", () => {
    const r = run(timeline(20, true));
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box"]);
    expectVolume(r.volume("b:box"), 18000);
    expectBox(r, "b:box", [0, 0, 0], [60, 30, 10]);
    // Pinned snapshot: no unify, so the fused bar keeps 14 faces.
    expect(r.body("b:box").faces).toHaveLength(14);
    expect(faceNames(r, "b:box")).toContain("p2:lp:f:box:s:boxSk-l2");
  });

  it("a count below 2 is a feature error", () => {
    expectError(run(timeline(30, false, 1)), "lp", /count must be/);
  });
});

describe("circularPattern", () => {
  // b:ring spans x in [10, 20], y in [-5, 5]: 1000 mm^3, clear of the Z axis.
  const timeline = (
    count: number,
    totalAngle: number,
    combine: boolean,
  ): Feature[] => [
    ...box("ring", 10, -5, 10, 10, 10),
    {
      ...meta("cpat"),
      type: "circularPattern",
      bodies: ["b:ring"],
      axis: Z_AXIS,
      count,
      totalAngle,
      combine,
    },
  ];

  it("4 copies over 360 degrees as separate bodies, the 180 degree copy at x in [-20, -10] (analytic)", () => {
    const r = run(timeline(4, 360, false));
    expectOk(r);
    expect(r.bodyIds()).toEqual([
      "b:ring",
      "b:cpat:b:ring:1",
      "b:cpat:b:ring:2",
      "b:cpat:b:ring:3",
    ]);
    expectVolume(r.volume("b:cpat:b:ring:2"), 1000);
    expectBox(r, "b:cpat:b:ring:2", [-20, -5, 0], [-10, 5, 10]);
    expect(faceNames(r, "b:cpat:b:ring:2")).toContain("p2:cpat:f:ring:cap:end");
  });

  it("3 copies over 90 degrees step 45 degrees; the last copy sits on +Y (analytic)", () => {
    const r = run(timeline(3, 90, false));
    expectOk(r);
    expectBox(r, "b:cpat:b:ring:2", [-5, 10, 0], [5, 20, 10]);
  });

  // Suspect, pinned: the disjoint fuse is re-registered by volume, so b:ring now holds a
  // rotated copy and the original lands on b:ring:4. References to b:ring move.
  it("combine with disjoint copies splits into four bodies by volume (pinned snapshot, suspect)", () => {
    const r = run(timeline(4, 360, true));
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:ring", "b:ring:2", "b:ring:3", "b:ring:4"]);
    for (const id of r.bodyIds()) expectVolume(r.volume(id), 1000);
    expect(faceNames(r, "b:ring")).toContain("p3:cpat:f:ring:cap:end");
    expect(faceNames(r, "b:ring:4")).toContain("f:ring:cap:end");
    expectBox(r, "b:ring:4", [10, -5, 0], [20, 5, 10]);
  });

  it("a count below 2 is a feature error", () => {
    expectError(run(timeline(1, 360, false)), "cpat", /count must be/);
  });
});

describe("constructionPlane", () => {
  const planeOf = (result: EvaluateResult, id: string) =>
    result.planes.find((p) => p.featureId === id)!;

  it("offset 7 from XY and the midplane of XY and z = 10 (analytic)", () => {
    const r = run([
      {
        ...meta("off7"),
        type: "constructionPlane",
        method: { kind: "offset", base: XY, distance: 7 },
      },
      {
        ...meta("off10"),
        type: "constructionPlane",
        method: { kind: "offset", base: XY, distance: 10 },
      },
      {
        ...meta("mid"),
        type: "constructionPlane",
        method: { kind: "midplane", a: XY, b: construction("off10") },
      },
    ]);
    expectOk(r);
    expect(planeOf(r.result, "off7")).toEqual({
      featureId: "off7",
      size: 40,
      frame: {
        origin: [0, 0, 7],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
      },
    });
    expect(planeOf(r.result, "mid").frame.origin).toEqual([0, 0, 5]);
    expect(planeOf(r.result, "mid").frame.normal).toEqual([0, 0, 1]);
  });

  it("size grows to 0.75 of the model diagonal (analytic)", () => {
    const r = run([
      ...box("big", 0, 0, 100, 100, 50),
      {
        ...meta("cp"),
        type: "constructionPlane",
        method: { kind: "offset", base: XY, distance: 1 },
      },
    ]);
    expect(planeOf(r.result, "cp").size).toBeCloseTo(0.75 * 150, 3);
  });

  it("a missing base plane is a feature error", () => {
    const r = run([
      {
        ...meta("cp"),
        type: "constructionPlane",
        method: { kind: "offset", base: construction("gone"), distance: 1 },
      },
    ]);
    expectError(r, "cp", /construction plane gone not found/);
    expect(r.result.planes).toEqual([]);
  });
});

describe("referenceImage", () => {
  it("publishes its plane with size 0 and no geometry (analytic)", () => {
    const r = run([
      {
        ...meta("img"),
        type: "referenceImage",
        plane: XZ,
        assetId: "a",
        fileName: "a.png",
        transform: { u: 0, v: 0, rotation: 0, scale: 1 },
        opacity: 1,
        visible: true,
        width: 10,
        height: 10,
      },
    ]);
    expectOk(r);
    expect(r.result.bodies).toEqual([]);
    expect(r.result.planes).toEqual([
      {
        featureId: "img",
        size: 0,
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 0, 1],
          normal: [0, -1, 0],
        },
      },
    ]);
  });
});

describe("move", () => {
  it("translates the body, keeps face names and carries its sketch along (analytic)", () => {
    const r = run([
      ...baseBox(),
      {
        ...meta("mv"),
        type: "move",
        bodies: ["b:box"],
        translation: [5, -5, 2],
      },
    ]);
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:box"]);
    expectVolume(r.volume("b:box"), 6000);
    expectBox(r, "b:box", [5, -5, 2], [25, 25, 12]);
    expect(faceNames(r, "b:box")).toEqual([
      "f:box:cap:end",
      "f:box:cap:start",
      "f:box:s:boxSk-l1",
      "f:box:s:boxSk-l2",
      "f:box:s:boxSk-l3",
      "f:box:s:boxSk-l4",
    ]);
    expect(
      r.result.sketches.find((s) => s.featureId === "boxSk")!.frame.origin,
    ).toEqual([5, -5, 2]);
  });

  it("an empty selection is a feature error", () => {
    expectError(
      run([
        ...baseBox(),
        { ...meta("mv"), type: "move", bodies: [], translation: [1, 0, 0] },
      ]),
      "mv",
      /select at least one body/,
    );
  });
});

describe("importStep", () => {
  it("a 20x30x10 STEP box imports as one body with fallback face names (analytic)", () => {
    const r = run([
      {
        ...meta("step"),
        type: "importStep",
        filename: "box.step",
        data: stepFixture(),
      },
    ]);
    expectOk(r);
    expect(r.bodyIds()).toEqual(["b:step"]);
    expectVolume(r.volume("b:step"), 6000);
    expectBox(r, "b:step", [0, 0, 0], [20, 30, 10]);
    expect(faceNames(r, "b:step")).toEqual([
      "f:step:x1",
      "f:step:x2",
      "f:step:x3",
      "f:step:x4",
      "f:step:x5",
      "f:step:x6",
    ]);
  });

  it("invalid STEP data is a feature error", () => {
    const r = run([
      {
        ...meta("step"),
        type: "importStep",
        filename: "bad.step",
        data: "ISO-10303-21;\nnot a model",
      },
    ]);
    expect(r.status("step")?.status).toBe("error");
    expect(r.result.bodies).toEqual([]);
  });
});

describe("dispatcher", () => {
  it("an unknown feature type is a feature error, not a throw", () => {
    const r = run([{ ...meta("cam"), type: "cam" } as unknown as Feature]);
    expectError(r, "cam", /^unknown feature type cam$/);
  });
});
