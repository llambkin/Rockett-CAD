import { Type, type TSchema } from "typebox";
import { ORIGIN_AXES, REF_SIGNATURE_TYPES } from "../model.js";

export const featureIdSchema = Type.String({ minLength: 1, maxLength: 100 });
export const bodyIdSchema = Type.String({ minLength: 1 });
const topoName = Type.String({ minLength: 1 });
const id = featureIdSchema;
const bodyId = bodyIdSchema;

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

export const bodyRef = Type.Object({ kind: Type.Literal("body"), bodyId });

export const sketchEntityRef = Type.Object({
  kind: Type.Literal("sketchEntity"),
  sketchId: id,
  entityId: id,
});

export const projectionRef = Type.Union([
  edgeRef,
  faceRef,
  sketchEntityRef,
  bodyRef,
  Type.Object({
    kind: Type.Literal("section"),
    of: Type.Union([faceRef, bodyRef]),
  }),
]);

export const pointRef = Type.Union([
  Type.Object({ kind: Type.Literal("vertex"), bodyId, vertexName: topoName }),
  Type.Object({
    kind: Type.Literal("sketchPoint"),
    sketchId: id,
    entityId: id,
  }),
]);

export const planeRef = Type.Union([
  Type.Object({
    kind: Type.Literal("origin"),
    plane: Type.Enum(["XY", "XZ", "YZ"]),
  }),
  Type.Object({ kind: Type.Literal("construction"), featureId: id }),
  Type.Object({ kind: Type.Literal("face"), face: faceRef }),
]);

export const originAxis = Type.Enum([...ORIGIN_AXES]);

export const axisRef = Type.Union([
  Type.Object({ kind: Type.Literal("originAxis"), axis: originAxis }),
  Type.Object({ kind: Type.Literal("sketchLine"), sketchId: id, entityId: id }),
  Type.Object({ kind: Type.Literal("edge"), edge: edgeRef }),
]);

export const profileRef = Type.Object({
  sketchId: id,
  profileId: Type.String({ minLength: 1, maxLength: 200 }),
});

export const toolTargets = {
  targets: Type.Optional(Type.Array(bodyId, { uniqueItems: true })),
  autoTargets: Type.Optional(
    Type.Object(
      {
        exclude: Type.Array(bodyId, { uniqueItems: true }),
        features: Type.Array(id, { uniqueItems: true }),
      },
      { additionalProperties: false },
    ),
  ),
};

export const oneTargetForm = <T extends TSchema>(schema: T) =>
  Type.Refine(
    schema,
    (f: { targets?: unknown; autoTargets?: unknown }) =>
      f.targets === undefined || f.autoTargets === undefined,
    () => "has both targets and autoTargets",
  );
