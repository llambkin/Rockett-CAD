import { Type, type TProperties } from "typebox";
import { SCHEMA_VERSION } from "../model.js";
import { LINEAR_TOL } from "../tolerance.js";
import { UNIT_TO_MM, type Units } from "../units.js";

export const MAX_DIM = 100_000;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const id = Type.String({ minLength: 1, maxLength: 100 });
const bodyId = Type.String({ minLength: 1, maxLength: 200 });
const topoName = Type.String({ minLength: 1, maxLength: 2000 });
const coordinate = Type.Number({ minimum: -MAX_DIM, maximum: MAX_DIM });
const flag = Type.Optional(Type.Boolean());

export const faceRef = Type.Object({
  kind: Type.Literal("face"),
  bodyId,
  faceName: topoName,
});

export const edgeRef = Type.Object({
  kind: Type.Literal("edge"),
  bodyId,
  edgeName: topoName,
});

const planeRef = Type.Union([
  Type.Object({
    kind: Type.Literal("origin"),
    plane: Type.Enum(["XY", "XZ", "YZ"]),
  }),
  Type.Object({ kind: Type.Literal("construction"), featureId: id }),
  Type.Object({ kind: Type.Literal("face"), face: faceRef }),
]);

const axis = Type.Enum(["X", "Y", "Z"]);

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
const positive = Type.Number({ minimum: LINEAR_TOL, maximum: MAX_DIM });
const degrees = Type.Number({ minimum: -360, maximum: 360 });
const bodies = Type.Array(bodyId, { minItems: 1, maxItems: 64 });
const edges = Type.Array(edgeRef, { minItems: 1, maxItems: 256 });
const profiles = (minItems: number) =>
  Type.Array(profileRef, { minItems, maxItems: 64 });
const patternCount = Type.Number({ minimum: 2, maximum: 500 });

const feature = <const T extends string, P extends TProperties>(
  type: T,
  properties: P,
) =>
  Type.Object({
    id,
    type: Type.Literal(type),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    suppressed: Type.Boolean(),
    ...properties,
  });

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
    radius: Type.Number({ minimum: 0, maximum: MAX_DIM }),
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

const pair = { a: id, b: id };
const value = Type.Number();

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
  constraint("distance", {
    ...pair,
    axis: Type.Union([Type.Literal("x"), Type.Literal("y"), Type.Null()]),
    value,
  }),
  constraint("length", { line: id, value }),
  constraint("lineAngle", {
    line: id,
    value: Type.Number({ exclusiveMinimum: -180, maximum: 180 }),
  }),
  constraint("radius", { entity: id, value }),
  constraint("diameter", { entity: id, value }),
  constraint("angle", { ...pair, value }),
]);

const entityIds = Type.Array(id, {
  minItems: 1,
  maxItems: 5000,
  uniqueItems: true,
});

const sketch = feature("sketch", {
  plane: planeRef,
  entities: Type.Array(entity, { maxItems: 5000 }),
  constraints: Type.Array(sketchConstraint, { maxItems: 5000 }),
  offsets: Type.Optional(
    Type.Array(
      Type.Object({
        id,
        distance: coordinate,
        sourceIds: entityIds,
        entityIds,
        joinTolerance: Type.Number({ minimum: 0, maximum: 1 }),
      }),
      { maxItems: 1000 },
    ),
  ),
  visible: flag,
});

const constructionPlane = feature("constructionPlane", {
  method: Type.Union([
    Type.Object({
      kind: Type.Literal("offset"),
      base: planeRef,
      distance: coordinate,
    }),
    Type.Object({ kind: Type.Literal("midplane"), a: planeRef, b: planeRef }),
  ]),
});

const referenceImage = feature("referenceImage", {
  plane: planeRef,
  assetId: Type.String(),
  fileName: Type.String(),
  transform: Type.Object({
    u: Type.Number(),
    v: Type.Number(),
    rotation: Type.Number(),
    scale: Type.Number({ minimum: 1e-9, maximum: MAX_DIM }),
  }),
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  visible: Type.Boolean(),
  width: Type.Number({ minimum: 1, maximum: 65536 }),
  height: Type.Number({ minimum: 1, maximum: 65536 }),
});

const importStep = Type.Refine(
  feature("importStep", {
    filename: Type.String({ minLength: 1, maxLength: 255 }),
    format: Type.Optional(Type.Enum(["iges", "brep"])),
    data: Type.String({ maxLength: MAX_IMPORT_BYTES }),
  }),
  (f) =>
    f.format !== undefined || f.data.trimStart().startsWith("ISO-10303-21;"),
  () => "needs STEP data unless format is iges or brep",
);

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
});

const extrude = Type.Refine(
  feature("extrude", {
    profiles: profiles(0),
    faces: Type.Optional(Type.Array(faceRef, { maxItems: 64 })),
    distance: Type.Refine(
      coordinate,
      (distance) => Math.abs(distance) >= LINEAR_TOL,
      () => "must be non-zero",
    ),
    distance2: Type.Optional(Type.Number({ minimum: 0, maximum: MAX_DIM })),
    startOffset: Type.Optional(coordinate),
    direction: Type.Enum(["normal", "reverse", "symmetric", "twoSided"]),
    operation,
  }),
  (f) => {
    const sources = f.profiles.length + (f.faces?.length ?? 0);
    return sources >= 1 && sources <= 64;
  },
  () => "needs 1 to 64 profiles or faces",
);

const revolve = feature("revolve", {
  profiles: profiles(1),
  axis: axisRef,
  angle: degrees,
  operation,
});

const sweep = feature("sweep", {
  profiles: profiles(1),
  pathSketchId: id,
  operation,
});

const loft = feature("loft", { sections: profiles(2), operation });

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
  openFaces: Type.Array(faceRef, { maxItems: 256 }),
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
  faces: Type.Array(faceRef, { minItems: 1, maxItems: 256 }),
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

const vector = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);
const text = Type.String({ minLength: 1, maxLength: 200 });

export const documentSchema = Type.Refine(
  Type.Object({
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    id,
    name: text,
    units: Type.Enum(Object.keys(UNIT_TO_MM) as Units[]),
    createdAt: text,
    modifiedAt: text,
    features: Type.Array(Type.Unknown(), { maxItems: 2000 }),
    timelinePosition: Type.Integer({ minimum: 0 }),
    bodyMeta: Type.Record(
      Type.String(),
      Type.Object({ name: Type.String(), visible: Type.Boolean() }),
    ),
    counters: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    camera: Type.Optional(
      Type.Object({
        position: vector,
        target: vector,
        up: vector,
        projection: Type.Enum(["orthographic", "perspective"]),
      }),
    ),
  }),
  (doc) => doc.timelinePosition <= doc.features.length,
  () => "has timelinePosition past the last feature",
);
