import { Type, type Static } from "typebox";

export const NAMESPACE = "rockett.kicad";
export const VERSION = 2;
export const READ_VERSIONS: readonly number[] = [1, VERSION];
export const SNAPSHOT_VERSION = 1;
export const MODEL_NAME_LENGTH = 1024;

export const hashSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const linkSchema = Type.Object({
  sourceKind: Type.Literal("upload"),
  sourceAsset: hashSchema,
  sha256: hashSchema,
  formatVersion: Type.Integer(),
  generator: Type.Optional(Type.String()),
  generatorVersion: Type.Optional(Type.String()),
  snapshotAsset: hashSchema,
  outlineOwner: Type.Union([Type.Literal("kicad"), Type.Literal("rockett")]),
  models: Type.Optional(
    Type.Record(Type.String({ maxLength: MODEL_NAME_LENGTH }), hashSchema),
  ),
});

export const dataSchema = Type.Object({
  links: Type.Record(Type.String(), linkSchema),
});

export type Link = Static<typeof linkSchema>;

export const linkAssets = (link: Link) => [
  link.sourceAsset,
  link.snapshotAsset,
  ...Object.values(link.models ?? {}),
];

export const point = Type.Tuple([Type.Number(), Type.Number()]);
const xyz = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);
const segment = Type.Union([
  Type.Object({ kind: Type.Literal("line"), from: point, to: point }),
  Type.Object({
    kind: Type.Literal("arc"),
    from: point,
    to: point,
    centre: point,
    sweep: Type.Number(),
  }),
]);
export const loop = Type.Array(segment, { minItems: 1 });
export const drillSchema = Type.Object({
  shape: Type.Union([Type.Literal("round"), Type.Literal("oval")]),
  width: Type.Number({ exclusiveMinimum: 0 }),
  height: Type.Number({ exclusiveMinimum: 0 }),
});
export const modelSchema = Type.Object({
  path: Type.String(),
  offset: xyz,
  scale: xyz,
  rotate: xyz,
});
const footprintSchema = Type.Object({
  uuid: Type.Optional(Type.String()),
  libId: Type.Optional(Type.String()),
  reference: Type.Optional(Type.String()),
  side: Type.Optional(
    Type.Union([Type.Literal("front"), Type.Literal("back")]),
  ),
  x: Type.Number(),
  y: Type.Number(),
  angle: Type.Number(),
  courtyard: Type.Optional(Type.Object({ min: point, max: point })),
  pads: Type.Array(
    Type.Object({
      number: Type.Optional(Type.String()),
      x: Type.Number(),
      y: Type.Number(),
      angle: Type.Number(),
      drill: Type.Optional(drillSchema),
    }),
  ),
  models: Type.Array(modelSchema),
});
export const snapshotSchema = Type.Object({
  version: Type.Literal(SNAPSHOT_VERSION),
  data: Type.Object({
    thickness: Type.Number({ exclusiveMinimum: 0 }),
    outline: loop,
    cutouts: Type.Array(loop),
    footprints: Type.Array(footprintSchema),
  }),
});

export type Snapshot = Static<typeof snapshotSchema>["data"];
export type Footprint = Snapshot["footprints"][number];
export type Model = Static<typeof modelSchema>;
