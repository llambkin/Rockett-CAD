import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  ValidationError,
  type Feature,
} from "@rockett/shared";
import { migrateDocument } from "../src/store/migrations.js";
import { validateDocument, validateFeature } from "../src/api/validate.js";

const base = { id: "f1", name: "F1", suppressed: false };
const profile = { sketchId: "sk", profileId: "p" };
const plane = { kind: "origin", plane: "XY" } as const;
const axis = { kind: "originAxis", axis: "Z" };
const extrude = {
  ...base,
  type: "extrude",
  profiles: [profile],
  distance: 5,
  direction: "normal",
  operation: "newBody",
};
const revolve = {
  ...base,
  type: "revolve",
  profiles: [profile],
  axis,
  angle: 90,
  operation: "newBody",
};
const sweep = {
  ...base,
  type: "sweep",
  profiles: [profile],
  pathSketchId: "path",
  operation: "newBody",
};
const loft = {
  ...base,
  type: "loft",
  sections: [profile, profile],
  operation: "newBody",
};
const emboss = {
  ...base,
  type: "emboss",
  profiles: [profile],
  depth: 1,
  mode: "emboss",
};
const linearPattern = {
  ...base,
  type: "linearPattern",
  bodies: ["b1"],
  direction: { kind: "axis", axis: "X" },
  count: 2,
  spacing: 5,
  combine: false,
};
const circularPattern = {
  ...base,
  type: "circularPattern",
  bodies: ["b1"],
  axis,
  count: 2,
  totalAngle: 360,
  combine: false,
};

const face = { kind: "face", bodyId: "b1", faceName: "f" };
const edge = { kind: "edge", bodyId: "b1", edgeName: "e" };
const mirror = {
  ...base,
  type: "mirror",
  bodies: ["b1"],
  plane,
  combine: false,
};
const referenceImage = {
  ...base,
  type: "referenceImage",
  plane,
  assetId: "a",
  fileName: "a.png",
  transform: { u: 0, v: 0, rotation: 0, scale: 1 },
  opacity: 1,
  visible: true,
  width: 1,
  height: 1,
};

const cases: Array<{ valid: Feature; invalid: Feature }> = [
  {
    valid: {
      ...base,
      type: "sweep",
      profiles: [profile],
      pathSketchId: "path",
      operation: "newBody",
    },
    invalid: {
      ...base,
      type: "sweep",
      profiles: [],
      pathSketchId: "path",
      operation: "newBody",
    },
  },
  {
    valid: {
      ...base,
      type: "loft",
      sections: [profile, profile],
      operation: "newBody",
    },
    invalid: {
      ...base,
      type: "loft",
      sections: [profile],
      operation: "newBody",
    },
  },
  {
    valid: {
      ...base,
      type: "combine",
      operation: "cut",
      targetBody: "b1",
      toolBodies: ["b2"],
      keepTools: false,
    },
    invalid: {
      ...base,
      type: "combine",
      operation: "cut",
      targetBody: "b1",
      toolBodies: Array(65).fill("b2"),
      keepTools: false,
    },
  },
  {
    valid: { ...base, type: "splitBody", body: "b1", tool: plane },
    invalid: {
      ...base,
      type: "splitBody",
      body: "b1",
      tool: { kind: "bogus" } as any,
    },
  },
  {
    valid: { ...base, type: "mirror", bodies: ["b1"], plane, combine: false },
    invalid: { ...base, type: "mirror", bodies: [], plane, combine: false },
  },
];

