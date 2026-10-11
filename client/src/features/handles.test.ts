import * as THREE from "three";
import { expect, expectTypeOf, it } from "vitest";
import type {
  MeshedBody,
  EvaluateResult,
  ExtensionFeature,
} from "@rockett/shared";
import "./core";
import {
  featureUI,
  registerFeatureUI,
  type FeatureUI,
  type InputParams,
} from "./registry";
import { num } from "./inputs";
import type { FilletParams } from "./fillet";
import {
  featureHandle,
  type FeatureHandleDefinition,
  type HandleInput,
} from "../three/featureHandles";

it.each([
  ["extrude", "distance", 10],
  ["revolve", "angle", 360],
  ["fillet", "radius", 2],
  ["chamfer", "distance", 1],
  ["shell", "thickness", 2],
  ["offsetFace", "distance", 5],
  ["emboss", "depth", 1],
  ["constructionPlane", "distance", 10],
  ["linearPattern", "spacing", 20],
  ["circularPattern", "totalAngle", 360],
] as const)("%s owns its numeric handle defaults", (type, param, fallback) => {
  expect(featureUI(type)).toHaveProperty(
    "handle",
    expect.objectContaining({ param, fallback }),
  );
});

const body: MeshedBody = {
  bodyId: "handle-body",
  name: "Handle fixture",
  meshKey: "triangle",
  positions: [0, 0, 0, 2, 0, 0, 0, 2, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2],
  faces: [
    {
      name: "top",
      start: 0,
      count: 3,
      area: 2,
      surface: { type: "plane", normal: [0, 0, 1], origin: [0, 0, 0] },
    },
  ],
  edges: [
    {
      name: "bottom",
      polyline: [0, 0, 0, 2, 0, 0],
      length: 2,
      curve: { type: "line", a: [0, 0, 0], b: [2, 0, 0] },
    },
  ],
  vertices: [],
  bbox: { min: [0, 0, 0], max: [2, 2, 2] },
};
const input: HandleInput = {
  dialog: "offsetFace",
  params: {},
  selection: [{ kind: "face", bodyId: body.bodyId, faceName: "top" }],
  bodies: [body],
  evaluation: null,
};

it.each([
  [undefined, 5],
  ["", 0],
  [0, 0],
  [-3, -3],
  ["7", 7],
  ["width +", 5],
  [Infinity, 5],
] as const)("retains numeric handle coercion for %s", (distance, value) => {
  const params = { distance };
  expect(featureHandle({ ...input, params })).toMatchObject({
    param: "distance",
    value,
    signed: true,
  });
  expect(params).toEqual({ distance });
});

it("takes new handle ownership from registration and releases it on unregister", () => {
  type Params = InputParams<{ width: number }>;
  const handle = {
    param: "width",
    fallback: 12,
    signed: true,
    place: () =>
      ({
        kind: "arrow",
        origin: new THREE.Vector3(1, 2, 3),
        axis: new THREE.Vector3(0, 1, 0),
      }) as const,
  } satisfies FeatureHandleDefinition<Params>;
  const ui: FeatureUI<ExtensionFeature<{ width: number }>, Params> = {
    type: "test.registeredHandle",
    title: "Registered handle",
    icon: "test",
    group: "test",
    picks: [],
    initialParams: {},
    handle,
    Form: () => null,
    build: (params) => ({
      id: "registered-handle",
      type: "test.registeredHandle",
      name: "",
      suppressed: false,
      version: 1,
      params: { width: num(params, handle.param, handle.fallback) },
    }),
    prefill: (feature) => ({ params: feature.params, selection: [] }),
  };
  const registeredInput = { ...input, dialog: ui.type };
  expect(featureHandle(registeredInput)).toBeNull();
  const unregister = registerFeatureUI(ui);
  try {
    expect(featureUI(ui.type)?.handle).toBe(handle);
    expect(featureHandle(registeredInput)).toMatchObject({
      value: 12,
      signed: true,
      origin: new THREE.Vector3(1, 2, 3),
    });
    handle.fallback = 17;
    expect(featureHandle(registeredInput)).toMatchObject({ value: 17 });
    expect(featureUI(ui.type)?.create().build([])).toMatchObject({
      params: { width: 17 },
    });
    const zero: Params = { width: 0 };
    expect(featureHandle({ ...registeredInput, params: zero })).toMatchObject({
      value: 0,
    });
  } finally {
    unregister();
  }
  expect(featureHandle(registeredInput)).toBeNull();
});

it.each(["fillet", "chamfer"])(
  "%s places an unsigned handle on the chosen edge",
  (dialog) => {
    expect(
      featureHandle({
        ...input,
        dialog,
        selection: [{ kind: "edge", bodyId: body.bodyId, edgeName: "bottom" }],
      }),
    ).toMatchObject({
      signed: false,
      origin: new THREE.Vector3(1, 0, 0),
      axis: new THREE.Vector3(0, 0, 1),
    });
  },
);

