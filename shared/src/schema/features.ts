import { Type, type TProperties } from "typebox";
import { LINEAR_TOL } from "../tolerance.js";

export const MAX_DIM = 100_000;
const MAX_STEP_BYTES = 10 * 1024 * 1024;

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

const profileRef = Type.Object({
  sketchId: id,
  profileId: Type.String({ minLength: 1, maxLength: 200 }),
});

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

const importStep = feature("importStep", {
  filename: Type.String({ minLength: 1, maxLength: 255 }),
  data: Type.Refine(
    Type.String(),
    (data) =>
      data.length <= MAX_STEP_BYTES &&
      data.trimStart().startsWith("ISO-10303-21;"),
    () => "must be a STEP file up to 10 MB",
  ),
});

const emboss = feature("emboss", {
  profiles: Type.Array(profileRef, { minItems: 1, maxItems: 64 }),
  depth: Type.Number({ minimum: LINEAR_TOL, maximum: MAX_DIM }),
  mode: Type.Enum(["emboss", "deboss"]),
});

export const FEATURE_SCHEMAS = {
  sketch,
  constructionPlane,
  referenceImage,
  importStep,
  emboss,
};
