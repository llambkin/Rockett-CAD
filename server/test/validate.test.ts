import { describe, expect, it } from "vitest";
import type { Feature } from "@rockett/shared";
import { validateFeature, ValidationError } from "../src/api/validate.js";

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

  it("rejects an unknown feature type", () => {
    expect(() =>
      validateFeature({ ...base, type: "cam" } as unknown as Feature),
    ).toThrow(/unknown feature type cam/);
  });
});