it("shell reverses the selected face normal without changing the source payload", () => {
  const before = structuredClone(body);
  expect(featureHandle({ ...input, dialog: "shell" })).toMatchObject({
    signed: false,
    axis: new THREE.Vector3(0, 0, 1).negate(),
  });
  expect(body).toEqual(before);
});

it("an outside shell points along the selected face normal", () => {
  expect(
    featureHandle({
      ...input,
      dialog: "shell",
      params: { shellDirection: "outside" },
    }),
  ).toMatchObject({ signed: false, axis: new THREE.Vector3(0, 0, 1) });
});

it("offset planes retain flip and refuse other construction methods", () => {
  const plane = {
    ...input,
    dialog: "constructionPlane",
    selection: [
      { kind: "plane", ref: { kind: "origin", plane: "XY" }, label: "XY" },
    ],
  } satisfies HandleInput;
  expect(featureHandle(plane)).toMatchObject({
    value: 10,
    signed: true,
    axis: new THREE.Vector3(0, 0, 1),
  });
  expect(featureHandle({ ...plane, params: { flip: true } })).toMatchObject({
    axis: new THREE.Vector3(0, 0, 1).negate(),
  });
  expect(
    featureHandle({ ...plane, params: { method: "midplane" } }),
  ).toBeNull();
});

it("patterns keep body centres, selected directions and signed values", () => {
  const selected = [{ kind: "body", bodyId: body.bodyId }] as const;
  const patternInput = {
    ...input,
    selection: [...selected],
    params: { spacing: -3, axis: "Y" },
  } satisfies HandleInput;
  expect(
    featureHandle({ ...patternInput, dialog: "linearPattern" }),
  ).toMatchObject({
    signed: true,
    value: -3,
    origin: new THREE.Vector3(1, 1, 1),
    axis: new THREE.Vector3(0, 1, 0),
  });
  expect(
    featureHandle({
      ...patternInput,
      dialog: "linearPattern",
      params: { axisSource: "edge" },
    }),
  ).toBeNull();
  expect(
    featureHandle({ ...patternInput, dialog: "linearPattern", params: {} }),
  ).toMatchObject({ axis: new THREE.Vector3(1, 0, 0), value: 20 });
  expect(
    featureHandle({
      ...patternInput,
      dialog: "linearPattern",
      params: { axisSource: "edge", spacing: 0 },
      selection: [
        ...selected,
        { kind: "edge", bodyId: body.bodyId, edgeName: "bottom" },
      ],
    }),
  ).toMatchObject({ axis: new THREE.Vector3(1, 0, 0), value: 0 });
  expect(
    featureHandle({ ...patternInput, dialog: "circularPattern" }),
  ).toMatchObject({
    kind: "arc",
    through: new THREE.Vector3(1, 1, 1),
    signed: true,
    value: 360,
  });
});

it("emboss and deboss place the handle in the selected sketch frame", () => {
  const evaluation: EvaluateResult = {
    bodies: [],
    planes: [],
    featureStatuses: [],
    kernelMs: 0,
    sketches: [
      {
        featureId: "sketch",
        entities: [],
        solveStatus: "fully_constrained",
        dof: 0,
        frame: {
          origin: [10, 20, 30],
          xAxis: [0, 1, 0],
          yAxis: [0, 0, 1],
          normal: [1, 0, 0],
        },
        profiles: [
          {
            id: "profile",
            outer: [],
            holes: [],
            polygon: [0, 0, 2, 0, 2, 2, 0, 2],
            holePolygons: [],
            area: 4,
          },
        ],
      },
    ],
  };
  const embossInput = {
    ...input,
    dialog: "emboss",
    evaluation,
    selection: [{ kind: "profile", sketchId: "sketch", profileId: "profile" }],
  } satisfies HandleInput;
  expect(featureHandle(embossInput)).toMatchObject({
    signed: false,
    origin: new THREE.Vector3(10, 21, 31),
    axis: new THREE.Vector3(1, 0, 0),
  });
  expect(
    featureHandle({ ...embossInput, params: { embossMode: "deboss" } }),
  ).toMatchObject({ axis: new THREE.Vector3(1, 0, 0).multiplyScalar(-1) });
});

it.each([
  "extrude",
  "revolve",
  "move",
  "test.absent",
  "fillet",
  "offsetFace",
  "emboss",
  "constructionPlane",
  "linearPattern",
  "circularPattern",
])("%s has no generic handle without its placement input", (dialog) => {
  expect(featureHandle({ ...input, dialog, selection: [] })).toBeNull();
});

it("rejects parameters outside a feature's numeric inputs", () => {
  expectTypeOf<{ param: "radius"; fallback: number }>().toExtend<
    FeatureHandleDefinition<FilletParams>
  >();
  expectTypeOf<{ param: "thickness"; fallback: number }>().not.toExtend<
    FeatureHandleDefinition<FilletParams>
  >();
  expectTypeOf<{ param: "name"; fallback: number }>().not.toExtend<
    FeatureHandleDefinition<FilletParams>
  >();
  expectTypeOf<{ param: "tangentChain"; fallback: number }>().not.toExtend<
    FeatureHandleDefinition<FilletParams>
  >();
});
