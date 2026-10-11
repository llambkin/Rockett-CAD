import { Type, type Static } from "typebox";
import type { SignInStep, TotpEnrolment, User } from "./auth.js";
import type { HealthResponse } from "./health.js";
export type { Health, HealthResponse } from "./health.js";
import type {
  BodyEdit,
  CadDocument,
  Feature,
  ParameterBinding,
  ParameterEdit,
  ProjectionRef,
  SketchEntity,
  TreeGroup,
} from "./model.js";
import type {
  BlobCollection,
  EvaluateResult,
  ExportRequest,
  Folder,
  FolderTree,
  Formats,
  HistoryStatus,
  MeasureRequest,
  MeasureResult,
  ModuleInfo,
  NamingDecision,
  NamingMapping,
  NamingUpgradeProposal,
  OpenedProject,
  ProjectResponse,
  ProjectSummary,
  ProjectView,
  SizeLimit,
  SizeLimitRequest,
} from "./api.js";
import type { ProjectMember } from "./model.js";
import { settingsRoutes } from "./settingsRoutes.js";
import { refRepairRoutes } from "./refRepairRoutes.js";
import { assemblyRoutes } from "./assembly.js";
import { MEASURE_MAX_REFS, VIEW_VERSION } from "./api.js";
import { VIEW_PROJECTION } from "./settings.js";
import {
  bodyIdSchema,
  edgeRef,
  faceRef,
  groupsSchema,
  projectionRef,
  vec3,
} from "./schema/features.js";
import { bodyEditBody, namingUpgradeBody } from "./schema/documents.js";
import { parameterStateSchema } from "./schema/parameters.js";
import { CHECKPOINT_ROUTES, snapshotHash } from "./schema/history.js";
import {
  createFolderBody,
  folderId,
  folderMembers,
  placeProjectBody,
  updateFolderBody,
} from "./schema/folders.js";

export interface MutationResponse<Evaluation = EvaluateResult> {
  document: CadDocument;
  evaluation: Evaluation;
  history?: HistoryStatus;
  warning?: string;
}

export interface NamingUpgradeResponse extends MutationResponse {
  backup: string;
  mappings: NamingMapping[];
}

export const THUMBNAIL_LIMITS = {
  width: 480,
  height: 320,
  bytes: 256 * 1024,
} as const;
export const DEFAULT_PORT = 8788;

import { route } from "./routeContract.js";
export {
  route,
  pathFor,
  DOCUMENT_EDITS,
  VIEWER_WRITES,
} from "./routeContract.js";
export type { Method, Route, PathParams } from "./routeContract.js";

