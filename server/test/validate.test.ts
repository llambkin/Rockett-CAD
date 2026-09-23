import { describe, expect, it } from "vitest";
import type { Feature } from "@rockett/shared";
import {
  validateDocument,
  validateFeature,
  ValidationError,
} from "../src/api/validate.js";

const base = { id: "f1", name: "F1", suppressed: false };
const profile = { sketchId: "sk", profileId: "p" };
const plane = { kind: "origin", plane: "XY" } as const;

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
    const face = { kind: "face", bodyId: "b1", faceName: "f" };
    const edge = { kind: "edge", bodyId: "b1", edgeName: "e" };
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
    const shell = { ...base, type: "shell", openFaces: [], thickness: 1 };
    const offsetFace = {
      ...base,
      type: "offsetFace",
      faces: [face],
      distance: 1,
    };
    const fillet = { ...base, type: "fillet", edges: [edge], radius: 1 };
    const chamfer = { ...base, type: "chamfer", edges: [edge], distance: 1 };
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

  it("rejects an unknown feature type", () => {
    expect(() =>
      validateFeature({ ...base, type: "cam" } as unknown as Feature),
    ).toThrow(/unknown feature type cam/);
  });
});
