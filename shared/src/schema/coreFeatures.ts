import { Type, type TProperties, type TSchema } from "typebox";
import { blobHashSchema as blobHash } from "./assets.js";
import {
  CHAMFER_TYPES,
  FILLET_TYPES,
  SHELL_DIRECTIONS,
  THIN_LOCATIONS,
} from "../model.js";
import { ownedFields } from "./chamferFields.js";
import {
  axisRef,
  bodyIdSchema,
  bodyRef,
  edgeRef,
  faceRef,
  featureIdSchema,
  oneTargetForm,
  originAxis,
  planeRef,
  pointRef,
  profileRef,
  projectionRef,
  sketchEntityRef,
  toolTargets,
} from "./refs.js";
import { splineEntities } from "./splineEntity.js";
import { LINEAR_TOL } from "../tolerance.js";

export const MAX_DIM = 100_000;
export const NAME_LENGTH = 200;

export const featureNameSchema = Type.String({
  minLength: 1,
  maxLength: NAME_LENGTH,
});
const id = featureIdSchema;
const bodyId = bodyIdSchema;
const name = featureNameSchema;
const coordinate = Type.Number({
  minimum: -MAX_DIM,
  maximum: MAX_DIM,
  parameterUnit: "mm",
});
const flag = Type.Optional(Type.Boolean());

const operation = Type.Enum(["newBody", "join", "cut", "intersect"]);
const positive = Type.Number({
  minimum: LINEAR_TOL,
  maximum: MAX_DIM,
  parameterUnit: "mm",
});
const degrees = Type.Number({
  minimum: -360,
  maximum: 360,
  parameterUnit: "deg",
});
const taper = Type.Optional(
  Type.Number({
    exclusiveMinimum: -90,
    exclusiveMaximum: 90,
    parameterUnit: "deg",
  }),
);
const bodies = Type.Array(bodyId, { minItems: 1 });
const profiles = (minItems: number) => Type.Array(profileRef, { minItems });
const patternCount = Type.Number({ minimum: 2, parameterUnit: "unitless" });

const feature = <const T extends string, P extends TProperties>(
  type: T,
  properties: P,
) =>
  Type.Object({
    id,
    type: Type.Literal(type),
    name,
    suppressed: Type.Boolean(),
    ...properties,
  });

const toolFeature = <const T extends string, P extends TProperties>(
  type: T,
  properties: P,
) => oneTargetForm(feature(type, { ...properties, ...toolTargets }));

export const extensionFeatureSchema = <P extends TSchema>(
  type: string,
  version: number,
  params: P,
) => feature(type, { version: Type.Literal(version), params });

const entityBase = { id, construction: flag, external: flag };
const projected = { ...entityBase, projection: Type.Optional(projectionRef) };

const entity = Type.Union([
  Type.Object({
    ...entityBase,
    kind: Type.Literal("point"),
    x: coordinate,
    y: coordinate,
  }),
  Type.Object({ ...projected, kind: Type.Literal("line"), p1: id, p2: id }),
  Type.Object({
    ...projected,
    kind: Type.Literal("circle"),
    center: id,
    radius: Type.Number({ minimum: 0, maximum: MAX_DIM, parameterUnit: "mm" }),
  }),
  Type.Object({
    ...projected,
    kind: Type.Literal("arc"),
    center: id,
    start: id,
    end: id,
  }),
  Type.Object({
    ...projected,
    kind: Type.Literal("ellipse"),
    center: id,
    major: id,
    minor: id,
    start: Type.Optional(id),
    end: Type.Optional(id),
  }),
  ...splineEntities(projected, id),
]);

const constraint = <const T extends string, P extends TProperties>(
  type: T,
  properties: P,
) =>
  Type.Object({
    id,
    labelOffset: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
    type: Type.Literal(type),
    ...properties,
  });

const dimension = <const T extends string, P extends TProperties>(
  type: T,
  properties: P,
) =>
  constraint(type, {
    ...properties,
    driven: Type.Optional(Type.Literal(true)),
  });

const pair = { a: id, b: id };
const value = Type.Number({ parameterUnit: "mm" });

const sketchConstraint = Type.Union([
  constraint("coincident", pair),
  constraint("horizontal", { line: id }),
  constraint("vertical", { line: id }),
  constraint("parallel", pair),
  constraint("perpendicular", pair),
  constraint("tangent", pair),
  constraint("smooth", pair),
  constraint("concentric", pair),
  constraint("equal", pair),
  constraint("midpoint", { point: id, line: id }),
  constraint("collinear", pair),
  constraint("symmetric", { ...pair, line: id }),
  constraint("fix", { point: id }),
  constraint("pointOnLine", { point: id, line: id }),
  constraint("pointOnCircle", { point: id, circle: id }),
  dimension("distance", {
    ...pair,
    axis: Type.Union([Type.Literal("x"), Type.Literal("y"), Type.Null()]),
    value,
  }),
  dimension("length", { line: id, value }),
  dimension("pointLineDistance", { point: id, line: id, value }),
  dimension("lineDistance", { ...pair, value }),
  dimension("lineAngle", {
    line: id,
    axis: Type.Optional(Type.Literal("y")),
    value: Type.Number({
      exclusiveMinimum: -180,
      maximum: 180,
      parameterUnit: "deg",
    }),
  }),
  dimension("radius", { entity: id, value }),
  dimension("diameter", { entity: id, value }),
  dimension("angle", { ...pair, value: Type.Number({ parameterUnit: "deg" }) }),
]);

