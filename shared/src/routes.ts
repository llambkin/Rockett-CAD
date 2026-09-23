import { Type, type Static, type TSchema } from "typebox";
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
  MeasureRequest,
  MeasureResult,
  ProjectResponse,
  ProjectSummary,
} from "./api.js";
import { edgeRef, faceRef, groupsSchema } from "./schema/features.js";
import {
  createFolderBody,
  folderId,
  placeProjectBody,
  updateFolderBody,
} from "./schema/folders.js";

export interface MutationResponse {
  document: CadDocument;
  evaluation: EvaluateResult;
}

export const PROJECT_FILE_FORMAT = "rockett-project";
export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: typeof PROJECT_FILE_VERSION;
  document: CadDocument;
  assets: Record<string, string>;
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

const route =
  <Req, Res>() =>
  <const P extends string, S extends TSchema>(
    method: Method,
    path: P,
    body?: S & (Static<S> extends Req ? unknown : never),
  ): Route<P, Req, Res> =>
    body ? { method, path, body } : { method, path };

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

export const ROUTES = {
  health: route<never, Health>()("GET", "/health"),
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
  evaluate: route<never, EvaluateResult>()("GET", "/projects/:id/evaluate"),
  replaceDocument: route<{ document: CadDocument }, MutationResponse>()(
    "PUT",
    "/projects/:id/document",
  ),
  importStepInto: route<FormData, MutationResponse>()(
    "POST",
    "/projects/:id/import-step",
  ),
  addFeature: route<{ feature: Feature }, MutationResponse>()(
    "POST",
    "/projects/:id/features",
  ),
  updateFeature: route<{ feature: Partial<Feature> }, MutationResponse>()(
    "PUT",
    "/projects/:id/features/:fid",
  ),
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
  deleteFeature: route<never, MutationResponse>()(
    "DELETE",
    "/projects/:id/features/:fid",
  ),
  setTimeline: route<{ position: number }, MutationResponse>()(
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
  updateBody: route<{ name?: string; visible?: boolean }, MutationResponse>()(
    "PUT",
    "/projects/:id/bodies/:bodyId",
    Type.Object({
      name: Type.Optional(Type.String()),
      visible: Type.Optional(Type.Boolean()),
    }),
  ),
  updateGroups: route<{ groups: TreeGroup[] }, MutationResponse>()(
    "PUT",
    "/projects/:id/groups",
    Type.Object({ groups: groupsSchema }),
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
      format: Type.Enum(["stl", "3mf"]),
      bodyIds: Type.Array(Type.String()),
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
};

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
