import { describe, expect, it } from "vitest";
import type { Static } from "typebox";
import type {
  CadDocument,
  ChamferFeature,
  CircularPatternFeature,
  CombineFeature,
  ConstructionPlaneFeature,
  EmbossFeature,
  ExtrudeFeature,
  FilletFeature,
  ImportStepFeature,
  ImportMeshFeature,
  LinearPatternFeature,
  LoftFeature,
  MirrorFeature,
  MoveFeature,
  OffsetFaceFeature,
  ReferenceImageFeature,
  RevolveFeature,
  ShellFeature,
  SketchFeature,
  SplitBodyFeature,
  SweepFeature,
} from "../src/model.js";
import { documentSchema, FEATURE_SCHEMAS } from "../src/schema/features.js";
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
  importMesh: Equal<Static<Schemas["importMesh"]>, ImportMeshFeature>;
  emboss: Equal<Static<Schemas["emboss"]>, EmbossFeature>;
  extrude: Equal<Static<Schemas["extrude"]>, ExtrudeFeature>;
  revolve: Equal<Static<Schemas["revolve"]>, RevolveFeature>;
  sweep: Equal<Static<Schemas["sweep"]>, SweepFeature>;
  loft: Equal<Static<Schemas["loft"]>, LoftFeature>;
  fillet: Equal<Static<Schemas["fillet"]>, FilletFeature>;
  chamfer: Equal<Static<Schemas["chamfer"]>, ChamferFeature>;
  shell: Equal<Static<Schemas["shell"]>, ShellFeature>;
  combine: Equal<Static<Schemas["combine"]>, CombineFeature>;
  splitBody: Equal<Static<Schemas["splitBody"]>, SplitBodyFeature>;
  offsetFace: Equal<Static<Schemas["offsetFace"]>, OffsetFaceFeature>;
  mirror: Equal<Static<Schemas["mirror"]>, MirrorFeature>;
  linearPattern: Equal<Static<Schemas["linearPattern"]>, LinearPatternFeature>;
  circularPattern: Equal<
    Static<Schemas["circularPattern"]>,
    CircularPatternFeature
  >;
  move: Equal<Static<Schemas["move"]>, MoveFeature>;
  document: Equal<
    Omit<Static<typeof documentSchema>, "features" | "schemaVersion">,
    Omit<CadDocument, "features" | "schemaVersion">
  >;
} = {
  sketch: true,
  constructionPlane: true,
  referenceImage: true,
  importStep: true,
  importMesh: true,
  emboss: true,
  extrude: true,
  revolve: true,
  sweep: true,
  loft: true,
  fillet: true,
  chamfer: true,
  shell: true,
  combine: true,
  splitBody: true,
  offsetFace: true,
  mirror: true,
  linearPattern: true,
  circularPattern: true,
  move: true,
  document: true,
};

