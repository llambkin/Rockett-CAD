/** Typed client for the Rockett CAD REST API. */

import type {
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

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = j.error ?? detail;
    } catch {
      // keep statusText
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async importStep(file: File, projectId?: string): Promise<MutationResponse> {
    const form = new FormData(); form.append("file", file);
    const res = await fetch(projectId ? `/api/projects/${projectId}/import-step` : "/api/projects/import-step", { method: "POST", body: form });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error ?? "STEP import failed");
    return result;
  },
  listProjects: () => req<ProjectSummary[]>("GET", "/projects"),
  createProject: (name: string) =>
    req<{ document: CadDocument }>("POST", "/projects", { name }),
  getProject: (id: string) =>
    req<{ document: CadDocument }>("GET", `/projects/${id}`),
  deleteProject: (id: string) => req<{ ok: true }>("DELETE", `/projects/${id}`),
  duplicateProject: (id: string, name?: string) =>
    req<{ document: CadDocument }>("POST", `/projects/${id}/duplicate`, { name }),
  renameProject: (id: string, name: string) =>
    req<{ document: CadDocument }>("POST", `/projects/${id}/rename`, { name }),

  evaluate: (id: string) => req<EvaluateResult>("GET", `/projects/${id}/evaluate`),
  tangentEdges: (id: string, edge: EdgeRef, beforeFeatureId?: string) =>
    req<{ edges: EdgeRef[] }>("POST", `/projects/${id}/tangent-edges`, { edge, beforeFeatureId }),
  projectEdge: (id: string, fid: string, edge: EdgeRef, entityId: string) =>
    req<{ entities: SketchEntity[] }>("POST", `/projects/${id}/features/${fid}/project`, { edge, entityId }),

  addFeature: (id: string, feature: Feature) =>
    req<MutationResponse>("POST", `/projects/${id}/features`, { feature }),
  updateFeature: (id: string, fid: string, feature: Partial<Feature>) =>
    req<MutationResponse>("PUT", `/projects/${id}/features/${fid}`, { feature }),
  deleteFeature: (id: string, fid: string) =>
    req<MutationResponse>("DELETE", `/projects/${id}/features/${fid}`),
  setTimeline: (id: string, position: number) =>
    req<MutationResponse>("POST", `/projects/${id}/timeline`, { position }),
  replaceDocument: (id: string, document: CadDocument) =>
    req<MutationResponse>("PUT", `/projects/${id}/document`, { document }),
  updateBody: (id: string, bodyId: string, patch: { name?: string; visible?: boolean }) =>
    req<MutationResponse>(
      "PUT",
      `/projects/${id}/bodies/${encodeURIComponent(bodyId)}`,
      patch
    ),

  measure: (id: string, refs: MeasureRequest["refs"]) =>
    req<MeasureResult>("POST", `/projects/${id}/measure`, { refs }),

  async exportModel(
    id: string,
    format: "stl" | "3mf",
    bodyIds: string[],
    quality?: number
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

  assetUrl: (id: string, assetId: string) => `/api/projects/${id}/assets/${assetId}`,
};