export const loginBody = Type.Object(
  {
    username: Type.String({ minLength: 1, maxLength: 254 }),
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

export const totpCodeBody = Type.Object(
  { code: Type.String({ pattern: "^[0-9]{6}$" }) },
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
  login: route<{ username: string; password: string }, User | SignInStep>()(
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
  totp: route<{ code: string }, User>()("POST", "/auth/totp", totpCodeBody),
  totpEnrol: route<never, TotpEnrolment>()("POST", "/me/totp"),
  totpConfirm: route<{ code: string }, User>()(
    "POST",
    "/me/totp/confirm",
    totpCodeBody,
  ),
  totpOff: route<{ code: string }, User>()("DELETE", "/me/totp", totpCodeBody),
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

const text = Type.String();
const measureRef = Type.Union([
  Type.Object({ kind: Type.Literal("body"), bodyId: bodyIdSchema }),
  faceRef,
  edgeRef,
  Type.Object({ kind: Type.Literal("vertex"), bodyId: text, vertexName: text }),
]);

const viewIds = Type.Array(Type.String({ minLength: 1 }));
const parameterEditBody = Type.Object(parameterStateSchema, {
  additionalProperties: false,
});
export const parameterBindingsBody = Type.Object({
  parameterBindings: parameterStateSchema.parameterBindings,
});

export const viewCamera = Type.Object(
  {
    position: vec3,
    target: vec3,
    up: vec3,
    projection: VIEW_PROJECTION.schema,
  },
  { additionalProperties: false },
);

export const projectView = Type.Object(
  {
    version: Type.Literal(VIEW_VERSION),
    hidden: Type.Object(
      { bodies: viewIds, features: viewIds },
      { additionalProperties: false },
    ),
    camera: Type.Optional(Type.Union([viewCamera, Type.Null()])),
  },
  { additionalProperties: false },
);

export type ProjectViewBody = Static<typeof projectView>;

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
  health: route<never, HealthResponse>()("GET", "/health"),
  ...settingsRoutes(route),
  formats: route<never, Formats>()("GET", "/formats"),
  modules: route<never, ModuleInfo[]>()("GET", "/modules"),
  moduleLicence: route<never, { text: string }>()(
    "GET",
    "/modules/:id/licence",
  ),
  pluginClient: route<never, Blob>()("GET", "/plugins/:id/client.mjs"),
  listProjects: route<never, ProjectSummary[]>()("GET", "/projects"),
  createProject: route<{ name?: string; folderId?: string }, ProjectResponse>()(
    "POST",
    "/projects",
    Type.Object({
      name: Type.Optional(Type.String()),
      folderId: Type.Optional(folderId),
    }),
  ),
  importProject: route<FormData, MutationResponse>()(
    "POST",
    "/projects/import",
  ),
  uploadProjectFile: route<FormData, ProjectResponse>()(
    "POST",
    "/projects/file",
  ),
  getProject: route<never, OpenedProject>()("GET", "/projects/:id"),
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
    "document",
  ),
  placeProject: route<{ folderId: string | null }, { ok: true }>()(
    "PUT",
    "/projects/:id/folder",
    placeProjectBody,
  ),
  downloadProjectFile: route<never, Blob>()("GET", "/projects/:id/file"),
  mesh: route<never, Blob>()("GET", "/projects/:id/meshes/:hash"),
  evaluate: route<never, EvaluateResult>()(
    "POST",
    "/projects/:id/evaluate",
    undefined,
    "viewer",
  ),
  jobEvents: route<never, never>()("GET", "/jobs/:jobId/events"),
  cancelJob: route<never, { ok: true }>()("DELETE", "/jobs/:jobId"),
  importInto: route<FormData, MutationResponse>()(
    "POST",
    "/projects/:id/import",
    undefined,
    "document",
  ),
  updateParameters: route<ParameterEdit, MutationResponse>()(
    "PUT",
    "/projects/:id/parameters",
    parameterEditBody,
    "document",
  ),
  addFeature: route<
    { feature: Feature; emptySketch?: true },
    MutationResponse
  >()("POST", "/projects/:id/features", undefined, "document"),
  updateFeature: route<
    {
      feature: Partial<Feature>;
      parameterBindings?: ParameterBinding[];
    },
    MutationResponse
  >()("PUT", "/projects/:id/features/:fid", undefined, "document"),
  projectEdge: route<
    { edge: ProjectionRef; entityId: string },
    { entities: SketchEntity[] }
  >()(
    "POST",
    "/projects/:id/features/:fid/project",
    Type.Object({
      edge: projectionRef,
      entityId: Type.String({ minLength: 1, maxLength: 100 }),
    }),
    "viewer",
  ),
  deleteFeature: route<never, MutationResponse>()(
    "DELETE",
    "/projects/:id/features/:fid",
    undefined,
    "document",
  ),
  setTimeline: route<{ position: number }, MutationResponse>()(
    "POST",
    "/projects/:id/timeline",
    Type.Object({ position: Type.Integer({ minimum: 0 }) }),
    "document",
  ),
  ...refRepairRoutes(route),
  ...assemblyRoutes(route),
  undo: route<never, MutationResponse>()(
    "POST",
    "/projects/:id/undo",
    undefined,
    "document",
  ),
  redo: route<never, MutationResponse>()(
    "POST",
    "/projects/:id/redo",
    undefined,
    "document",
  ),
  commitPreview: route<never, MutationResponse>()(
    "POST",
    "/projects/:id/previews/:tx/commit",
  ),
  abortPreview: route<never, MutationResponse>()(
    "DELETE",
    "/projects/:id/previews/:tx",
  ),
  ...CHECKPOINT_ROUTES,
  restoreHistory: route<{ snapshot: string }, MutationResponse>()(
    "POST",
    "/projects/:id/history/restore",
    Type.Object({ snapshot: snapshotHash }, { additionalProperties: false }),
    "document",
  ),
  updateBody: route<BodyEdit, MutationResponse>()(
    "PUT",
    "/projects/:id/bodies/:bodyId",
    bodyEditBody,
    "document",
  ),
  updateGroups: route<{ groups: TreeGroup[] }, MutationResponse>()(
    "PUT",
    "/projects/:id/groups",
    Type.Object({ groups: groupsSchema }),
    "document",
  ),
  stageNamingUpgrade: route<
    { accept?: NamingDecision[] },
    NamingUpgradeProposal
  >()("POST", "/projects/:id/upgrade-naming", namingUpgradeBody),
  commitNamingUpgrade: route<
    { accept?: NamingDecision[] },
    NamingUpgradeResponse
  >()(
    "POST",
    "/projects/:id/upgrade-naming/commit",
    namingUpgradeBody,
    "document",
  ),
  collectBlobs: route<{ dryRun?: boolean }, BlobCollection>()(
    "POST",
    "/projects/:id/maintenance/gc",
    Type.Object({ dryRun: Type.Optional(Type.Boolean()) }),
  ),
  getThumbnail: route<never, Blob>()("GET", "/projects/:id/thumbnail"),
  putThumbnail: route<Blob, { ok: true }>()("PUT", "/projects/:id/thumbnail"),
  getView: route<never, ProjectView>()("GET", "/projects/:id/view"),
  putView: route<ProjectViewBody, ProjectView>()(
    "PUT",
    "/projects/:id/view",
    projectView,
    "viewer",
  ),
  sizeLimit: route<SizeLimitRequest, SizeLimit>()(
    "POST",
    "/projects/:id/size-limit",
    undefined,
    "viewer",
  ),
  measure: route<MeasureRequest, MeasureResult>()(
    "POST",
    "/projects/:id/measure",
    Type.Object({
      refs: Type.Array(measureRef, { minItems: 1, maxItems: MEASURE_MAX_REFS }),
    }),
    "viewer",
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
    "viewer",
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

export const PREVIEW_HEADER = "X-Rockett-Preview";
