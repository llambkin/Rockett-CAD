import { describe, expect, it } from "vitest";
import {
  FEATURE_SCHEMAS,
  featureRefs,
  featureSpec,
  featureSpecs,
  registerFeatureSpec,
  ValidationError,
  type AxisRef,
  type EdgeRef,
  type FaceRef,
  type Feature,
  type FeatureRef,
  type FeatureType,
  type PlaneRef,
  type PointRef,
  type ProfileRef,
  type ShellFeature,
  type SketchEntity,
} from "../src/index.js";

const face = (faceName: string): FaceRef => ({
  kind: "face",
  bodyId: "body-1",
  faceName,
});

const shell: ShellFeature = {
  id: "f1",
  type: "shell",
  name: "Shell1",
  suppressed: false,
  openFaces: [face("F1"), face("F2")],
  direction: "inside",
  thickness: 1,
};

describe("shell feature spec", () => {
  it("is registered with the shell schema", () => {
    const spec = featureSpec("shell");
    expect(spec).toMatchObject({
      type: "shell",
      label: "Shell",
      producesGeometry: true,
      version: 1,
      displayOnly: [],
    });
    expect(spec?.paramsSchema).toBe(FEATURE_SCHEMAS.shell);
  });

  it("accepts a valid shell", () => {
    expect(() => featureSpec("shell")?.validate(shell)).not.toThrow();
    expect(() =>
      featureSpec("shell")?.validate({ ...shell, openFaces: [] }),
    ).not.toThrow();
  });

  it("rejects an invalid shell with the path", () => {
    const bad = { ...shell, thickness: 0 };
    const thrown = (() => {
      try {
        featureSpec("shell")?.validate(bad);
      } catch (e) {
        return e;
      }
    })();
    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown).toMatchObject({ detail: "/thickness" });
    expect(() =>
      featureSpec("shell")?.validate({ ...shell, openFaces: [null] } as never),
    ).toThrow(/^openFaces\.0 /);
  });

  it("lists every open face with its param path", () => {
    expect(featureRefs(shell)).toEqual([
      { kind: "face", path: "/openFaces/0", face: face("F1") },
      { kind: "face", path: "/openFaces/1", face: face("F2") },
    ]);
    expect(featureRefs({ ...shell, openFaces: [] })).toEqual([]);
  });
});

describe("feature spec registry", () => {
  const spec = featureSpec("shell")!;

  it("throws on a duplicate id and stays unchanged", () => {
    const before = featureSpecs.snapshot();
    expect(() => registerFeatureSpec({ ...spec })).toThrow(
      "feature spec registry already has shell",
    );
    expect(featureSpecs.snapshot()).toBe(before);
    expect(featureSpec("shell")).toBe(spec);
  });

  it("disposes exactly the registration that returned the disposer", () => {
    const calls: number[] = [];
    const unsubscribe = featureSpecs.subscribe(() => calls.push(1));
    const before = featureSpecs.snapshot();
    const first = { ...spec, type: "test.block" };
    const dispose = registerFeatureSpec(first);
    expect(featureSpec("test.block")).toBe(first);
    expect(featureSpecs.list().at(-1)).toBe(first);
    expect(featureSpecs.snapshot()).not.toBe(before);
    dispose();
    expect(featureSpec("test.block")).toBeUndefined();
    expect(featureSpecs.list()).toEqual(before);
    const second = { ...spec, type: "test.block" };
    const disposeSecond = registerFeatureSpec(second);
    const stable = featureSpecs.snapshot();
    dispose();
    expect(featureSpec("test.block")).toBe(second);
    expect(featureSpecs.snapshot()).toBe(stable);
    disposeSecond();
    const again = registerFeatureSpec(first);
    dispose();
    expect(featureSpec("test.block")).toBe(first);
    again();
    unsubscribe();
    registerFeatureSpec(first)();
    expect(calls).toHaveLength(6);
  });
});

const meta = { id: "f1", name: "F1", suppressed: false };
const refFace = (faceName: string): FaceRef => ({
  kind: "face",
  bodyId: "ref:body",
  faceName: `ref:${faceName}`,
});
const refEdge = (edgeName: string): EdgeRef => ({
  kind: "edge",
  bodyId: "ref:body",
  edgeName: `ref:${edgeName}`,
});
const refProfile = (profileId: string): ProfileRef => ({
  sketchId: "ref:sketch",
  profileId: `ref:${profileId}`,
});

