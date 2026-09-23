/** Typed client for the Rockett CAD REST API. */

import type {
  ApiErrorBody,
  ApiErrorCode,
  CadDocument,
  EvaluateResult,
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

export async function request<T>(
  method: string,
  path: string,
  { body, signal }: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => (health ??= request<Health>("GET", "/health")),
  async importStep(file: File, projectId?: string): Promise<MutationResponse> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(
      projectId
        ? `/api/projects/${projectId}/import-step`
        : "/api/projects/import-step",
      { method: "POST", body: form },
    );
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? "STEP import failed");
    return result;
  },
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
    format: "stl" | "3mf",
    bodyIds: string[],
    quality?: number,
  ): Promise<{ blob: Blob; fileName: string }> {
    const res = await fetch(`/api/projects/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, bodyIds, quality }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(j.error);
    }
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const m = disposition.match(/filename="([^"]+)"/);
    return {
      blob: await res.blob(),
      fileName: m?.[1] ?? `export.${format}`,
    };
  },

  async uploadImage(id: string, file: File): Promise<{ assetId: string }> {
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(`/api/projects/${id}/assets`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(j.error);
    }
    return res.json();
  },

  assetUrl: (id: string, assetId: string) =>
    `/api/projects/${id}/assets/${assetId}`,
};
