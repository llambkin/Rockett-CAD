import { expect, it } from "vitest";
import {
  collectTopoRefs,
  featureSpec,
  inputBodies,
  inputFeatures,
  registerFeatureSpec,
  refAt,
  topoRefPaths,
  type Feature,
  type FaceRef,
  type EdgeRef,
} from "./index.js";

it("uses registered references and ignores opaque feature parameters", () => {
  const face = { kind: "face" as const, bodyId: "source", faceName: "top" };
  const feature = {
    id: "extension",
    name: "Extension",
    suppressed: false,
    type: "test.references",
    plane: { kind: "face" as const, face },
    axis: { kind: "sketchLine" as const, sketchId: "axis", entityId: "line" },
    params: { opaque: { kind: "edge", bodyId: "opaque", edgeName: "hidden" } },
  };
  let calls = 0;
  const dispose = registerFeatureSpec({
    ...featureSpec("shell")!,
    type: feature.type,
    refs: () => {
      calls++;
      return [
        refAt("plane", "/plane", feature.plane),
        refAt("axis", "/axis", feature.axis),
      ];
    },
  });
  try {
    const input = feature as unknown as Feature;
    expect(topoRefPaths(input)).toEqual([["/plane/face", face]]);
    expect(calls).toBe(1);
    expect(collectTopoRefs(input)).toEqual([face]);
    expect(inputBodies(input)).toEqual(["source"]);
    expect(inputFeatures(input)).toEqual(["axis"]);
  } finally {
    dispose();
  }
});

it("deduplicates dependencies while preserving every reference occurrence", () => {
  const face = { kind: "face" as const, bodyId: "source", faceName: "top" };
  const feature: Feature = {
    id: "extrude",
    name: "Extrude",
    suppressed: false,
    type: "extrude",
    profiles: [
      { sketchId: "sketch", profileId: "a" },
      { sketchId: "sketch", profileId: "b" },
    ],
    faces: [face, face],
    targets: ["source"],
    distance: 1,
    direction: "normal",
    operation: "join",
  };
  expect(topoRefPaths(feature).map(([path]) => path)).toEqual([
    "/faces/0",
    "/faces/1",
  ]);
  expect(inputBodies(feature)).toEqual(["source"]);
  expect(inputFeatures(feature)).toEqual(["sketch"]);
});

it("includes vertex body inputs without treating them as signed topology", () => {
  const feature: Feature = {
    id: "plane",
    name: "Plane",
    suppressed: false,
    type: "constructionPlane",
    method: {
      kind: "threePoints",
      points: [
        { kind: "vertex", bodyId: "body", vertexName: "corner" },
        { kind: "sketchPoint", sketchId: "sketch", entityId: "p1" },
        { kind: "sketchPoint", sketchId: "sketch", entityId: "p2" },
      ],
    },
  };
  expect(inputBodies(feature)).toEqual(["body"]);
  expect(inputFeatures(feature)).toEqual(["sketch"]);
  expect(collectTopoRefs(feature)).toEqual([]);
});

it("leaves unknown module parameters opaque for the evaluator to report", () => {
  const feature = {
    id: "unknown",
    name: "Unknown",
    suppressed: false,
    type: "module.unknown",
    version: 1,
    params: { face: { kind: "face", bodyId: "private-body", faceName: "top" } },
  } as Feature;
  expect(collectTopoRefs(feature)).toEqual([]);
  expect(inputBodies(feature)).toEqual([]);
  expect(inputFeatures(feature)).toEqual([]);
});

it("keeps kindless legacy inputs out of signed topology without changing them", () => {
  const face = { bodyId: "face-body", faceName: "top" };
  const edge = { bodyId: "edge-body", edgeName: "side" };
  const feature = {
    id: "legacy",
    name: "Legacy",
    suppressed: false,
    type: "shell",
    faces: [face],
    edges: [edge],
    direction: "inside",
    thickness: 1,
  } as unknown as Feature;
  const original = structuredClone(feature);
  const dispose = registerFeatureSpec({
    ...featureSpec("shell")!,
    type: "test.legacy",
    refs: () => [
      refAt("face", "/faces/0", face as FaceRef),
      refAt("edge", "/edges/0", edge as EdgeRef),
    ],
  });
  try {
    const input = { ...feature, type: "test.legacy" } as Feature;
    expect(collectTopoRefs(input)).toEqual([]);
    expect(inputBodies(input)).toEqual(["face-body", "edge-body"]);
    expect(feature).toEqual(original);
  } finally {
    dispose();
  }
});