const entityIds = Type.Array(id, { minItems: 1, uniqueItems: true });

const sketch = feature("sketch", {
  plane: planeRef,
  entities: Type.Array(entity),
  constraints: Type.Array(sketchConstraint),
  offsets: Type.Optional(
    Type.Array(
      Type.Object({
        id,
        distance: coordinate,
        sourceIds: entityIds,
        entityIds,
        joinTolerance: Type.Number({
          minimum: 0,
          maximum: 1,
          parameterUnit: "mm",
        }),
      }),
    ),
  ),
});

const constructionPlane = feature("constructionPlane", {
  method: Type.Union([
    Type.Object({
      kind: Type.Literal("offset"),
      base: planeRef,
      distance: coordinate,
      flip: flag,
    }),
    Type.Object({
      kind: Type.Literal("midplane"),
      a: planeRef,
      b: planeRef,
      offset: Type.Optional(coordinate),
      flip: flag,
    }),
    Type.Object({
      kind: Type.Literal("angle"),
      axis: axisRef,
      base: planeRef,
      angle: degrees,
    }),
    Type.Object({
      kind: Type.Literal("threePoints"),
      points: Type.Tuple([pointRef, pointRef, pointRef]),
    }),
    Type.Object({ kind: Type.Literal("twoEdges"), a: axisRef, b: axisRef }),
  ]),
});

const referenceImage = feature("referenceImage", {
  plane: planeRef,
  assetId: Type.String(),
  fileName: Type.String(),
  transform: Type.Object({
    u: Type.Number({ parameterUnit: "mm" }),
    v: Type.Number({ parameterUnit: "mm" }),
    rotation: Type.Number({ parameterUnit: "deg" }),
    scale: Type.Number({
      minimum: 1e-9,
      maximum: MAX_DIM,
      parameterUnit: "mm",
    }),
  }),
  opacity: Type.Number({ minimum: 0, maximum: 1, parameterUnit: "unitless" }),
  width: Type.Number({ minimum: 1, maximum: 65536, parameterUnit: "unitless" }),
  height: Type.Number({
    minimum: 1,
    maximum: 65536,
    parameterUnit: "unitless",
  }),
});

const importFilename = Type.String({ minLength: 1, maxLength: 255 });

const importStep = feature("importStep", {
  filename: importFilename,
  format: Type.Optional(Type.Enum(["iges", "brep"])),
  blob: blobHash,
});

const importMesh = feature("importMesh", {
  filename: importFilename,
  format: Type.Enum(["stl", "obj", "3mf"]),
  blob: blobHash,
});

const emboss = toolFeature("emboss", {
  profiles: profiles(1),
  depth: positive,
  mode: Type.Enum(["emboss", "deboss"]),
});

const profileFaces = Type.Optional(Type.Array(faceRef));

const profilesOrFaces = <T extends TSchema>(schema: T) =>
  Type.Refine(
    schema,
    (f: { profiles: unknown[]; faces?: unknown[] }) =>
      f.profiles.length + (f.faces?.length ?? 0) >= 1,
    () => "needs a profile or face",
  );

const extrudeSource = <T extends TSchema>(schema: T) =>
  Type.Refine(
    Type.Refine(
      schema,
      (f: { profiles: unknown[]; faces?: unknown[]; curves?: unknown[] }) =>
        f.profiles.length + (f.faces?.length ?? 0) + (f.curves?.length ?? 0) >=
        1,
      () => "needs a profile, face or curve",
    ),
    (f: { curves?: unknown[]; thin?: unknown }) =>
      !f.curves?.length || f.thin !== undefined,
    () => "needs thin to extrude open curves",
  );

