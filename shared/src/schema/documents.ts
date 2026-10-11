import { Type } from "typebox";
import { SCHEMA_VERSION } from "../documents.js";
import { featureNameSchema, NAME_LENGTH } from "./coreFeatures.js";
import { bodyIdSchema, featureIdSchema } from "./refs.js";
import { parameterStateSchema, validParameterState } from "./parameters.js";

import { moduleAssetHashesSchema, MODULE_ASSET_LIMIT } from "./assets.js";

const id = featureIdSchema;
const name = featureNameSchema;
const bodyId = bodyIdSchema;
const text = featureNameSchema;
const namespace = Type.String({
  pattern: "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)*$",
  maxLength: NAME_LENGTH,
});

export const moduleAssetsSchema = Type.Refine(
  Type.Object({
    namespaces: Type.Record(namespace, moduleAssetHashesSchema, {
      additionalProperties: false,
      maxProperties: MODULE_ASSET_LIMIT,
    }),
    legacy: Type.Optional(Type.Unknown()),
  }),
  (assets) =>
    Object.values(assets.namespaces).reduce(
      (count, hashes) => count + hashes.length,
      0,
    ) <= MODULE_ASSET_LIMIT,
  () => "has too many module asset references",
);

export const groupsSchema = Type.Refine(
  Type.Array(
    Type.Object({
      id,
      name,
      kind: Type.Enum(["body", "sketch"]),
      members: Type.Array(bodyId),
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

const bodyColorSchema = Type.String({ pattern: "^#[0-9a-f]{6}$" });

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
    ...parameterStateSchema,
    timelinePosition: Type.Integer({ minimum: 0 }),
    bodyMeta: Type.Record(
      Type.String(),
      Type.Object({
        name: Type.String(),
        color: Type.Optional(bodyColorSchema),
      }),
    ),
    counters: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
    groups: groupsSchema,
    moduleAssets: Type.Optional(moduleAssetsSchema),
    extensions: Type.Record(
      namespace,
      Type.Object({
        version: Type.Integer({ minimum: 0 }),
        data: Type.Unknown(),
      }),
      { additionalProperties: false },
    ),
  }),
  (doc) =>
    doc.timelinePosition <= doc.features.length && validParameterState(doc),
  () => "has invalid parameters, bindings or timelinePosition",
);

export const bodyEditBody = Type.Refine(
  Type.Object(
    {
      name: Type.Optional(Type.String()),
      color: Type.Optional(Type.Union([bodyColorSchema, Type.Null()])),
    },
    { additionalProperties: false },
  ),
  (edit) => "name" in edit !== "color" in edit,
  () => "must send name or color, not both",
);

export const namingUpgradeBody = Type.Object({
  accept: Type.Optional(
    Type.Array(
      Type.Object({
        featureId: Type.Union([Type.String(), Type.Null()]),
        path: Type.String(),
        to: Type.Object({
          bodyId: Type.String(),
          name: Type.Optional(Type.String()),
        }),
      }),
    ),
  ),
});