const planes: PlaneRef[] = [
  { kind: "origin", plane: "XZ" },
  { kind: "construction", featureId: "ref:plane" },
  { kind: "face", face: refFace("F9") },
];

const axes: AxisRef[] = [
  { kind: "originAxis", axis: "Z" },
  { kind: "sketchLine", sketchId: "ref:axisSketch", entityId: "ref:l1" },
  { kind: "edge", edge: refEdge("E1") },
];

const sketchEntities: SketchEntity[] = [
  { id: "p1", kind: "point", x: 0, y: 0 },
  { id: "p2", kind: "point", x: 10, y: 0, external: true },
  { id: "l1", kind: "line", p1: "p1", p2: "p2" },
  {
    id: "l2",
    kind: "line",
    p1: "p1",
    p2: "p2",
    external: true,
    projection: refEdge("E1"),
  },
  {
    id: "c2",
    kind: "circle",
    center: "p1",
    radius: 3,
    external: true,
    projection: refEdge("E2"),
  },
  { id: "l3", kind: "line", p1: "p2", p2: "p1" },
];

interface SpecCase {
  producesGeometry: boolean;
  valid: Feature[];
  invalid: [Feature, string, string | undefined][];
  refsOnly?: Feature[];
}

const cases: Record<string, SpecCase> = {
  extrude: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1"), refProfile("p2")],
        faces: [refFace("F1")],
        distance: 5,
        distance2: 2,
        startOffset: 1,
        direction: "twoSided",
        operation: "join",
        targets: ["ref:b1", "ref:b2"],
      },
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1")],
        distance: 5,
        direction: "normal",
        operation: "cut",
        autoTargets: { exclude: ["ref:b1"], features: ["ref:f1"] },
      },
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1")],
        distance: 5,
        extent: {
          kind: "toObject",
          object: { kind: "face", face: refFace("F2") },
        },
        direction: "normal",
        operation: "join",
      },
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1")],
        distance: 5,
        extent: {
          kind: "toObject",
          object: { kind: "body", bodyId: "ref:b3" },
        },
        direction: "normal",
        operation: "cut",
      },
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1")],
        distance: 5,
        extent: { kind: "all" },
        direction: "symmetric",
        operation: "cut",
      },
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1")],
        distance: 5,
        startObject: { kind: "construction", featureId: "ref:plane" },
        extent: {
          kind: "toObject",
          object: { kind: "face", face: refFace("F2") },
        },
        direction: "normal",
        operation: "join",
      },
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1")],
        distance: 5,
        distance2: 2,
        taper: -5,
        taper2: 3,
        direction: "twoSided",
        operation: "newBody",
      },
      {
        ...meta,
        type: "extrude",
        profiles: [],
        curves: [
          { kind: "sketchEntity", sketchId: "ref:sketch", entityId: "l1" },
        ],
        distance: 5,
        thin: { location: "centre", thickness: 1 },
        direction: "normal",
        operation: "newBody",
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "extrude",
          profiles: [],
          curves: [{ kind: "sketchEntity", sketchId: "s1", entityId: "l1" }],
          distance: 5,
          direction: "normal",
          operation: "newBody",
        },
        "request needs thin to extrude open curves",
        "",
      ],
      [
        {
          ...meta,
          type: "extrude",
          profiles: [refProfile("p1")],
          distance: 5,
          thin: { location: "inside", thickness: 0 },
          direction: "normal",
          operation: "newBody",
        },
        "thin.thickness must be >= 0.000001",
        "/thin/thickness",
      ],
      [
        {
          ...meta,
          type: "extrude",
          profiles: [refProfile("p1")],
          distance: 0,
          direction: "normal",
          operation: "newBody",
        },
        "distance must be non-zero",
        "/distance",
      ],
      [
        {
          ...meta,
          type: "extrude",
          profiles: [refProfile("p1")],
          distance: 5,
          taper: 90,
          direction: "normal",
          operation: "newBody",
        },
        "taper must be < 90",
        "/taper",
      ],
    ],
  },
  revolve: {
    producesGeometry: true,
    valid: [
      ...axes.map((axis): Feature => ({
        ...meta,
        type: "revolve",
        profiles: [refProfile("p1")],
        faces: [refFace("F1")],
        axis,
        angle: 90,
        operation: "cut",
        targets: ["ref:b1"],
      })),
      {
        ...meta,
        type: "revolve",
        profiles: [refProfile("p1")],
        axis: axes[0]!,
        angle: 90,
        operation: "intersect",
        autoTargets: { exclude: ["ref:b1"], features: ["ref:f1"] },
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "revolve",
          profiles: [refProfile("p1")],
          axis: { kind: "originAxis", axis: "Z" },
          angle: 1e12,
          operation: "newBody",
        },
        "angle must be <= 360",
        "/angle",
      ],
    ],
  },
  emboss: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "emboss",
        profiles: [refProfile("p1"), refProfile("p2")],
        depth: 1,
        mode: "deboss",
        targets: ["ref:b1"],
      },
      {
        ...meta,
        type: "emboss",
        profiles: [refProfile("p1")],
        depth: 1,
        mode: "emboss",
        autoTargets: { exclude: ["ref:b1"], features: ["ref:f1"] },
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "emboss",
          profiles: [refProfile("p1")],
          depth: 0,
          mode: "emboss",
        },
        "depth must be >= 0.000001",
        "/depth",
      ],
    ],
  },
  sweep: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "sweep",
        profiles: [refProfile("p1"), refProfile("p2")],
        pathSketchId: "ref:path",
        operation: "join",
        targets: ["ref:b1"],
      },
      {
        ...meta,
        type: "sweep",
        profiles: [refProfile("p1")],
        pathSketchId: "ref:path",
        operation: "cut",
        autoTargets: { exclude: ["ref:b1"], features: ["ref:f1"] },
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "sweep",
          profiles: [refProfile("p1")],
          pathSketchId: null as never,
          operation: "newBody",
        },
        "pathSketchId must be string",
        "/pathSketchId",
      ],
    ],
  },
  loft: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "loft",
        sections: [refProfile("p1"), refProfile("p2")],
        operation: "newBody",
        targets: ["ref:b1"],
      },
      {
        ...meta,
        type: "loft",
        sections: [refProfile("p1"), refProfile("p2")],
        operation: "join",
        autoTargets: { exclude: ["ref:b1"], features: ["ref:f1"] },
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "loft",
          sections: [refProfile("p1")],
          operation: "newBody",
        },
        "sections must not have fewer than 2 items",
        "/sections",
      ],
    ],
    refsOnly: [
      {
        ...meta,
        type: "loft",
        sections: [
          refProfile("p1"),
          { sketchId: "ref:whole" } as ProfileRef,
          refProfile("p3"),
        ],
        operation: "newBody",
        targets: ["ref:b1"],
      },
    ],
  },
  fillet: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "fillet",
        filletType: "equalDistance",
        tangentChain: true,
        edges: [refEdge("E1"), refEdge("E2")],
        radius: 1,
      },
      {
        ...meta,
        type: "fillet",
        filletType: "equalDistance",
        edges: [],
        faces: [refFace("F1")],
        features: ["ref:extrude"],
        radius: 1,
      },
      {
        ...meta,
        type: "fillet",
        filletType: "twoDistances",
        edges: [refEdge("E1")],
        radius: 1,
        distance2: 2,
        flip: true,
      },
      {
        ...meta,
        type: "fillet",
        filletType: "equalDistance",
        edges: [refEdge("E1")],
        radius: 1,
        sets: [
          { edges: [refEdge("E2")], radius: 3 },
          {
            edges: [],
            faces: [refFace("F1")],
            features: ["ref:extrude"],
            radius: 2,
          },
          {
            edges: [],
            faces: [refFace("F1")],
            betweenFaces: [refFace("F2")],
            betweenFeatures: ["ref:extrude"],
            radius: 2,
          },
        ],
      },
      {
        ...meta,
        type: "fillet",
        filletType: "variableRadius",
        edges: [],
        faces: [refFace("F1")],
        betweenFaces: [refFace("F2")],
        betweenFeatures: ["ref:extrude"],
        radius: 1,
        endRadius: 3,
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "fillet",
          filletType: "equalDistance",
          edges: [refEdge("E1")],
          radius: 0,
        },
        "radius must be >= 0.000001",
        "/radius",
      ],
      [
        {
          ...meta,
          type: "fillet",
          filletType: "equalDistance",
          edges: [refEdge("E1")],
          radius: 1,
          distance2: 2,
        },
        "request needs a second distance and a flip exactly for two distances, an end radius exactly for a variable radius, and several sets only for equal distance",
        "",
      ],
      [
        {
          ...meta,
          type: "fillet",
          filletType: "twoDistances",
          edges: [refEdge("E1")],
          radius: 1,
          distance2: 2,
        },
        "request needs a second distance and a flip exactly for two distances, an end radius exactly for a variable radius, and several sets only for equal distance",
        "",
      ],
      [
        {
          ...meta,
          type: "fillet",
          filletType: "twoDistances",
          edges: [refEdge("E1")],
          radius: 1,
          distance2: 2,
          flip: false,
          sets: [{ edges: [refEdge("E2")], radius: 3 }],
        },
        "request needs a second distance and a flip exactly for two distances, an end radius exactly for a variable radius, and several sets only for equal distance",
        "",
      ],
      [
        {
          ...meta,
          type: "fillet",
          filletType: "equalDistance",
          edges: [refEdge("E1")],
          radius: 1,
          sets: [{ edges: [], radius: 3 }],
        },
        "sets.0 needs an edge, a face or a feature",
        "/sets/0",
      ],
      [
        {
          ...meta,
          type: "fillet",
          filletType: "variableRadius",
          edges: [refEdge("E1")],
          radius: 1,
        },
        "request needs a second distance and a flip exactly for two distances, an end radius exactly for a variable radius, and several sets only for equal distance",
        "",
      ],
      [
        {
          ...meta,
          type: "fillet",
          filletType: "equalDistance",
          edges: [],
          betweenFaces: [refFace("F2")],
          radius: 1,
        },
        "request needs an edge, a face or a feature",
        "",
      ],
    ],
  },
  chamfer: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "chamfer",
        chamferType: "equalDistance",
        tangentChain: false,
        edges: [refEdge("E1"), refEdge("E2")],
        distance: 1,
      },
      {
        ...meta,
        type: "chamfer",
        chamferType: "twoDistances",
        edges: [refEdge("E1")],
        distance: 1,
        distance2: 2,
        flip: true,
      },
      {
        ...meta,
        type: "chamfer",
        chamferType: "distanceAngle",
        edges: [refEdge("E1")],
        distance: 1,
        angle: 30,
        flip: false,
      },
      {
        ...meta,
        type: "chamfer",
        chamferType: "equalDistance",
        edges: [refEdge("E1")],
        faces: [refFace("F1")],
        features: ["ref:extrude"],
        distance: 1,
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "chamfer",
          chamferType: "equalDistance",
          edges: [],
          faces: [],
          features: [],
          distance: 1,
        },
        "request needs an edge, a face or a feature",
        "",
      ],
    ],
  },
  offsetFace: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "offsetFace",
        faces: [refFace("F1"), refFace("F2")],
        distance: -1,
      },
    ],
    invalid: [
      [
        { ...meta, type: "offsetFace", faces: [], distance: 1 },
        "faces must not have fewer than 1 items",
        "/faces",
      ],
    ],
  },
  combine: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "combine",
        operation: "cut",
        targetBody: "ref:target",
        toolBodies: ["ref:t1", "ref:t2"],
        keepTools: true,
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "combine",
          operation: "join",
          targetBody: "b1",
          toolBodies: [],
          keepTools: false,
        },
        "toolBodies must not have fewer than 1 items",
        "/toolBodies",
      ],
    ],
  },
  splitBody: {
    producesGeometry: true,
    valid: planes.map((tool) => ({
      ...meta,
      type: "splitBody",
      body: "ref:b1",
      tool,
    })),
    invalid: [
      [
        { ...meta, type: "splitBody", body: "b1", tool: null as never },
        "tool must match a schema in anyOf",
        "/tool",
      ],
    ],
  },
  move: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "move",
        bodies: ["ref:b1", "ref:b2"],
        translation: [1, 2, 3],
        axis: { kind: "originAxis", axis: "Z" },
        angle: 0,
        copy: false,
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "move",
          bodies: ["b1"],
          translation: [1e12, 0, 0],
          axis: { kind: "originAxis", axis: "Z" },
          angle: 0,
          copy: false,
        },
        "translation.0 must be <= 100000",
        "/translation/0",
      ],
    ],
  },
  mirror: {
    producesGeometry: true,
    valid: planes.map((plane) => ({
      ...meta,
      type: "mirror",
      bodies: ["ref:b1", "ref:b2"],
      plane,
      combine: true,
    })),
    invalid: [
      [
        {
          ...meta,
          type: "mirror",
          bodies: [],
          plane: planes[0]!,
          combine: false,
        },
        "bodies must not have fewer than 1 items",
        "/bodies",
      ],
    ],
  },
  linearPattern: {
    producesGeometry: true,
    valid: (
      [
        { kind: "axis", axis: "X" },
        { kind: "edge", edge: refEdge("E1") },
      ] as const
    ).map((direction) => ({
      ...meta,
      type: "linearPattern",
      bodies: ["ref:b1", "ref:b2"],
      direction,
      count: 3,
      spacing: 5,
      combine: false,
    })),
    invalid: [
      [
        {
          ...meta,
          type: "linearPattern",
          bodies: ["b1"],
          direction: { kind: "axis", axis: "X" },
          count: 0,
          spacing: 5,
          combine: false,
        },
        "count must be >= 2",
        "/count",
      ],
    ],
  },
  circularPattern: {
    producesGeometry: true,
    valid: axes.map((axis) => ({
      ...meta,
      type: "circularPattern",
      bodies: ["ref:b1", "ref:b2"],
      axis,
      count: 4,
      totalAngle: 360,
      combine: true,
    })),
    invalid: [
      [
        {
          ...meta,
          type: "circularPattern",
          bodies: ["b1"],
          axis: axes[0]!,
          count: 4,
          totalAngle: 400,
          combine: false,
        },
        "totalAngle must be <= 360",
        "/totalAngle",
      ],
    ],
  },
  constructionPlane: {
    producesGeometry: false,
    valid: [
      ...planes.map((base) => ({
        kind: "offset" as const,
        base,
        distance: 5,
        flip: true,
      })),
      {
        kind: "midplane" as const,
        a: planes[1]!,
        b: planes[2]!,
        offset: 2,
        flip: false,
      },
      ...axes.map((axis) => ({
        kind: "angle" as const,
        axis,
        base: planes[1]!,
        angle: 30,
      })),
      {
        kind: "threePoints" as const,
        points: [
          { kind: "vertex", bodyId: "ref:body", vertexName: "ref:V1" },
          { kind: "sketchPoint", sketchId: "ref:sketch", entityId: "ref:p1" },
          { kind: "vertex", bodyId: "ref:body", vertexName: "ref:V2" },
        ] as [PointRef, PointRef, PointRef],
      },
      { kind: "twoEdges" as const, a: axes[2]!, b: axes[1]! },
    ].map((method) => ({ ...meta, type: "constructionPlane", method })),
    invalid: [
      [
        {
          ...meta,
          type: "constructionPlane",
          method: { kind: "offset", base: planes[0]!, distance: 1e12 },
        },
        "method.distance must be <= 100000",
        "/method/distance",
      ],
    ],
  },
  referenceImage: {
    producesGeometry: false,
    valid: planes.map((plane) => ({
      ...meta,
      type: "referenceImage",
      plane,
      assetId: "a".repeat(64),
      fileName: "photo.png",
      transform: { u: 1, v: 2, rotation: 15, scale: 0.1 },
      opacity: 0.5,
      width: 640,
      height: 480,
    })),
    invalid: [
      [
        {
          ...meta,
          type: "referenceImage",
          plane: planes[0]!,
          assetId: "a".repeat(64),
          fileName: "photo.png",
          transform: { u: 0, v: 0, rotation: 0, scale: 1 },
          opacity: 1e12,
          width: 640,
          height: 480,
        },
        "opacity must be <= 1",
        "/opacity",
      ],
    ],
  },
  sketch: {
    producesGeometry: false,
    valid: planes.map((plane) => ({
      ...meta,
      type: "sketch",
      plane,
      entities: sketchEntities,
      constraints: [{ id: "c1", type: "length", line: "l1", value: 10 }],
      offsets: [
        {
          id: "o1",
          distance: 1,
          sourceIds: ["l1"],
          entityIds: ["l3"],
          joinTolerance: 0,
        },
      ],
    })),
    invalid: [
      [
        {
          ...meta,
          type: "sketch",
          plane: null as never,
          entities: [],
          constraints: [],
        },
        "plane must match a schema in anyOf",
        "/plane",
      ],
      [
        {
          ...meta,
          type: "sketch",
          plane: planes[0]!,
          entities: [sketchEntities[0]!, sketchEntities[0]!],
          constraints: [],
        },
        "duplicate sketch entity ID",
        undefined,
      ],
      [
        {
          ...meta,
          type: "sketch",
          plane: planes[0]!,
          entities: sketchEntities,
          constraints: [],
          offsets: [
            {
              id: "o1",
              distance: 0,
              sourceIds: ["l1"],
              entityIds: ["l3"],
              joinTolerance: 0,
            },
          ],
        },
        "offset distance must be non-zero",
        undefined,
      ],
    ],
  },
  importStep: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "importStep",
        filename: "part.brep",
        format: "brep",
        blob: "0".repeat(64),
      },
    ],
    invalid: [
      [
        { ...meta, type: "importStep", filename: "part.step", blob: "x" },
        'blob must match pattern "^[0-9a-f]{64}$"',
        "/blob",
      ],
    ],
  },
  importMesh: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "importMesh",
        filename: "part.stl",
        format: "stl",
        blob: "0".repeat(64),
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "importMesh",
          filename: "part.stl",
          format: "stl",
          blob: "x",
        },
        'blob must match pattern "^[0-9a-f]{64}$"',
        "/blob",
      ],
    ],
  },
};

