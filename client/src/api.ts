/** Typed client for the Rockett CAD REST API. */

import {
  pathFor,
  ROUTES,
  type ApiErrorBody,
  type ApiErrorCode,
  type CadDocument,
  type EdgeRef,
  type ExportRequest,
  type Feature,
  type Health,
  type MeasureRequest,
  type PathParams,
  type Route,
} from "@rockett/shared";

export type { Health, MutationResponse } from "@rockett/shared";

const API = "/api";

let health: Promise<Health> | undefined;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body: Partial<ApiErrorBody> | null = await res.json().catch(() => null);
  if (typeof body?.error === "string" && typeof body.code === "string")
    return new ApiError(body.error, res.status, body.code, body.detail);
  return new ApiError(
    res.statusText || `HTTP ${res.status}`,
    res.status,
    "internal",
  );
}

interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal | undefined;
}

export interface Download {
  blob: Blob;
  fileName: string | undefined;
}

export function request<T>(
  method: string,
  path: string,
  options?: RequestOptions,
): Promise<T>;
export function request(
  method: string,
  path: string,
  options: RequestOptions & { response: "blob" },
): Promise<Download>;
export async function request(
  method: string,
  path: string,
  { body, signal, response }: RequestOptions & { response?: "blob" } = {},
): Promise<unknown> {
  const form = body instanceof FormData;
  const res = await fetch(API + path, {
    method,
    ...(body !== undefined &&
      !form && { headers: { "Content-Type": "application/json" } }),
    ...(body !== undefined && { body: form ? body : JSON.stringify(body) }),
    ...(signal && { signal }),
  });
  if (!res.ok) throw await toApiError(res);
  if (response !== "blob") return res.json();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return {
    blob: await res.blob(),
    fileName: encoded
      ? decodeURIComponent(encoded)
      : disposition.match(/filename="([^"]+)"/)?.[1],
  };
}

export function saveDownload({ blob, fileName }: Download): void {
  const a = window.document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName ?? "";
  a.click();
  URL.revokeObjectURL(a.href);
}

function send<P extends string, Req, Res>(
  route: Route<P, Req, Res>,
  params: PathParams<P>,
  {
    body,
    signal,
    position,
  }: {
    body?: Req;
    signal?: AbortSignal | undefined;
    position?: number | undefined;
  } = {},
): Promise<Res> {
  const query = position === undefined ? "" : `?position=${position}`;
  return request<Res>(route.method, pathFor(route, params) + query, {
    body,
    signal,
  });
}

function fileForm(name: string, file: File): FormData {
  const form = new FormData();
  form.append(name, file);
  return form;
}

export const api = {
  health: () => (health ??= send(ROUTES.health, {})),
  importStep: (file: File, projectId?: string, signal?: AbortSignal) => {
    const options = { body: fileForm("file", file), signal };
    return projectId
      ? send(ROUTES.importStepInto, { id: projectId }, options)
      : send(ROUTES.importStep, {}, options);
  },
  listProjects: () => send(ROUTES.listProjects, {}),
  createProject: (name: string) =>
    send(ROUTES.createProject, {}, { body: { name } }),
  getProject: (id: string) => send(ROUTES.getProject, { id }),
  deleteProject: (id: string) => send(ROUTES.deleteProject, { id }),
  duplicateProject: (id: string, name?: string) =>
    send(ROUTES.duplicateProject, { id }, { body: { name } }),
  renameProject: (id: string, name: string) =>
    send(ROUTES.renameProject, { id }, { body: { name } }),
  downloadProjectFile: (id: string) => {
    const route = ROUTES.downloadProjectFile;
    return request(route.method, pathFor(route, { id }), { response: "blob" });
  },
  uploadProjectFile: (file: File) =>
    send(ROUTES.uploadProjectFile, {}, { body: fileForm("file", file) }),

  evaluate: (id: string, position?: number) =>
    send(ROUTES.evaluate, { id }, { position }),
  tangentEdges: (id: string, edge: EdgeRef, beforeFeatureId?: string) =>
    send(ROUTES.tangentEdges, { id }, { body: { edge, beforeFeatureId } }),
  projectEdge: (id: string, fid: string, edge: EdgeRef, entityId: string) =>
    send(ROUTES.projectEdge, { id, fid }, { body: { edge, entityId } }),

  addFeature: (id: string, feature: Feature) =>
    send(ROUTES.addFeature, { id }, { body: { feature } }),
  updateFeature: (
    id: string,
    fid: string,
    feature: Partial<Feature>,
    position?: number,
  ) => send(ROUTES.updateFeature, { id, fid }, { body: { feature }, position }),
  deleteFeature: (id: string, fid: string) =>
    send(ROUTES.deleteFeature, { id, fid }),
  setTimeline: (id: string, position: number) =>
    send(ROUTES.setTimeline, { id }, { body: { position } }),
  replaceDocument: (id: string, document: CadDocument, position?: number) =>
    send(ROUTES.replaceDocument, { id }, { body: { document }, position }),
  updateBody: (
    id: string,
    bodyId: string,
    patch: { name?: string; visible?: boolean },
  ) => send(ROUTES.updateBody, { id, bodyId }, { body: patch }),

  measure: (id: string, refs: MeasureRequest["refs"]) =>
    send(ROUTES.measure, { id }, { body: { refs } }),

  async exportModel(
    id: string,
    exportRequest: ExportRequest,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; fileName: string }> {
    const route = ROUTES.exportModel;
    const { blob, fileName } = await request(
      route.method,
      pathFor(route, { id }),
      { body: exportRequest, signal, response: "blob" },
    );
    return { blob, fileName: fileName ?? `export.${exportRequest.format}` };
  },

  uploadImage: (id: string, file: File, signal?: AbortSignal) =>
    send(ROUTES.uploadImage, { id }, { body: fileForm("image", file), signal }),

  assetUrl: (id: string, assetId: string) =>
    API + pathFor(ROUTES.asset, { id, assetId }),
};