const base = { id: "f1", name: "F1", suppressed: false };
const plane = { kind: "origin", plane: "XY" } as const;
const profile = { sketchId: "sk", profileId: "p" };
const face = { kind: "face", bodyId: "b", faceName: "f" } as const;
const edge = { kind: "edge", bodyId: "b", edgeName: "e" } as const;

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
    path: "",
  },
  importMesh: {
    valid: {
      ...base,
      type: "importMesh",
      filename: "part.stl",
      format: "stl",
      data: "c29saWQ=",
    },
    invalid: {
      ...base,
      type: "importMesh",
      filename: "part.stl",
      format: "stl",
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
  extrude: {
    valid: {
      ...base,
      type: "extrude",
      profiles: [],
      faces: [face],
      distance: -5,
      distance2: 2,
      startOffset: -1,
      direction: "twoSided",
      operation: "cut",
    },
    invalid: {
      ...base,
      type: "extrude",
      profiles: [],
      distance: 5,
      direction: "normal",
      operation: "newBody",
    },
    path: "",
  },
  revolve: {
    valid: {
      ...base,
      type: "revolve",
      profiles: [profile],
      axis: { kind: "edge", edge },
      angle: -90,
      operation: "join",
    },
    invalid: {
      ...base,
      type: "revolve",
      profiles: [profile],
      axis: { kind: "sketchLine", sketchId: "sk" },
      angle: 90,
      operation: "join",
    },
    path: "/axis",
  },
  sweep: {
    valid: {
      ...base,
      type: "sweep",
      profiles: [profile],
      pathSketchId: "path",
      operation: "intersect",
    },
    invalid: {
      ...base,
      type: "sweep",
      profiles: [profile],
      pathSketchId: "",
      operation: "intersect",
    },
    path: "/pathSketchId",
  },
  loft: {
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
    path: "/sections",
  },
  fillet: {
    valid: {
      ...base,
      type: "fillet",
      tangentChain: true,
      edges: [edge],
      radius: 1,
    },
    invalid: { ...base, type: "fillet", edges: [edge], radius: 0 },
    path: "/radius",
  },
  chamfer: {
    valid: { ...base, type: "chamfer", edges: [edge], distance: 1 },
    invalid: { ...base, type: "chamfer", edges: [face], distance: 1 },
    path: "/edges/0",
  },
  shell: {
    valid: { ...base, type: "shell", openFaces: [], thickness: 1 },
    invalid: { ...base, type: "shell", openFaces: [], thickness: -1 },
    path: "/thickness",
  },
  combine: {
    valid: {
      ...base,
      type: "combine",
      operation: "join",
      targetBody: "b1",
      toolBodies: ["b2"],
      keepTools: true,
    },
    invalid: {
      ...base,
      type: "combine",
      operation: "newBody",
      targetBody: "b1",
      toolBodies: ["b2"],
      keepTools: true,
    },
    path: "/operation",
  },
  splitBody: {
    valid: {
      ...base,
      type: "splitBody",
      body: "b1",
      tool: { kind: "face", face },
    },
    invalid: {
      ...base,
      type: "splitBody",
      body: "b1",
      tool: { kind: "face", face: { kind: "face", faceName: "f" } },
    },
    path: "/tool",
  },
  offsetFace: {
    valid: { ...base, type: "offsetFace", faces: [face], distance: -1 },
    invalid: { ...base, type: "offsetFace", faces: [], distance: 1 },
    path: "/faces",
  },
  mirror: {
    valid: {
      ...base,
      type: "mirror",
      bodies: ["b1"],
      plane: { kind: "construction", featureId: "cp" },
      combine: true,
    },
    invalid: {
      ...base,
      type: "mirror",
      bodies: ["b1"],
      plane,
      combine: 1,
    },
    path: "/combine",
  },
  linearPattern: {
    valid: {
      ...base,
      type: "linearPattern",
      bodies: ["b1"],
      direction: { kind: "edge", edge },
      count: 3,
      spacing: -5,
      combine: false,
    },
    invalid: {
      ...base,
      type: "linearPattern",
      bodies: ["b1"],
      direction: { kind: "originAxis", axis: "X" },
      count: 3,
      spacing: 5,
      combine: false,
    },
    path: "/direction",
  },
  circularPattern: {
    valid: {
      ...base,
      type: "circularPattern",
      bodies: ["b1"],
      axis: { kind: "sketchLine", sketchId: "sk", entityId: "l1" },
      count: 2,
      totalAngle: 360,
      combine: true,
    },
    invalid: {
      ...base,
      type: "circularPattern",
      bodies: ["b1"],
      axis: { kind: "originAxis", axis: "Z" },
      count: 1,
      totalAngle: 360,
      combine: true,
    },
    path: "/count",
  },
  move: {
    valid: { ...base, type: "move", bodies: ["b1"], translation: [0, 0, 1] },
    invalid: { ...base, type: "move", bodies: ["b1"], translation: [0, 0] },
    path: "/translation",
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
