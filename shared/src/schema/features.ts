import { Type, type TProperties, type TSchema } from "typebox";
import { ORIGIN_AXES, REF_SIGNATURE_TYPES, SCHEMA_VERSION } from "../model.js";
import { LINEAR_TOL } from "../tolerance.js";
import { MB } from "../units.js";

export const MAX_DIM = 100_000;
export const MAX_IMPORT_BYTES = 10 * MB;
export const MAX_TARGETS = 10_000;
export const NAME_LENGTH = 200;

const id = Type.String({ minLength: 1, maxLength: 100 });
const bodyId = Type.String({ minLength: 1, maxLength: 200 });
const topoName = Type.String({ minLength: 1, maxLength: 2000 });
const name = Type.String({ minLength: 1, maxLength: NAME_LENGTH });
const coordinate = Type.Number({ minimum: -MAX_DIM, maximum: MAX_DIM });
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
const positive = Type.Number({ minimum: LINEAR_TOL, maximum: MAX_DIM });
const degrees = Type.Number({ minimum: -360, maximum: 360 });
const bodies = Type.Array(bodyId, { minItems: 1 });
const targets = Type.Optional(
  Type.Array(bodyId, { maxItems: MAX_TARGETS, uniqueItems: true }),
);
const edges = Type.Array(edgeRef, { minItems: 1 });
const profiles = (minItems: number) => Type.Array(profileRef, { minItems });
const patternCount = Type.Number({ minimum: 2 });

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
  constraint("pointLineDistance", { point: id, line: id, value }),
  constraint("lineDistance", { ...pair, value }),
  constraint("lineAngle", {
    line: id,
    axis: Type.Optional(Type.Literal("y")),
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
    u: Type.Number(),
    v: Type.Number(),
    rotation: Type.Number(),
    scale: Type.Number({ minimum: 1e-9, maximum: MAX_DIM }),
  }),
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  width: Type.Number({ minimum: 1, maximum: 65536 }),
  height: Type.Number({ minimum: 1, maximum: 65536 }),
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
    distance2: Type.Optional(Type.Number({ minimum: 0, maximum: MAX_DIM })),
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

const loft = feature("loft", { sections: profiles(2), operation, targets });

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

const text = Type.String({ minLength: 1, maxLength: 200 });

export const groupsSchema = Type.Refine(
  Type.Array(
    Type.Object({
      id,
      name,
      kind: Type.Enum(["body", "sketch"]),
      members: Type.Array(text),
    }),
  ),
  (groups) => {
    const ids = groups.map((g) => g.id);
    const members = groups.flatMap((g) => g.members);
    return (
      new Set(ids).size === ids.length &&
      new Set(members).size === members.length
    );
  },
  () => "has a repeated group id or a member in more than one group",
);

export const documentSchema = Type.Refine(
  Type.Object({
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    namingVersion: Type.Union([Type.Literal(1), Type.Literal(2)]),
    revision: Type.Integer({ minimum: 0 }),
    savedWith: Type.Union([
      Type.Null(),
      Type.Object({
        version: text,
        commit: Type.Union([text, Type.Null()]),
      }),
    ]),
    id,
    name,
    createdAt: text,
    modifiedAt: text,
    modifiedBy: Type.Union([text, Type.Null()]),
    features: Type.Array(Type.Unknown()),
    timelinePosition: Type.Integer({ minimum: 0 }),
    bodyMeta: Type.Record(Type.String(), Type.Object({ name: Type.String() })),
    counters: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    groups: groupsSchema,
    extensions: Type.Record(
      Type.String({
        pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$",
        maxLength: 200,
      }),
      Type.Object({
        version: Type.Integer({ minimum: 0 }),
        data: Type.Unknown(),
      }),
      { additionalProperties: false },
    ),
  }),
  (doc) => doc.timelinePosition <= doc.features.length,
  () => "has timelinePosition past the last feature",
);