const valueAt = (f: Feature, path: string) =>
  path
    .split("/")
    .slice(1)
    .reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], f);

const markedPaths = (v: unknown, at = ""): string[] =>
  typeof v === "string"
    ? v.startsWith("ref:")
      ? [at]
      : []
    : typeof v === "object" && v !== null
      ? Object.entries(v).flatMap(([key, child]) =>
          markedPaths(child, `${at}/${key}`),
        )
      : [];

const target = (ref: FeatureRef) =>
  (ref as unknown as Record<string, unknown>)[ref.kind];

const LABELS: Record<FeatureType, string> = {
  importStep: "Import STEP",
  importMesh: "Import mesh",
  sketch: "Sketch",
  extrude: "Extrude",
  revolve: "Revolve",
  sweep: "Sweep",
  loft: "Loft",
  fillet: "Fillet",
  chamfer: "Chamfer",
  shell: "Shell",
  combine: "Combine",
  splitBody: "SplitBody",
  offsetFace: "OffsetFace",
  mirror: "Mirror",
  linearPattern: "LinearPattern",
  circularPattern: "CircularPattern",
  constructionPlane: "Plane",
  referenceImage: "Canvas",
  emboss: "Emboss",
  move: "Move",
};

describe.each(Object.entries(cases))("%s feature spec", (type, specCase) => {
  const spec = featureSpec(type)!;

  it("is registered with its schema and label", () => {
    expect(spec).toMatchObject({
      type,
      label: LABELS[type as FeatureType],
      producesGeometry: specCase.producesGeometry,
      version: 1,
      displayOnly: [],
    });
    expect(spec.paramsSchema).toBe(FEATURE_SCHEMAS[type as FeatureType]);
  });

  it("accepts valid features", () => {
    for (const f of specCase.valid)
      expect(() => spec.validate(f)).not.toThrow();
  });

  it("rejects invalid features with the message and path", () => {
    for (const [f, message, detail] of specCase.invalid) {
      expect(() => spec.validate(f)).toThrow(ValidationError);
      expect(() => spec.validate(f)).toThrow(
        expect.objectContaining({ message, detail }),
      );
    }
  });

  it("lists every reference with its param path", () => {
    const features = [...specCase.valid, ...(specCase.refsOnly ?? [])];
    const properties = Object.keys(spec.paramsSchema.properties);
    expect(properties.filter((key) => !features.some((f) => key in f))).toEqual(
      [],
    );
    for (const f of features) {
      const refs = featureRefs(f);
      for (const ref of refs) expect(valueAt(f, ref.path)).toEqual(target(ref));
      const missed = markedPaths(f).filter(
        (path) =>
          refs.filter(
            (ref) => path === ref.path || path.startsWith(`${ref.path}/`),
          ).length !== 1,
      );
      expect(missed).toEqual([]);
    }
  });
});

it("lists a loft section without a profile id as its whole sketch", () => {
  const refs = featureRefs(cases.loft!.refsOnly![0]!);
  expect(refs.map((ref) => [ref.kind, ref.path])).toEqual([
    ["profile", "/sections/0"],
    ["sketch", "/sections/1/sketchId"],
    ["profile", "/sections/2"],
    ["body", "/targets/0"],
  ]);
});
