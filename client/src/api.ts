/** Typed client for the Rockett CAD REST API. */

import {
  DOCUMENT_EDITS,
  pathFor,
  ROUTES,
  type ApiErrorBody,
  type ApiErrorCode,
  type BodyPayload,
  type CadDocument,
  type EdgeRef,
  type EvaluateResult,
  type ExportRequest,
  type Feature,
  type Health,
  type HeldMeshes,
  type MeasureRequest,
  type MutationResponse,
  type PathParams,
  type ProjectView,
  type Route,
  type TreeGroup,
  type WireEvaluateResult,
  type WireMutationResponse,
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
    readonly revision?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body: Partial<ApiErrorBody> | null = await res.json().catch(() => null);
  if (typeof body?.error === "string" && typeof body.code === "string")
    return new ApiError(
      body.error,
      res.status,
      body.code,
      body.detail,
      body.revision,
    );
  return new ApiError(
    res.statusText || `HTTP ${res.status}`,
    res.status,
    "internal",
  );
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  keepalive?: boolean;
}

export interface ProjectWatch {
  id: string;
  onDocument: (document: CadDocument) => void;
  onMissing: () => void;
  checkImage: (image: File) => Promise<void>;
}

let watched: ProjectWatch | null = null;

const revisions = new Map<string, number>();

function received(document: { id?: unknown; revision?: unknown } | undefined) {
  if (typeof document?.id !== "string" || typeof document.revision !== "number")
    return;
  const known = revisions.get(document.id) ?? -1;
  if (document.revision > known) revisions.set(document.id, document.revision);
}

export function watchProject(watch: ProjectWatch | null): void {
  watched = watch;
}

function watching(path: string): ProjectWatch | null {
  const root = watched && `/projects/${encodeURIComponent(watched.id)}`;
  return root !== null && (path === root || path.startsWith(`${root}/`))
    ? watched
    : null;
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
  {
    body,
    headers,
    signal,
    keepalive,
    response,
  }: RequestOptions & { response?: "blob" } = {},
): Promise<unknown> {
  const form = body instanceof FormData;
  const watch = watching(path);
  const sent = {
    ...(body !== undefined && !form && { "Content-Type": "application/json" }),
    ...headers,
  };
  const res = await fetch(API + path, {
    method,
    ...(Object.keys(sent).length > 0 && { headers: sent }),
    ...(body !== undefined && { body: form ? body : JSON.stringify(body) }),
    ...(signal && { signal }),
    ...(keepalive && { keepalive }),
  }).catch((e: unknown) => {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiError("Could not reach the server.", 0, "internal");
  });
  if (!res.ok) {
    const error = await toApiError(res);
    if (res.status === 404) watch?.onMissing();
    throw error;
  }
  if (response !== "blob") {
    const json = await res.json();
    received(json?.document);
    if (method !== "GET" && json?.document?.id === watch?.id)
      watch?.onDocument(json.document);
    return json;
  }
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
  const id: string | undefined = (params as Partial<Record<string, string>>).id;
  const revision =
    DOCUMENT_EDITS.has(route) && id !== undefined
      ? revisions.get(id)
      : undefined;
  return request<Res>(route.method, pathFor(route, params) + query, {
    body,
    signal,
    ...(revision !== undefined && {
      headers: { "If-Match": `"${revision}"` },
    }),
  });
}

let meshes = new Map<string, BodyPayload>();

function keep(evaluation: EvaluateResult): EvaluateResult {
  meshes = new Map(evaluation.bodies.map((body) => [body.meshKey, body]));
  return evaluation;
}

function refill(
  evaluation: WireEvaluateResult,
  held: ReadonlyMap<string, BodyPayload>,
): EvaluateResult {
  return {
    ...evaluation,
    bodies: evaluation.bodies.map((body) => {
      if ("positions" in body) return body;
      const mesh = held.get(body.meshKey);
      if (!mesh) throw new Error(`The server omitted mesh ${body.meshKey}`);
      return { ...mesh, ...body };
    }),
  };
}

async function holding<P extends string, Req>(
  route: Route<P, Req & HeldMeshes, WireMutationResponse>,
  params: PathParams<P>,
  body: Req,
  position?: number,
): Promise<MutationResponse> {
  const held = meshes;
  const response = await send(route, params, {
    body: { ...body, held: [...held.keys()] },
    position,
  });
  return {
    document: response.document,
    evaluation: keep(refill(response.evaluation, held)),
  };
}

