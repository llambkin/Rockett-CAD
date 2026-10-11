import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { CadDocument, Route, SignedFaceRef } from "@rockett/plugin-api";
import type { PlanFeatures } from "../plan/plan.js";
import { validatePost, type Post } from "../post/schema.js";
import type { Program, Xy } from "./ir.js";
import { machineSchema } from "./machine.js";
import { MIN_TOLERANCE } from "./params.js";
import { storedPresetSchema, toolSchema } from "./tools.js";

export const CAM_EXTENSION = "rockett.cam";
export const CAM_VERSION = 4;
const READ_VERSIONS = new Set([1, 2, 3, CAM_VERSION]);

export const entry = Type.Object({ id: Type.String({ minLength: 1 }) });

const docTool = Type.Intersect([
  entry,
  Type.Partial(toolSchema),
  Type.Partial(
    Type.Object({
      libraryRef: entry,
      number: Type.Integer({ minimum: 1 }),
      presets: Type.Array(storedPresetSchema),
    }),
  ),
]);

const sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });

const docOperation = Type.Intersect([
  entry,
  Type.Partial(
    Type.Object({
      type: Type.String(),
      name: Type.String(),
      toolId: Type.String(),
      presetId: Type.String(),
      params: Type.Record(Type.String(), Type.Unknown()),
      suppressed: Type.Boolean(),
      lastGenerated: Type.Object({
        fingerprint: sha256,
        programSha256: sha256,
        at: Type.String(),
      }),
    }),
  ),
]);

const xyz = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);
const side = Type.Union([Type.Literal("min"), Type.Literal("max")]);
const axis = Type.Union([
  Type.Literal("+x"),
  Type.Literal("-x"),
  Type.Literal("+y"),
  Type.Literal("-y"),
  Type.Literal("+z"),
  Type.Literal("-z"),
]);

const stockSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("boxAround"),
    margins: Type.Object({
      xMin: Type.Number(),
      xMax: Type.Number(),
      yMin: Type.Number(),
      yMax: Type.Number(),
      zMin: Type.Number(),
      zMax: Type.Number(),
    }),
  }),
  Type.Object({ kind: Type.Literal("box"), size: xyz }),
  Type.Object({
    kind: Type.Literal("cylinder"),
    diameter: Type.Number(),
    height: Type.Number(),
  }),
]);

const wcsSchema = Type.Object({
  origin: Type.Union([
    Type.Object({
      kind: Type.Literal("stockCorner"),
      x: side,
      y: side,
      z: side,
    }),
    Type.Object({
      kind: Type.Literal("reference"),
      ref: Type.Object({
        kind: Type.Literal("vertex"),
        bodyId: Type.String(),
        vertexName: Type.String(),
      }),
      offset: xyz,
    }),
  ]),
  axes: Type.Object({ x: axis, z: axis }),
  offsetIndex: Type.Integer({ minimum: 1 }),
  machine: Type.Union([
    Type.Object({ kind: Type.Literal("unknown") }),
    Type.Object({ kind: Type.Literal("known"), origin: xyz }),
  ]),
});

const fixtureSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  min: xyz,
  max: xyz,
});

export const POST_MAX_BYTES = 64 * 1024;
export const USER_POST_PREFIX = "user.";

export type PostCopy = Post & { libraryRef: Static<typeof entry> };

export const copiedPost = ({ libraryRef: _ref, ...post }: PostCopy): Post =>
  post;

export function sizeProblem(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes > POST_MAX_BYTES
    ? `is ${bytes} bytes, over the ${POST_MAX_BYTES} byte limit`
    : "";
}

export function storedPostProblem(post: Post): string {
  if (!post.id.startsWith(USER_POST_PREFIX))
    return `id must start with ${USER_POST_PREFIX}`;
  return sizeProblem(JSON.stringify(post)) || (validatePost(post)[0] ?? "");
}

const postProblem = (copy: PostCopy) => storedPostProblem(copiedPost(copy));

const docPost = Type.Refine(
  Type.Object({ id: Type.String(), libraryRef: entry }),
  (copy) => !postProblem(copy as PostCopy),
  (copy) => postProblem(copy as PostCopy),
);

