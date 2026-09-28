import { Type, type Static, type TSchema } from "typebox";
import type { User } from "./auth.js";
import type {
  CadDocument,
  EdgeRef,
  Feature,
  SketchEntity,
  TreeGroup,
} from "./model.js";
import type {
  EvaluateResult,
  ExportRequest,
  Folder,
  FolderTree,
  Formats,
  HeldMeshes,
  HistoryList,
  HistoryMark,
  HistoryStatus,
  MeasureRequest,
  MeasureResult,
  NamingDecision,
  NamingMapping,
  NamingUpgradeProposal,
  ProjectResponse,
  ProjectSummary,
  ProjectView,
  SizeLimit,
  SizeLimitRequest,
  WireEvaluateResult,
} from "./api.js";
import type { ProjectMember } from "./model.js";
import { settingsRoutes } from "./settingsRoutes.js";
import { VIEW_VERSION } from "./api.js";
import { edgeRef, faceRef, groupsSchema } from "./schema/features.js";
import { LABEL_LIMIT, snapshotHash } from "./schema/history.js";
import {
  createFolderBody,
  folderId,
  folderMembers,
  placeProjectBody,
  updateFolderBody,
} from "./schema/folders.js";

export interface MutationResponse {
  document: CadDocument;
  evaluation: EvaluateResult;
  history?: HistoryStatus;
}

export interface WireMutationResponse {
  document: CadDocument;
  evaluation: WireEvaluateResult;
  history?: HistoryStatus;
}

export interface NamingUpgradeResponse extends WireMutationResponse {
  backup: string;
  mappings: NamingMapping[];
}

export const PROJECT_FILE_FORMAT = "rockett-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_LIMIT_MB = 64;
export const DEFAULT_PORT = 8788;

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: typeof PROJECT_FILE_VERSION;
  document: CadDocument;
  assets: Record<string, string>;
}

export function referencedAssets(doc: CadDocument): Set<string> {
  return new Set(
    doc.features.flatMap((f) =>
      f.type === "referenceImage"
        ? [f.assetId]
        : f.type === "importStep"
          ? [f.blob]
          : [],
    ),
  );
}

export const projectFileEnvelope = Type.Object({
  format: Type.Literal(PROJECT_FILE_FORMAT),
  version: Type.Integer({ minimum: 1 }),
  document: Type.Object({ schemaVersion: Type.Integer({ minimum: 1 }) }),
  assets: Type.Record(Type.String(), Type.String()),
});

export interface Health {
  version: string;
  schemaVersion: number;
  commit: string | null;
  describe: string | null;
  kernelVersion: { occt: string; commit: string } | null;
  kernel: "starting" | "ready" | "restarting" | "failed";
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

declare const exchange: unique symbol;

export interface Route<
  P extends string = string,
  Req = unknown,
  Res = unknown,
> {
  readonly method: Method;
  readonly path: P;
  readonly body?: TSchema;
  readonly [exchange]?: { request: Req; response: Res };
}

type ParamNames<P extends string> =
  P extends `${string}:${infer Name}/${infer Rest}`
    ? Name | ParamNames<Rest>
    : P extends `${string}:${infer Name}`
      ? Name
      : never;

export type PathParams<P extends string> = Record<ParamNames<P>, string>;

export const route =
  <Req, Res>() =>
  <const P extends string, S extends TSchema>(
    method: Method,
    path: P,
    body?: S & (Static<S> extends Req ? unknown : never),
  ): Route<P, Req, Res> =>
    body ? { method, path, body } : { method, path };

export const loginBody = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 32 }),
    password: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const setupBody = Type.Object(
  {
    token: Type.String({ minLength: 1, maxLength: 256 }),
    username: Type.String({ minLength: 1, maxLength: 32 }),
    displayName: Type.String({ minLength: 1, maxLength: 100 }),
    password: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
);

export const passwordChangeBody = Type.Object(
  {
    current: Type.String({ minLength: 1, maxLength: 256 }),
    next: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
);

export const userCreateBody = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 32 }),
    email: Type.Optional(Type.String({ maxLength: 254 })),
    displayName: Type.String({ minLength: 1, maxLength: 100 }),
    role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
    password: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
);

export const userPatchBody = Type.Object(
  {
    email: Type.Optional(
      Type.Union([Type.String({ maxLength: 254 }), Type.Null()]),
    ),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    role: Type.Optional(
      Type.Union([Type.Literal("admin"), Type.Literal("member")]),
    ),
    status: Type.Optional(
      Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
    ),
    password: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
  },
  { additionalProperties: false },
);

