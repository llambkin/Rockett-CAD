import { Type, type TProperties, type TSchema } from "typebox";
import { ORIGIN_AXES, REF_SIGNATURE_TYPES } from "../model.js";
import { LINEAR_TOL } from "../tolerance.js";
import { MB } from "../units.js";

export const MAX_DIM = 100_000;
export const MAX_IMPORT_BYTES = 10 * MB;
export const MAX_TARGETS = 10_000;
export const NAME_LENGTH = 200;

export const featureIdSchema = Type.String({ minLength: 1, maxLength: 100 });
export const bodyIdSchema = Type.String({ minLength: 1 });
const topoName = Type.String({ minLength: 1 });
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

export const vec3 = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);

const sig = Type.Optional(
  Type.Object({
    type: Type.Enum([...REF_SIGNATURE_TYPES]),
    point: vec3,
    direction: vec3,
  }),
);

export const faceRef = Type.Object({
  kind: Type.Literal("face"),
  bodyId,
  faceName: topoName,
  sig,
});

export const edgeRef = Type.Object({
  kind: Type.Literal("edge"),
  bodyId,
  edgeName: topoName,
  sig,
});

const pointRef = Type.Union([
  Type.Object({ kind: Type.Literal("vertex"), bodyId, vertexName: topoName }),
  Type.Object({
    kind: Type.Literal("sketchPoint"),
    sketchId: id,
    entityId: id,
  }),
]);

const planeRef = Type.Union([
  Type.Object({
    kind: Type.Literal("origin"),
    plane: Type.Enum(["XY", "XZ", "YZ"]),
  }),
  Type.Object({ kind: Type.Literal("construction"), featureId: id }),
  Type.Object({ kind: Type.Literal("face"), face: faceRef }),
]);

const axis = Type.Enum([...ORIGIN_AXES]);

const axisRef = Type.Union([
  Type.Object({ kind: Type.Literal("originAxis"), axis }),
  Type.Object({ kind: Type.Literal("sketchLine"), sketchId: id, entityId: id }),
  Type.Object({ kind: Type.Literal("edge"), edge: edgeRef }),
]);

const profileRef = Type.Object({
  sketchId: id,
  profileId: Type.String({ minLength: 1, maxLength: 200 }),
});

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
const bodies = Type.Array(bodyId, { minItems: 1 });
const targets = Type.Optional(
  Type.Array(bodyId, { maxItems: MAX_TARGETS, uniqueItems: true }),
);
const edges = Type.Array(edgeRef, { minItems: 1 });
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

export const extensionFeatureSchema = <P extends TSchema>(
  type: string,
  version: number,
  params: P,
) => feature(type, { version: Type.Literal(version), params });

const entityBase = { id, construction: flag, external: flag };
const projected = { ...entityBase, projection: Type.Optional(edgeRef) };

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
  constraint("concentric", pair),
  constraint("equal", pair),
  constraint("midpoint", { point: id, line: id }),
  constraint("collinear", pair),
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

const importStep = feature("importStep", {
  filename: Type.String({ minLength: 1, maxLength: 255 }),
  format: Type.Optional(Type.Enum(["iges", "brep"])),
  blob: Type.String({ pattern: "^[0-9a-f]{64}$" }),
});

const importMesh = feature("importMesh", {
  filename: Type.String({ minLength: 1, maxLength: 255 }),
  format: Type.Enum(["stl", "obj", "3mf"]),
  data: Type.String({
    maxLength: Math.ceil(MAX_IMPORT_BYTES / 3) * 4,
    pattern: "^[A-Za-z0-9+/]*={0,2}$",
  }),
});

const emboss = feature("emboss", {
  profiles: profiles(1),
  depth: positive,
  mode: Type.Enum(["emboss", "deboss"]),
  targets,
});

const profileFaces = Type.Optional(Type.Array(faceRef));

const profilesOrFaces = <T extends TSchema>(schema: T) =>
  Type.Refine(
    schema,
    (f: { profiles: unknown[]; faces?: unknown[] }) =>
      f.profiles.length + (f.faces?.length ?? 0) >= 1,
    () => "needs a profile or face",
  );

const extrude = profilesOrFaces(
  feature("extrude", {
    profiles: profiles(0),
    faces: profileFaces,
    distance: Type.Refine(
      coordinate,
      (distance) => Math.abs(distance) >= LINEAR_TOL,
      () => "must be non-zero",
    ),
    distance2: Type.Optional(
      Type.Number({ minimum: 0, maximum: MAX_DIM, parameterUnit: "mm" }),
    ),
    startOffset: Type.Optional(coordinate),
    direction: Type.Enum(["normal", "reverse", "symmetric", "twoSided"]),
    operation,
    targets,
  }),
);

const revolve = profilesOrFaces(
  feature("revolve", {
    profiles: profiles(0),
    faces: profileFaces,
    axis: axisRef,
    angle: degrees,
    operation,
    targets,
  }),
);

const sweep = feature("sweep", {
  profiles: profiles(1),
  pathSketchId: id,
  operation,
  targets,
});

const loft = feature("loft", {
  sections: Type.Array(Type.Union([profileRef, faceRef]), { minItems: 2 }),
  operation,
  targets,
});

const fillet = feature("fillet", {
  tangentChain: flag,
  edges,
  radius: positive,
});

const chamfer = feature("chamfer", {
  tangentChain: flag,
  edges,
  distance: positive,
});

const shell = feature("shell", {
  openFaces: Type.Array(faceRef),
  body: Type.Optional(bodyId),
  thickness: positive,
});

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
    Type.Object({ kind: Type.Literal("axis"), axis }),
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
