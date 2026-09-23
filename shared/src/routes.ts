import type { CadDocument, EdgeRef, Feature, SketchEntity } from "./model.js";
import type {
  EvaluateResult,
  ExportRequest,
  MeasureRequest,
  MeasureResult,
  ProjectResponse,
  ProjectSummary,
} from "./api.js";

export interface MutationResponse {
  document: CadDocument;
  evaluation: EvaluateResult;
}

export interface Health {
  version: string;
  schemaVersion: number;
  commit: string | null;
  describe: string | null;
}

export type Method = "GET" | "POST" | "PUT" | "DELETE";

declare const exchange: unique symbol;

export interface Route<
  P extends string = string,
  Req = unknown,
  Res = unknown,
> {
  readonly method: Method;
  readonly path: P;
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
  <const P extends string>(method: Method, path: P): Route<P, Req, Res> => ({
    method,
    path,
  });

export const ROUTES = {
  health: route<never, Health>()("GET", "/health"),
  listProjects: route<never, ProjectSummary[]>()("GET", "/projects"),
  createProject: route<{ name: string }, ProjectResponse>()(
    "POST",
    "/projects",
  ),
  importStep: route<FormData, MutationResponse>()(
    "POST",
    "/projects/import-step",
  ),
  getProject: route<never, ProjectResponse>()("GET", "/projects/:id"),
  deleteProject: route<never, { ok: true }>()("DELETE", "/projects/:id"),
  duplicateProject: route<{ name?: string | undefined }, ProjectResponse>()(
    "POST",
    "/projects/:id/duplicate",
  ),
  renameProject: route<{ name: string }, ProjectResponse>()(
    "POST",
    "/projects/:id/rename",
  ),
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
  >()("POST", "/projects/:id/features/:fid/project"),
  deleteFeature: route<never, MutationResponse>()(
    "DELETE",
    "/projects/:id/features/:fid",
  ),
  setTimeline: route<{ position: number }, MutationResponse>()(
    "POST",
    "/projects/:id/timeline",
  ),
  tangentEdges: route<
    { edge: EdgeRef; beforeFeatureId?: string | undefined },
    { edges: EdgeRef[] }
  >()("POST", "/projects/:id/tangent-edges"),
  updateBody: route<{ name?: string; visible?: boolean }, MutationResponse>()(
    "PUT",
    "/projects/:id/bodies/:bodyId",
  ),
  measure: route<MeasureRequest, MeasureResult>()(
    "POST",
    "/projects/:id/measure",
  ),
  exportModel: route<ExportRequest, Blob>()("POST", "/projects/:id/export"),
  uploadImage: route<FormData, { assetId: string }>()(
    "POST",
    "/projects/:id/assets",
  ),
  asset: route<never, Blob>()("GET", "/projects/:id/assets/:assetId"),
};

export function pathFor<P extends string>(
  route: Route<P>,
  params: PathParams<P>,
): string {
  const values: Partial<Record<string, string>> = params;
  return route.path.replace(/:(\w+)/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`${route.path} needs :${name}`);
    return encodeURIComponent(value);
  });
}