const extrude = extrudeSource(
  toolFeature("extrude", {
    profiles: profiles(0),
    faces: profileFaces,
    curves: Type.Optional(Type.Array(sketchEntityRef, { uniqueItems: true })),
    distance: Type.Refine(
      coordinate,
      (distance) => Math.abs(distance) >= LINEAR_TOL,
      () => "must be non-zero",
    ),
    distance2: Type.Optional(
      Type.Number({ minimum: 0, maximum: MAX_DIM, parameterUnit: "mm" }),
    ),
    startOffset: Type.Optional(coordinate),
    startObject: Type.Optional(planeRef),
    extent: Type.Optional(
      Type.Union([
        Type.Object({ kind: Type.Literal("all") }),
        Type.Object({
          kind: Type.Literal("toObject"),
          object: Type.Union([planeRef, bodyRef]),
        }),
      ]),
    ),
    taper,
    taper2: taper,
    thin: Type.Optional(
      Type.Object({
        location: Type.Enum([...THIN_LOCATIONS]),
        thickness: positive,
      }),
    ),
    direction: Type.Enum(["normal", "reverse", "symmetric", "twoSided"]),
    operation,
  }),
);

const revolve = profilesOrFaces(
  toolFeature("revolve", {
    profiles: profiles(0),
    faces: profileFaces,
    axis: axisRef,
    angle: degrees,
    operation,
  }),
);

const sweep = toolFeature("sweep", {
  profiles: profiles(1),
  pathSketchId: id,
  operation,
});

const loft = toolFeature("loft", {
  sections: Type.Array(Type.Union([profileRef, faceRef]), { minItems: 2 }),
  operation,
});

const picks = {
  edges: Type.Array(edgeRef),
  faces: profileFaces,
  features: Type.Optional(Type.Array(id)),
};
const rule = { betweenFaces: profileFaces, betweenFeatures: picks.features };
const picked = <T extends TSchema>(schema: T) =>
  Type.Refine(
    schema,
    (f: Partial<Record<keyof typeof picks, unknown[]>>) =>
      [f.edges, f.faces, f.features].some((list) => list?.length),
    () => "needs an edge, a face or a feature",
  );
const blend = <const T extends string, P extends TProperties>(
  type: T,
  properties: P,
) => picked(feature(type, { tangentChain: flag, ...picks, ...properties }));

const filletSet = Type.Object({ ...picks, ...rule, radius: positive });
const fillet = ownedFields(
  "fillet",
  blend("fillet", {
    filletType: Type.Enum([...FILLET_TYPES]),
    radius: positive,
    distance2: Type.Optional(positive),
    endRadius: Type.Optional(positive),
    flip: flag,
    ...rule,
    sets: Type.Optional(Type.Array(picked(filletSet))),
  }),
);

const chamfer = ownedFields(
  "chamfer",
  blend("chamfer", {
    chamferType: Type.Enum([...CHAMFER_TYPES]),
    distance: positive,
    distance2: Type.Optional(positive),
    angle: Type.Optional(
      Type.Number({
        exclusiveMinimum: 0,
        exclusiveMaximum: 90,
        parameterUnit: "deg",
      }),
    ),
    flip: flag,
  }),
);

const shell = Type.Refine(
  feature("shell", {
    openFaces: Type.Array(faceRef),
    body: Type.Optional(bodyId),
    direction: Type.Enum([...SHELL_DIRECTIONS]),
    thickness: positive,
    outsideThickness: Type.Optional(positive),
  }),
  (f: { direction: string; outsideThickness?: number }) =>
    (f.direction === "both") === (f.outsideThickness !== undefined),
  () => "needs an outside thickness exactly when both sides",
);

const combine = feature("combine", {
  operation: Type.Enum(["join", "cut", "intersect"]),
  targetBody: bodyId,
  toolBodies: bodies,
  keepTools: Type.Boolean(),
});

const splitBody = feature("splitBody", { body: bodyId, tool: planeRef });

const offsetFace = feature("offsetFace", {
  faces: Type.Array(faceRef, { minItems: 1 }),
  distance: coordinate,
});

const mirror = feature("mirror", {
  bodies,
  plane: planeRef,
  combine: Type.Boolean(),
});

const linearPattern = feature("linearPattern", {
  bodies,
  direction: Type.Union([
    Type.Object({ kind: Type.Literal("axis"), axis: originAxis }),
    Type.Object({ kind: Type.Literal("edge"), edge: edgeRef }),
  ]),
  count: patternCount,
  spacing: coordinate,
  combine: Type.Boolean(),
});

const circularPattern = feature("circularPattern", {
  bodies,
  axis: axisRef,
  count: patternCount,
  totalAngle: degrees,
  combine: Type.Boolean(),
});

const move = feature("move", {
  bodies,
  translation: Type.Tuple([coordinate, coordinate, coordinate]),
  axis: axisRef,
  angle: degrees,
  copy: Type.Boolean(),
});

export const FEATURE_SCHEMAS = {
  sketch,
  constructionPlane,
  referenceImage,
  importStep,
  importMesh,
  emboss,
  extrude,
  revolve,
  sweep,
  loft,
  fillet,
  chamfer,
  shell,
  combine,
  splitBody,
  offsetFace,
  mirror,
  linearPattern,
  circularPattern,
  move,
};