describe("validateFeature", () => {
  for (const { valid, invalid } of cases) {
    it(`accepts a valid ${valid.type} and rejects an out-of-bounds one`, () => {
      expect(() => validateFeature(valid)).not.toThrow();
      expect(() => validateFeature(invalid)).toThrow(ValidationError);
    });
  }

  it("rejects missing arrays with a validation error, not a crash", () => {
    const missing = [
      { ...base, type: "extrude", distance: 5 },
      { ...base, type: "fillet", radius: 1 },
      { ...base, type: "chamfer", distance: 1 },
      { ...base, type: "move", translation: [0, 0, 1] },
      { ...base, type: "move", bodies: ["b1"] },
    ];
    for (const f of missing)
      expect(() => validateFeature(f as any)).toThrow(ValidationError);
  });

  it("malformed shapes give ValidationError", () => {
    const sketch = { ...base, type: "sketch", plane, constraints: [] };
    const features = [
      { ...base, type: "constructionPlane" },
      { ...base, type: "referenceImage", opacity: 1, width: 1, height: 1 },
      { ...sketch, entities: [null] },
      null,
      [],
      "abc",
    ];
    for (const f of features)
      expect(() => validateFeature(f as any)).toThrow(ValidationError);
    const doc = { id: "d", name: "D", features: [null], timelinePosition: 0 };
    expect(() => validateDocument(doc as any)).toThrow(ValidationError);
  });

  it("references and lists", () => {
    const shell = { ...base, type: "shell", openFaces: [], thickness: 1 };
    const offsetFace = {
      ...base,
      type: "offsetFace",
      faces: [face],
      distance: 1,
    };
    const fillet = { ...base, type: "fillet", edges: [edge], radius: 1 };
    const chamfer = { ...base, type: "chamfer", edges: [edge], distance: 1 };
    const move = {
      ...base,
      type: "move",
      bodies: ["b1"],
      translation: [0, 0, 1],
    };
    const valid = [
      extrude,
      { ...extrude, profiles: [], faces: [face] },
      revolve,
      sweep,
      loft,
      emboss,
      shell,
      { ...shell, openFaces: [face] },
      offsetFace,
      fillet,
      chamfer,
      linearPattern,
      circularPattern,
      move,
    ];
    for (const f of valid)
      expect(() => validateFeature(f as any)).not.toThrow();
    const invalid = [
      { ...extrude, profiles: [null] },
      { ...extrude, profiles: [{ sketchId: 1, profileId: "p" }] },
      { ...extrude, faces: [edge] },
      { ...extrude, faces: [{ kind: "face", bodyId: "b1" }] },
      { ...revolve, profiles: undefined },
      { ...revolve, profiles: [{ sketchId: "sk" }] },
      { ...sweep, profiles: [{ profileId: "p" }] },
      { ...loft, sections: [profile, "p"] },
      { ...emboss, profiles: undefined },
      { ...emboss, profiles: [] },
      { ...shell, openFaces: undefined },
      { ...shell, openFaces: [null] },
      { ...offsetFace, faces: undefined },
      { ...offsetFace, faces: [{ ...face, faceName: 7 }] },
      { ...fillet, edges: [null] },
      { ...chamfer, edges: [face] },
      { ...linearPattern, bodies: undefined },
      { ...linearPattern, bodies: [1] },
      { ...circularPattern, bodies: undefined },
      { ...circularPattern, bodies: [] },
      { ...move, bodies: [""] },
    ];
    for (const f of invalid)
      expect
        .soft(() => validateFeature(f as any), JSON.stringify(f))
        .toThrow(ValidationError);
  });

  it("enums and flags", () => {
    const combine = {
      ...base,
      type: "combine",
      operation: "cut",
      targetBody: "b1",
      toolBodies: ["b2"],
      keepTools: false,
    };
    const valid: object[] = [
      { ...emboss, mode: "deboss" },
      { ...combine, keepTools: true },
      { ...mirror, combine: true },
      { ...linearPattern, combine: true },
      { ...circularPattern, combine: true },
      { ...referenceImage, visible: false },
    ];
    for (const operation of ["newBody", "join", "cut", "intersect"])
      for (const f of [extrude, revolve, sweep, loft])
        valid.push({ ...f, operation });
    for (const direction of ["normal", "reverse", "symmetric", "twoSided"])
      valid.push({ ...extrude, direction });
    for (const f of valid)
      expect
        .soft(() => validateFeature(f as any), JSON.stringify(f))
        .not.toThrow();
    const invalid = [
      ...[extrude, revolve, sweep, loft].flatMap((f) => [
        { ...f, operation: "bogus" },
        { ...f, operation: undefined },
      ]),
      { ...extrude, direction: "sideways" },
      { ...extrude, direction: undefined },
      { ...emboss, mode: "raise" },
      { ...emboss, mode: undefined },
      { ...combine, keepTools: "false" },
      { ...combine, keepTools: undefined },
      { ...mirror, combine: 1 },
      { ...linearPattern, combine: "true" },
      { ...circularPattern, combine: undefined },
      { ...referenceImage, visible: "yes" },
      { ...referenceImage, visible: undefined },
    ];
    for (const f of invalid)
      expect
        .soft(() => validateFeature(f as any), JSON.stringify(f))
        .toThrow(ValidationError);
  });

  it("plane and axis refs", () => {
    const goodPlanes = [
      ...["XY", "XZ", "YZ"].map((name) => ({ kind: "origin", plane: name })),
      { kind: "construction", featureId: "cp1" },
      { kind: "face", face },
    ];
    const badPlanes = [
      null,
      { kind: "bogus" },
      { kind: "origin", plane: "QQ" },
      { kind: "origin" },
      { kind: "construction" },
      { kind: "construction", featureId: 3 },
      { kind: "face" },
      { kind: "face", face: edge },
      { kind: "face", face: { kind: "face", bodyId: "b1" } },
    ];
    const goodAxes = [
      ...["X", "Y", "Z"].map((name) => ({ kind: "originAxis", axis: name })),
      { kind: "edge", edge },
      { kind: "sketchLine", sketchId: "sk", entityId: "l1" },
    ];
    const badAxes = [
      null,
      { kind: "bogus" },
      { kind: "originAxis", axis: "W" },
      { kind: "axis", axis: "X" },
      { kind: "edge" },
      { kind: "edge", edge: face },
      { kind: "sketchLine", sketchId: "sk" },
      { kind: "sketchLine", entityId: "l1" },
    ];
    const goodDirections = [
      ...["X", "Y", "Z"].map((name) => ({ kind: "axis", axis: name })),
      { kind: "edge", edge },
    ];
    const badDirections = [
      null,
      { kind: "originAxis", axis: "X" },
      { kind: "axis", axis: "W" },
      { kind: "edge" },
      { kind: "edge", edge: face },
    ];
    const sketch = {
      ...base,
      type: "sketch",
      plane,
      entities: [],
      constraints: [],
    };
    const splitBody = { ...base, type: "splitBody", body: "b1", tool: plane };
    const offsetPlane = (p: unknown) => ({
      ...base,
      type: "constructionPlane",
      method: { kind: "offset", base: p, distance: 1 },
    });
    const midplane = (a: unknown, b: unknown) => ({
      ...base,
      type: "constructionPlane",
      method: { kind: "midplane", a, b },
    });
    const withPlane = (p: unknown) => [
      { ...sketch, plane: p },
      { ...splitBody, tool: p },
      { ...mirror, plane: p },
      { ...referenceImage, plane: p },
      offsetPlane(p),
      midplane(p, plane),
      midplane(plane, p),
    ];
    const withAxis = (a: unknown) => [
      { ...revolve, axis: a },
      { ...circularPattern, axis: a },
    ];
    const withDirection = (direction: unknown) => [
      { ...linearPattern, direction },
    ];
    const valid = [
      ...goodPlanes.flatMap(withPlane),
      ...goodAxes.flatMap(withAxis),
      ...goodDirections.flatMap(withDirection),
    ];
    for (const f of valid)
      expect
        .soft(() => validateFeature(f as any), JSON.stringify(f))
        .not.toThrow();
    const invalid = [
      ...badPlanes.flatMap(withPlane),
      ...badAxes.flatMap(withAxis),
      ...badDirections.flatMap(withDirection),
      { ...offsetPlane(plane), method: { kind: "tangent", base: plane } },
    ];
    for (const f of invalid)
      expect
        .soft(() => validateFeature(f as any), JSON.stringify(f))
        .toThrow(ValidationError);
  });

  it("rejects an unknown feature type", () => {
    expect(() =>
      validateFeature({ ...base, type: "cam" } as unknown as Feature),
    ).toThrow(/unknown feature type cam/);
  });
});

