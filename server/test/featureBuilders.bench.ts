import { beforeAll, test } from "vitest";
import type {
  AxisRef,
  EdgeRef,
  Feature,
  PlaneRef,
  ProfileRef,
  SketchFeature,
} from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import {
  cloneState,
  emptyState,
  evaluateFeature,
  type EvalState,
} from "../src/geometry/features.js";
import { computeEdgeNames } from "../src/geometry/naming.js";
import { stepFixture } from "./helpers/stepFixture.js";

const SAMPLES = { iterations: 10, warmupIterations: 2, time: 0, warmupTime: 0 };

const XY: PlaneRef = { kind: "origin", plane: "XY" };
const XZ: PlaneRef = { kind: "origin", plane: "XZ" };
const YZ: PlaneRef = { kind: "origin", plane: "YZ" };
const Z_AXIS: AxisRef = { kind: "originAxis", axis: "Z" };
const TOP = {
  kind: "face" as const,
  bodyId: "b:box",
  faceName: "f:box:cap:end",
};
const meta = (id: string) => ({ id, name: id, suppressed: false });
const prof = (sketchId: string): ProfileRef => ({ sketchId, profileId: "" });

function rect(
  id: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
  plane = XY,
): SketchFeature {
  const corners = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ] as const;
  return {
    ...meta(id),
    type: "sketch",
    plane,
    constraints: [],
    entities: [
      ...corners.map(([x, y], i) => ({
        id: `${id}-p${i}`,
        kind: "point" as const,
        x,
        y,
      })),
      ...corners.map((_, i) => ({
        id: `${id}-l${i + 1}`,
        kind: "line" as const,
        p1: `${id}-p${i}`,
        p2: `${id}-p${(i + 1) % 4}`,
      })),
    ],
  };
}

const extrude = (id: string, sketchId: string): Feature => ({
  ...meta(id),
  type: "extrude",
  profiles: [prof(sketchId)],
  distance: 10,
  direction: "normal",
  operation: "newBody",
});

const box = (id = "box", x0 = 0, y0 = 0, w = 20, h = 30): Feature[] => [
  rect(`${id}Sk`, x0, y0, w, h),
  extrude(id, `${id}Sk`),
];

const boxEdge = (state: EvalState): EdgeRef[] => [
  {
    kind: "edge",
    bodyId: "b:box",
    edgeName: computeEdgeNames(state.bodies.get("b:box")!).byName.keys().next()
      .value!,
  },
];

const cp = (distance: number, base = XY): Feature => ({
  ...meta("cp"),
  type: "constructionPlane",
  method: { kind: "offset", base, distance },
});

interface Case {
  name: string;
  prefix: Feature[];
  feature: (state: EvalState) => Feature;
}