const docSetup = Type.Intersect([
  entry,
  Type.Partial(
    Type.Object({
      name: Type.String(),
      bodies: Type.Array(Type.String({ minLength: 1 })),
      stock: stockSchema,
      material: Type.String({ minLength: 1 }),
      wcs: wcsSchema,
      safeHeight: Type.Number(),
      clearance: Type.Number(),
      operations: Type.Array(docOperation),
      post: docPost,
      machine: Type.Intersect([
        machineSchema,
        Type.Object({ libraryRef: entry }),
      ]),
      postId: Type.String({ minLength: 1 }),
      tolerance: Type.Number({ minimum: MIN_TOLERANCE }),
      fixtures: Type.Array(fixtureSchema),
    }),
  ),
]);

export const camDataSchema = Type.Object(
  { setups: Type.Array(docSetup), tools: Type.Array(docTool) },
  { additionalProperties: false },
);

export type CamData = Static<typeof camDataSchema>;

export const saveCam: Route<"/projects/:id/m/rockett/cam", CamData> & {
  readonly body: typeof camDataSchema;
} = {
  method: "PUT",
  path: "/projects/:id/m/rockett/cam",
  body: camDataSchema,
  effect: "document",
};

const target = Type.Object({
  setupId: Type.String({ minLength: 1 }),
  operationId: Type.String({ minLength: 1 }),
});

export type Target = Static<typeof target>;

export const generateRoute: Route<
  "/projects/:id/m/rockett/cam/generate",
  Target
> & { readonly body: typeof target } = {
  method: "POST",
  path: "/projects/:id/m/rockett/cam/generate",
  body: target,
  effect: "document",
};

export const generateStaleRoute: Route<"/projects/:id/m/rockett/cam/generate-stale"> =
  {
    method: "POST",
    path: "/projects/:id/m/rockett/cam/generate-stale",
    effect: "document",
  };

export type OperationStatus =
  | { status: "fresh" | "stale" | "never" | "suppressed" }
  | { status: "error" | "missingReference"; reason: string };

export const statusRoute: Route<
  "/projects/:id/m/rockett/cam/setups/:setupId/status",
  unknown,
  Record<string, OperationStatus>
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/cam/setups/:setupId/status",
};

export const programRoute: Route<
  "/projects/:id/m/rockett/cam/setups/:setupId/operations/:operationId/program",
  unknown,
  { program: Program } | { reason: string }
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/cam/setups/:setupId/operations/:operationId/program",
};

export const surfaceRoute: Route<
  "/projects/:id/m/rockett/cam/setups/:setupId/surface/:tolerance",
  unknown,
  | {
      min: Xy;
      cellMm: number;
      columns: number;
      rows: number;
      tops: (number | null)[];
    }
  | { reason: string }
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/cam/setups/:setupId/surface/:tolerance",
};

export const featuresRoute: Route<
  "/projects/:id/m/rockett/cam/setups/:setupId/features",
  unknown,
  PlanFeatures | { reason: string }
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/cam/setups/:setupId/features",
};

export const signRoute: Route<
  "/projects/:id/m/rockett/cam/bodies/:bodyId/faces/:faceName/sig",
  unknown,
  SignedFaceRef
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/cam/bodies/:bodyId/faces/:faceName/sig",
};

export type Blocker =
  | {
      kind: "operation";
      setupId: string;
      operationId: string;
      name: string;
      status: OperationStatus["status"];
      reason?: string;
    }
  | { kind: "check"; setupId: string; rule: string; reason: string };

export type NcExport =
  | { fileName: string; nc: string }
  | { fileName: string; zip: string }
  | { blocked: Blocker[] }
  | { reason: string };

export const ncRoute: Route<
  "/projects/:id/m/rockett/cam/nc/:machineId/:postId/:toolChange/:setupIds",
  unknown,
  NcExport
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/cam/nc/:machineId/:postId/:toolChange/:setupIds",
};

export type CamRead =
  { status: "ready"; data: CamData } | { status: "kept"; reason: string };

export const isCamData = (data: unknown): data is CamData =>
  Value.Check(camDataSchema, data);

export function migrateCam(
  stored: CadDocument["extensions"][string] | undefined,
): CamRead {
  if (!stored) return { status: "ready", data: { setups: [], tools: [] } };
  const { version, data } = stored;
  if (version > CAM_VERSION)
    return {
      status: "kept",
      reason: `CAM data version ${version} is newer than this module reads (${CAM_VERSION})`,
    };
  if (READ_VERSIONS.has(version) && isCamData(data))
    return { status: "ready", data };
  return { status: "kept", reason: `CAM data version ${version} is not valid` };
}