export const AUTH_ROUTES = {
  status: route<never, { setup: "needs-token" | "ready" | "done" }>()(
    "GET",
    "/auth/status",
  ),
  setup: route<
    { token: string; username: string; displayName: string; password: string },
    User
  >()("POST", "/auth/setup", setupBody),
  login: route<{ username: string; password: string }, User>()(
    "POST",
    "/auth/login",
    loginBody,
  ),
  logout: route<never, { ok: true }>()("POST", "/auth/logout"),
  me: route<never, User>()("GET", "/me"),
  passwordChange: route<{ current: string; next: string }, { ok: true }>()(
    "POST",
    "/me/password",
    passwordChangeBody,
  ),
  users: route<never, User[]>()("GET", "/users"),
  userCreate: route<
    {
      username: string;
      email?: string;
      displayName: string;
      role: User["role"];
      password: string;
    },
    User
  >()("POST", "/users", userCreateBody),
  userPatch: route<
    {
      displayName?: string;
      email?: string | null;
      role?: User["role"];
      status?: User["status"];
      password?: string;
    },
    User
  >()("PATCH", "/users/:id", userPatchBody),
};

const name = Type.Object({ name: Type.Optional(Type.String()) });

const topoRef = Type.Union([
  faceRef,
  edgeRef,
  Type.Object({
    kind: Type.Literal("vertex"),
    bodyId: Type.String(),
    vertexName: Type.String(),
  }),
]);

const viewIds = Type.Array(Type.String({ minLength: 1, maxLength: 200 }));