const cases: Case[] = [
  {
    name: "evaluateFeature importStep box",
    prefix: [],
    feature: () => ({
      ...meta("imp"),
      type: "importStep",
      filename: "box.step",
      data: stepFixture(),
    }),
  },
  {
    name: "evalSketch rectangle",
    prefix: [],
    feature: () => rect("boxSk", 0, 0, 20, 30),
  },
  {
    name: "evalExtrude box",
    prefix: [rect("boxSk", 0, 0, 20, 30)],
    feature: () => extrude("box", "boxSk"),
  },
  {
    name: "evalRevolve tube",
    prefix: [rect("sk", 5, 0, 5, 10, XZ)],
    feature: () => ({
      ...meta("rev"),
      type: "revolve",
      profiles: [prof("sk")],
      axis: Z_AXIS,
      angle: 360,
      operation: "newBody",
    }),
  },
  {
    name: "evalSweep circle along line",
    prefix: [
      {
        ...meta("prof"),
        type: "sketch",
        plane: XY,
        constraints: [],
        entities: [
          { id: "c", kind: "point", x: 0, y: 0 },
          { id: "circ", kind: "circle", center: "c", radius: 2 },
        ],
      },
      {
        ...meta("path"),
        type: "sketch",
        plane: XZ,
        constraints: [],
        entities: [
          { id: "p0", kind: "point", x: 0, y: 0 },
          { id: "p1", kind: "point", x: 0, y: 20 },
          { id: "seg", kind: "line", p1: "p0", p2: "p1" },
        ],
      },
    ],
    feature: () => ({
      ...meta("sw"),
      type: "sweep",
      profiles: [prof("prof")],
      pathSketchId: "path",
      operation: "newBody",
    }),
  },
  {
    name: "evalLoft square frustum",
    prefix: [
      rect("lo1", -10, -10, 20, 20),
      cp(10),
      rect("lo2", -5, -5, 10, 10, { kind: "construction", featureId: "cp" }),
    ],
    feature: () => ({
      ...meta("loft"),
      type: "loft",
      sections: [prof("lo1"), prof("lo2")],
      operation: "newBody",
    }),
  },
  {
    name: "evalFillet box edge",
    prefix: box(),
    feature: (state) => ({
      ...meta("fil"),
      type: "fillet",
      edges: boxEdge(state),
      radius: 1,
    }),
  },
  {
    name: "evalChamfer box edge",
    prefix: box(),
    feature: (state) => ({
      ...meta("ch"),
      type: "chamfer",
      edges: boxEdge(state),
      distance: 1,
    }),
  },
  {
    name: "evalCombine join overlapping boxes",
    prefix: [...box(), ...box("tool", 10, 10)],
    feature: () => ({
      ...meta("cmb"),
      type: "combine",
      operation: "join",
      targetBody: "b:box",
      toolBodies: ["b:tool"],
      keepTools: false,
    }),
  },
  {
    name: "evalShell box open top",
    prefix: box(),
    feature: () => ({
      ...meta("sh"),
      type: "shell",
      openFaces: [TOP],
      thickness: 1,
    }),
  },
  {
    name: "evalOffsetFace box top",
    prefix: box(),
    feature: () => ({
      ...meta("off"),
      type: "offsetFace",
      faces: [TOP],
      distance: 5,
    }),
  },
  {
    name: "evalSplitBody box at x 5",
    prefix: [...box(), cp(5, YZ)],
    feature: () => ({
      ...meta("split"),
      type: "splitBody",
      body: "b:box",
      tool: { kind: "construction", featureId: "cp" },
    }),
  },
  {
    name: "evalMirror box across YZ",
    prefix: box(),
    feature: () => ({
      ...meta("mir"),
      type: "mirror",
      bodies: ["b:box"],
      plane: YZ,
      combine: true,
    }),
  },
  {
    name: "evalMove box",
    prefix: box(),
    feature: () => ({
      ...meta("mv"),
      type: "move",
      bodies: ["b:box"],
      translation: [5, -5, 2],
    }),
  },
  {
    name: "evalLinearPattern box 3 along X",
    prefix: box(),
    feature: () => ({
      ...meta("lp"),
      type: "linearPattern",
      bodies: ["b:box"],
      direction: { kind: "axis", axis: "X" },
      count: 3,
      spacing: 30,
      combine: false,
    }),
  },
  {
    name: "evalCircularPattern box 4 about Z",
    prefix: box("ring", 10, -5, 10, 10),
    feature: () => ({
      ...meta("cpat"),
      type: "circularPattern",
      bodies: ["b:ring"],
      axis: Z_AXIS,
      count: 4,
      totalAngle: 360,
      combine: false,
    }),
  },
  {
    name: "evalConstructionPlane offset XY",
    prefix: [],
    feature: () => cp(10),
  },
  {
    name: "evalEmboss box top",
    prefix: [...box(), rect("em", 5, 5, 5, 5, { kind: "face", face: TOP })],
    feature: () => ({
      ...meta("emb"),
      type: "emboss",
      profiles: [prof("em")],
      depth: 2,
      mode: "emboss",
    }),
  },
];

function withProfiles(state: EvalState, feature: Feature): Feature {
  const refs =
    "profiles" in feature
      ? feature.profiles
      : "sections" in feature
        ? feature.sections
        : [];
  for (const ref of refs)
    ref.profileId = state.sketches.get(ref.sketchId)!.profiles[0]!.id;
  return feature;
}

beforeAll(initKernel, 120_000);

test.for(cases)("$name", async ({ name, prefix, feature }, { bench }) => {
  const state = emptyState();
  prefix.forEach((f, i) =>
    evaluateFeature(state, withProfiles(state, f), prefix.slice(0, i)),
  );
  const target = withProfiles(state, feature(state));
  await bench(name, () =>
    evaluateFeature(cloneState(state), target, prefix),
  ).run(SAMPLES);
});
