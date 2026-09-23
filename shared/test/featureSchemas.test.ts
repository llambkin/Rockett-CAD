import { describe, expect, it } from "vitest";
import type { Static } from "typebox";
import type {
  ConstructionPlaneFeature,
  EmbossFeature,
  ImportStepFeature,
  ReferenceImageFeature,
  SketchFeature,
} from "../src/model.js";
import { FEATURE_SCHEMAS } from "../src/schema/features.js";
import { parse, ValidationError } from "../src/schema/index.js";

type Flat<T> = T extends object ? { [K in keyof T]: Flat<T[K]> } : T;
type Equal<A, B> =
  (<T>() => T extends Flat<A> ? 1 : 2) extends <T>() => T extends Flat<B>
    ? 1
    : 2
    ? true
    : false;
type Schemas = typeof FEATURE_SCHEMAS;

const typesMatch: {
  sketch: Equal<Static<Schemas["sketch"]>, SketchFeature>;
  constructionPlane: Equal<
    Static<Schemas["constructionPlane"]>,
    ConstructionPlaneFeature
  >;
  referenceImage: Equal<
    Static<Schemas["referenceImage"]>,
    ReferenceImageFeature
  >;
  importStep: Equal<Static<Schemas["importStep"]>, ImportStepFeature>;
  emboss: Equal<Static<Schemas["emboss"]>, EmbossFeature>;
} = {
  sketch: true,
  constructionPlane: true,
  referenceImage: true,
  importStep: true,
  emboss: true,
};

const base = { id: "f1", name: "F1", suppressed: false };
const plane = { kind: "origin", plane: "XY" } as const;

const fixtures: {
  [T in keyof Schemas]: {
    valid: Static<Schemas[T]>;
    invalid: unknown;
    path: string;
  };
} = {
  sketch: {
    valid: {
      ...base,
      type: "sketch",
      plane: {
        kind: "face",
        face: { kind: "face", bodyId: "b", faceName: "f" },
      },
      entities: [
        { id: "p1", kind: "point", x: 0, y: 0 },
        { id: "p2", kind: "point", x: 5, y: 0, construction: true },
        { id: "l1", kind: "line", p1: "p1", p2: "p2" },
        {
          id: "c1",
          kind: "circle",
          center: "p1",
          radius: 2,
          external: true,
          projection: { kind: "edge", bodyId: "b", edgeName: "e" },
        },
      ],
      constraints: [
        { id: "k1", type: "horizontal", line: "l1" },
        {
          id: "k2",
          type: "distance",
          a: "p1",
          b: "p2",
          axis: null,
          value: 5,
          labelOffset: [1, 2],
        },
        { id: "k3", type: "lineAngle", line: "l1", value: 180 },
      ],
      offsets: [
        {
          id: "o1",
          distance: 1,
          sourceIds: ["l1"],
          entityIds: ["l2"],
          joinTolerance: 0.01,
        },
      ],
      visible: false,
    },
    invalid: {
      ...base,
      type: "sketch",
      plane,
      entities: [],
      constraints: [{ id: "k1", type: "lineAngle", line: "l1", value: -180 }],
    },
    path: "/constraints/0",
  },
  constructionPlane: {
    valid: {
      ...base,
      type: "constructionPlane",
      method: {
        kind: "midplane",
        a: plane,
        b: { kind: "construction", featureId: "cp" },
      },
    },
    invalid: {
      ...base,
      type: "constructionPlane",
      method: { kind: "offset", base: plane, distance: "1" },
    },
    path: "/method",
  },
  referenceImage: {
    valid: {
      ...base,
      type: "referenceImage",
      plane,
      assetId: "a",
      fileName: "a.png",
      transform: { u: 0, v: 0, rotation: 45, scale: 0.1 },
      opacity: 0.5,
      visible: true,
      width: 640,
      height: 480,
    },
    invalid: {
      ...base,
      type: "referenceImage",
      plane,
      assetId: "a",
      fileName: "a.png",
      transform: { u: 0, v: 0, rotation: 0, scale: 0 },
      opacity: 0.5,
      visible: true,
      width: 640,
      height: 480,
    },
    path: "/transform/scale",
  },
  importStep: {
    valid: {
      ...base,
      type: "importStep",
      filename: "part.step",
      data: "\n ISO-10303-21;\nHEADER;",
    },
    invalid: {
      ...base,
      type: "importStep",
      filename: "part.step",
      data: "solid part",
    },
    path: "/data",
  },
  emboss: {
    valid: {
      ...base,
      type: "emboss",
      profiles: [{ sketchId: "sk", profileId: "p" }],
      depth: 1,
      mode: "deboss",
    },
    invalid: {
      ...base,
      type: "emboss",
      profiles: [{ sketchId: "sk", profileId: "p" }],
      depth: 1,
      mode: "raise",
    },
    path: "/mode",
  },
};

describe("feature schemas", () => {
  it("infer the model types", () => {
    expect(Object.values(typesMatch).every(Boolean)).toBe(true);
  });

  for (const [type, { valid, invalid, path }] of Object.entries(fixtures)) {
    const schema = FEATURE_SCHEMAS[type as keyof Schemas];
    it(`${type} accepts a valid feature and rejects ${path}`, () => {
      expect(parse(schema, valid)).toBe(valid);
      expect(() => parse(schema, invalid)).toThrow(ValidationError);
      expect(() => parse(schema, invalid)).toThrow(
        expect.objectContaining({ detail: path }),
      );
    });
  }
});