describe("validateDocument", () => {
  it("document base shape", () => {
    const fixture = migrateDocument(
      JSON.parse(
        readFileSync(
          new URL("./fixtures/invalid-top-fillet.json", import.meta.url),
          "utf8",
        ),
      ).document,
    );
    const doc = {
      ...createEmptyDocument("d", "D"),
      features: [{ ...base, type: "fillet", edges: [edge], radius: 1 }],
      timelinePosition: 1,
      bodyMeta: { b1: { name: "", visible: false } },
      counters: { fillet: 1, body: 0 },
      camera: {
        position: [1, 2, 3],
        target: [0, 0, 0],
        up: [0, 0, 1],
        projection: "perspective",
      },
    };
    for (const valid of [fixture, createEmptyDocument("e", "E"), doc])
      expect(() => validateDocument(valid as any)).not.toThrow();
    const invalid = [
      { features: [{ ...doc.features[0], suppressed: "yes" }] },
      { features: [{ ...doc.features[0], suppressed: undefined }] },
      { schemaVersion: 3 },
      { schemaVersion: "4" },
      { units: "ft" },
      { bodyMeta: null },
      { bodyMeta: { b1: null } },
      { bodyMeta: { b1: { name: 1, visible: true } } },
      { bodyMeta: { b1: { name: "B", visible: "yes" } } },
      { counters: [] },
      { counters: { fillet: -1 } },
      { counters: { fillet: 1.5 } },
      { counters: { fillet: "1" } },
      { createdAt: 0 },
      { modifiedAt: undefined },
      { timelinePosition: 0.5 },
      { camera: null },
      { camera: { ...doc.camera, position: [0, 0] } },
      { camera: { ...doc.camera, up: [0, 0, "1"] } },
      { camera: { ...doc.camera, projection: "fisheye" } },
    ];
    for (const change of invalid)
      expect
        .soft(
          () => validateDocument({ ...doc, ...change } as any),
          JSON.stringify(change),
        )
        .toThrow(ValidationError);
  });
});