const namingUpgradeBody = Type.Object({
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

export const projectView = Type.Object(
  {
    version: Type.Literal(VIEW_VERSION),
    hidden: Type.Object(
      { bodies: viewIds, features: viewIds },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const projectMembersBody = Type.Object(
  {
    owner: Type.Union([Type.String(), Type.Null()]),
    members: Type.Array(
      Type.Object(
        {
          userId: Type.String(),
          role: Type.Union([Type.Literal("view"), Type.Literal("edit")]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export interface ProjectMembersResponse {
  owner: string | null;
  members: ProjectMember[];
}

export interface ProjectMembersRoster extends ProjectMembersResponse {
  users: Array<{ id: string; displayName: string; username: string }>;
}

export const ROUTES = {
  health: route<never, Health>()("GET", "/health"),
  ...settingsRoutes(route),
  formats: route<never, Formats>()("GET", "/formats"),
  listProjects: route<never, ProjectSummary[]>()("GET", "/projects"),
  createProject: route<{ name?: string; folderId?: string }, ProjectResponse>()(
    "POST",
    "/projects",
    Type.Object({
      name: Type.Optional(Type.String()),
      folderId: Type.Optional(folderId),
    }),
  ),
  importStep: route<FormData, MutationResponse>()(
    "POST",
    "/projects/import-step",
  ),
  uploadProjectFile: route<FormData, ProjectResponse>()(
    "POST",
    "/projects/file",
  ),
  getProject: route<never, ProjectResponse>()("GET", "/projects/:id"),
  getProjectMembers: route<never, ProjectMembersRoster>()(
    "GET",
    "/projects/:id/members",
  ),
  projectMembers: route<ProjectMembersResponse, ProjectMembersResponse>()(
    "PUT",
    "/projects/:id/members",
    projectMembersBody,
  ),
  deleteProject: route<never, { ok: true }>()("DELETE", "/projects/:id"),
  duplicateProject: route<{ name?: string | undefined }, ProjectResponse>()(
    "POST",
    "/projects/:id/duplicate",
    name,
  ),
  renameProject: route<{ name?: string }, ProjectResponse>()(
    "POST",
    "/projects/:id/rename",
    name,
  ),
  placeProject: route<{ folderId: string | null }, { ok: true }>()(
    "PUT",
    "/projects/:id/folder",
    placeProjectBody,
  ),
  downloadProjectFile: route<never, Blob>()("GET", "/projects/:id/file"),
  mesh: route<never, Blob>()("GET", "/projects/:id/meshes/:hash"),
  evaluate: route<HeldMeshes, WireEvaluateResult>()(
    "POST",
    "/projects/:id/evaluate",
  ),
  jobEvents: route<never, never>()("GET", "/jobs/:jobId/events"),
  cancelJob: route<never, { ok: true }>()("DELETE", "/jobs/:jobId"),
  replaceDocument: route<
    { document: CadDocument } & HeldMeshes,
    WireMutationResponse
  >()("PUT", "/projects/:id/document"),
  importStepInto: route<FormData, MutationResponse>()(
    "POST",
    "/projects/:id/import-step",
  ),
  addFeature: route<{ feature: Feature } & HeldMeshes, WireMutationResponse>()(
    "POST",
    "/projects/:id/features",
  ),
  updateFeature: route<
    { feature: Partial<Feature> } & HeldMeshes,
    WireMutationResponse
  >()("PUT", "/projects/:id/features/:fid"),
  projectEdge: route<
    { edge: EdgeRef; entityId: string },
    { entities: SketchEntity[] }
  >()(
    "POST",
    "/projects/:id/features/:fid/project",
    Type.Object({
      edge: edgeRef,
      entityId: Type.String({ minLength: 1, maxLength: 100 }),
    }),
  ),
  deleteFeature: route<HeldMeshes, WireMutationResponse>()(
    "DELETE",
    "/projects/:id/features/:fid",
  ),
  setTimeline: route<{ position: number } & HeldMeshes, WireMutationResponse>()(
    "POST",
    "/projects/:id/timeline",
    Type.Object({ position: Type.Integer({ minimum: 0 }) }),
  ),
  tangentEdges: route<
    { edge: EdgeRef; beforeFeatureId?: string | undefined },
    { edges: EdgeRef[] }
  >()(
    "POST",
    "/projects/:id/tangent-edges",
    Type.Object({
      edge: edgeRef,
      beforeFeatureId: Type.Optional(Type.String()),
    }),
  ),
  undo: route<HeldMeshes, WireMutationResponse>()("POST", "/projects/:id/undo"),
  redo: route<HeldMeshes, WireMutationResponse>()("POST", "/projects/:id/redo"),
  history: route<never, HistoryList>()("GET", "/projects/:id/history"),
  createCheckpoint: route<{ label: string }, { checkpoint: HistoryMark }>()(
    "POST",
    "/projects/:id/checkpoints",
    Type.Object({
      label: Type.String({ minLength: 1, maxLength: LABEL_LIMIT }),
    }),
  ),
  restoreHistory: route<
    { snapshot: string } & HeldMeshes,
    WireMutationResponse
  >()(
    "POST",
    "/projects/:id/history/restore",
    Type.Object(
      {
        snapshot: snapshotHash,
        held: Type.Optional(Type.Array(Type.String())),
      },
      { additionalProperties: false },
    ),
  ),
  updateBody: route<{ name?: string } & HeldMeshes, WireMutationResponse>()(
    "PUT",
    "/projects/:id/bodies/:bodyId",
    Type.Object(
      {
        name: Type.Optional(Type.String()),
        held: Type.Optional(Type.Array(Type.String())),
      },
      { additionalProperties: false },
    ),
  ),
  updateGroups: route<
    { groups: TreeGroup[] } & HeldMeshes,
    WireMutationResponse
  >()("PUT", "/projects/:id/groups", Type.Object({ groups: groupsSchema })),
  stageNamingUpgrade: route<
    { accept?: NamingDecision[] },
    NamingUpgradeProposal
  >()("POST", "/projects/:id/upgrade-naming", namingUpgradeBody),
  commitNamingUpgrade: route<
    { accept?: NamingDecision[] } & HeldMeshes,
    NamingUpgradeResponse
  >()("POST", "/projects/:id/upgrade-naming/commit", namingUpgradeBody),
  getView: route<never, ProjectView>()("GET", "/projects/:id/view"),
  putView: route<ProjectView, ProjectView>()(
    "PUT",
    "/projects/:id/view",
    projectView,
  ),
  sizeLimit: route<SizeLimitRequest, SizeLimit>()(
    "POST",
    "/projects/:id/size-limit",
  ),
  measure: route<MeasureRequest, MeasureResult>()(
    "POST",
    "/projects/:id/measure",
    Type.Object({
      refs: Type.Array(topoRef, { minItems: 1, maxItems: 2 }),
    }),
  ),
  exportModel: route<ExportRequest, Blob>()(
    "POST",
    "/projects/:id/export",
    Type.Object({
      format: Type.String({ minLength: 1, maxLength: 200 }),
      bodyIds: Type.Array(Type.String()),
      sketchId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      face: Type.Optional(faceRef),
      quality: Type.Optional(Type.Number()),
      retain: Type.Optional(Type.Boolean()),
    }),
  ),
  uploadImage: route<FormData, { assetId: string }>()(
    "POST",
    "/projects/:id/assets",
  ),
  asset: route<never, Blob>()("GET", "/projects/:id/assets/:assetId"),
  listFolders: route<never, FolderTree>()("GET", "/folders"),
  createFolder: route<
    { name: string; parentId?: string | null },
    { folder: Folder }
  >()("POST", "/folders", createFolderBody),
  updateFolder: route<
    { name?: string; parentId?: string | null },
    { folder: Folder }
  >()("PATCH", "/folders/:id", updateFolderBody),
  deleteFolder: route<never, { ok: true }>()("DELETE", "/folders/:id"),
  getFolderMembers: route<never, ProjectMembersRoster>()(
    "GET",
    "/folders/:id/members",
  ),
  folderMembers: route<ProjectMembersResponse, ProjectMembersResponse>()(
    "PUT",
    "/folders/:id/members",
    folderMembers,
  ),
};

export const DOCUMENT_EDITS: ReadonlySet<Route> = new Set<Route>([
  ROUTES.renameProject,
  ROUTES.replaceDocument,
  ROUTES.importStepInto,
  ROUTES.addFeature,
  ROUTES.updateFeature,
  ROUTES.deleteFeature,
  ROUTES.setTimeline,
  ROUTES.undo,
  ROUTES.redo,
  ROUTES.restoreHistory,
  ROUTES.updateBody,
  ROUTES.updateGroups,
  ROUTES.commitNamingUpgrade,
]);

export function pathFor<P extends string>(
  target: Route<P>,
  params: PathParams<P>,
): string {
  const values: Partial<Record<string, string>> = params;
  return target.path.replace(/:(\w+)/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`${target.path} needs :${key}`);
    return encodeURIComponent(value);
  });
}