function viewless<T extends Partial<Feature>>(feature: T): T {
  const { visible: _visible, ...rest } = feature as T & { visible?: boolean };
  return rest as T;
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
  listProjects: () =>
    send(ROUTES.listProjects, {}).then((projects) => {
      projects.forEach(received);
      return projects;
    }),
  createProject: (name: string, folderId: string | null = null) =>
    send(
      ROUTES.createProject,
      {},
      { body: folderId === null ? { name } : { name, folderId } },
    ),
  getProject: (id: string) => send(ROUTES.getProject, { id }),
  deleteProject: (id: string, keepalive = false) =>
    request<{ ok: true }>(
      ROUTES.deleteProject.method,
      pathFor(ROUTES.deleteProject, { id }),
      { keepalive },
    ),
  duplicateProject: (id: string, name?: string) =>
    send(ROUTES.duplicateProject, { id }, { body: { name } }),
  renameProject: (id: string, name: string) =>
    send(ROUTES.renameProject, { id }, { body: { name } }),
  downloadProjectFile: (id: string) => {
    const route = ROUTES.downloadProjectFile;
    return request(route.method, pathFor(route, { id }), { response: "blob" });
  },
  uploadProjectFile: (
    file: File,
    fields: { temporary?: "true"; folderId?: string } = {},
  ) => {
    const form = fileForm("file", file);
    for (const [name, value] of Object.entries(fields))
      form.append(name, value);
    return send(ROUTES.uploadProjectFile, {}, { body: form });
  },
  placeProject: (id: string, folderId: string | null) =>
    send(ROUTES.placeProject, { id }, { body: { folderId } }),

  listFolders: () => send(ROUTES.listFolders, {}),
  createFolder: (name: string, parentId: string | null) =>
    send(ROUTES.createFolder, {}, { body: { name, parentId } }),
  renameFolder: (id: string, name: string) =>
    send(ROUTES.updateFolder, { id }, { body: { name } }),
  moveFolder: (id: string, parentId: string | null) =>
    send(ROUTES.updateFolder, { id }, { body: { parentId } }),
  deleteFolder: (id: string) => send(ROUTES.deleteFolder, { id }),

  evaluate: (id: string, position?: number) =>
    send(ROUTES.evaluate, { id }, { position }).then((evaluation) =>
      position === undefined ? keep(evaluation) : evaluation,
    ),
  tangentEdges: (id: string, edge: EdgeRef, beforeFeatureId?: string) =>
    send(ROUTES.tangentEdges, { id }, { body: { edge, beforeFeatureId } }),
  projectEdge: (id: string, fid: string, edge: EdgeRef, entityId: string) =>
    send(ROUTES.projectEdge, { id, fid }, { body: { edge, entityId } }),

  addFeature: (id: string, feature: Feature) =>
    holding(ROUTES.addFeature, { id }, { feature: viewless(feature) }),
  updateFeature: (
    id: string,
    fid: string,
    feature: Partial<Feature>,
    position?: number,
  ) =>
    holding(
      ROUTES.updateFeature,
      { id, fid },
      { feature: viewless(feature) },
      position,
    ),
  deleteFeature: (id: string, fid: string) =>
    send(ROUTES.deleteFeature, { id, fid }),
  setTimeline: (id: string, position: number) =>
    holding(ROUTES.setTimeline, { id }, { position }),
  replaceDocument: (id: string, document: CadDocument, position?: number) =>
    holding(
      ROUTES.replaceDocument,
      { id },
      { document: { ...document, features: document.features.map(viewless) } },
      position,
    ),
  updateBody: (id: string, bodyId: string, patch: { name: string }) =>
    holding(ROUTES.updateBody, { id, bodyId }, patch),
  updateGroups: (id: string, groups: TreeGroup[]) =>
    holding(ROUTES.updateGroups, { id }, { groups }),
  getView: (id: string) => send(ROUTES.getView, { id }),
  putView: (id: string, view: ProjectView) =>
    send(ROUTES.putView, { id }, { body: view }),

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

  uploadImage: async (id: string, file: File, signal?: AbortSignal) => {
    if (watched?.id === id) await watched.checkImage(file);
    return send(
      ROUTES.uploadImage,
      { id },
      { body: fileForm("image", file), signal },
    );
  },

  readAsset: (id: string, assetId: string) =>
    request(ROUTES.asset.method, pathFor(ROUTES.asset, { id, assetId }), {
      response: "blob",
    }).then((d) => d.blob),

  assetUrl: (id: string, assetId: string) =>
    API + pathFor(ROUTES.asset, { id, assetId }),
};
