/** Typed client for the Rockett CAD REST API. */

import type {
  ApiErrorBody,
  ApiErrorCode,
  CadDocument,
  EvaluateResult,
  ExportRequest,
  Feature,
  MeasureRequest,
  MeasureResult,
  ProjectSummary,
  EdgeRef,
  SketchEntity,
} from "@rockett/shared";

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
  const res = await fetch(`/api${path}`, {
    method,
    ...(body !== undefined &&
      !form && { headers: { "Content-Type": "application/json" } }),
    ...(body !== undefined && { body: form ? body : JSON.stringify(body) }),
    ...(signal && { signal }),
  });
  if (!res.ok) throw await toApiError(res);
  if (response !== "blob") return res.json();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  return {
    blob: await res.blob(),
    fileName: disposition.match(/filename="([^"]+)"/)?.[1],
  };
}

function fileForm(name: string, file: File): FormData {
  const form = new FormData();
  form.append(name, file);
  return form;
}

export const api = {
  health: () => (health ??= request<Health>("GET", "/health")),
  importStep: (file: File, projectId?: string, signal?: AbortSignal) =>
    request<MutationResponse>(
      "POST",
      projectId
        ? `/projects/${projectId}/import-step`
        : "/projects/import-step",
      { body: fileForm("file", file), signal },
    ),
  listProjects: () => request<ProjectSummary[]>("GET", "/projects"),
  createProject: (name: string) =>
    request<{ document: CadDocument }>("POST", "/projects", { body: { name } }),
  getProject: (id: string) =>
    request<{ document: CadDocument }>("GET", `/projects/${id}`),
  deleteProject: (id: string) =>
    request<{ ok: true }>("DELETE", `/projects/${id}`),
  duplicateProject: (id: string, name?: string) =>
    request<{ document: CadDocument }>("POST", `/projects/${id}/duplicate`, {
      body: { name },
    }),
  renameProject: (id: string, name: string) =>
    request<{ document: CadDocument }>("POST", `/projects/${id}/rename`, {
      body: { name },
    }),

  evaluate: (id: string, position?: number) =>
    request<EvaluateResult>(
      "GET",
      `/projects/${id}/evaluate${position === undefined ? "" : `?position=${position}`}`,
    ),
  tangentEdges: (id: string, edge: EdgeRef, beforeFeatureId?: string) =>
    request<{ edges: EdgeRef[] }>("POST", `/projects/${id}/tangent-edges`, {
      body: { edge, beforeFeatureId },
    }),
  projectEdge: (id: string, fid: string, edge: EdgeRef, entityId: string) =>
    request<{ entities: SketchEntity[] }>(
      "POST",
      `/projects/${id}/features/${fid}/project`,
      { body: { edge, entityId } },
    ),

  addFeature: (id: string, feature: Feature) =>
    request<MutationResponse>("POST", `/projects/${id}/features`, {
      body: { feature },
    }),
  updateFeature: (
    id: string,
    fid: string,
    feature: Partial<Feature>,
    position?: number,
  ) =>
    request<MutationResponse>(
      "PUT",
      `/projects/${id}/features/${fid}${position === undefined ? "" : `?position=${position}`}`,
      { body: { feature } },
    ),
  deleteFeature: (id: string, fid: string) =>
    request<MutationResponse>("DELETE", `/projects/${id}/features/${fid}`),
  setTimeline: (id: string, position: number) =>
    request<MutationResponse>("POST", `/projects/${id}/timeline`, {
      body: { position },
    }),
  replaceDocument: (id: string, document: CadDocument, position?: number) =>
    request<MutationResponse>(
      "PUT",
      `/projects/${id}/document${position === undefined ? "" : `?position=${position}`}`,
      { body: { document } },
    ),
  updateBody: (
    id: string,
    bodyId: string,
    patch: { name?: string; visible?: boolean },
  ) =>
    request<MutationResponse>(
      "PUT",
      `/projects/${id}/bodies/${encodeURIComponent(bodyId)}`,
      { body: patch },
    ),

  measure: (id: string, refs: MeasureRequest["refs"]) =>
    request<MeasureResult>("POST", `/projects/${id}/measure`, {
      body: { refs },
    }),

  async exportModel(
    id: string,
    exportRequest: ExportRequest,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; fileName: string }> {
    const { blob, fileName } = await request("POST", `/projects/${id}/export`, {
      body: exportRequest,
      signal,
      response: "blob",
    });
    return { blob, fileName: fileName ?? `export.${exportRequest.format}` };
  },

  uploadImage: (id: string, file: File, signal?: AbortSignal) =>
    request<{ assetId: string }>("POST", `/projects/${id}/assets`, {
      body: fileForm("image", file),
      signal,
    }),

  assetUrl: (id: string, assetId: string) =>
    `/api/projects/${id}/assets/${assetId}`,
};
