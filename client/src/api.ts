import {
  DOCUMENT_EDITS,
  AUTH_ROUTES,
  pathFor,
  PREVIEW_HEADER,
  ROUTES,
  TX_HEADER,
  type ApiErrorBody,
  type ApiErrorCode,
  type BodyEdit,
  type CadDocument,
  type EdgeRef,
  type ExportRequest,
  type Feature,
  type ParameterBinding,
  type MeasureRequest,
  type NamingDecision,
  type ParameterEdit,
  type PathParams,
  type ProjectView,
  type ProjectMember,
  type Route,
  type User,
  type SizedFeature,
  type TreeGroup,
} from "@rockett/shared";
import type { Download } from "./download";
export { saveDownload, type Download } from "./download";
import { TIMING_MS } from "./tunables";

export type { Health, MutationResponse } from "@rockett/shared";
export const API = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ApiErrorCode,
    readonly detail?: string,
    readonly revision?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super(message, 401, "internal");
    this.name = "UnauthorizedError";
  }
}

let onUnauthorized: (() => void) | null = null;

export function watchUnauthorized(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body: Partial<ApiErrorBody> | null = await res.json().catch(() => null);
  const rawRetryAfter =
    res.status === 429 ? Number(res.headers.get("Retry-After")) : undefined;
  const retryAfter =
    rawRetryAfter !== undefined &&
    Number.isFinite(rawRetryAfter) &&
    rawRetryAfter > 0
      ? rawRetryAfter
      : undefined;
  if (res.status === 401)
    return new UnauthorizedError(
      typeof body?.error === "string" ? body.error : "Unauthenticated",
    );
  if (
    typeof body?.error === "string" &&
    (typeof body.code === "string" || res.status === 400 || res.status === 409)
  )
    return new ApiError(
      body.error,
      res.status,
      typeof body.code === "string" ? body.code : "internal",
      body.detail,
      body.revision,
      retryAfter,
    );
  return new ApiError(
    res.statusText || `HTTP ${res.status}`,
    res.status,
    "internal",
    undefined,
    undefined,
    retryAfter,
  );
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  keepalive?: boolean;
  jobId?: string;
  onEtag?: (etag: string | null) => void;
  unwatched?: boolean;
}

export type JobEvent =
  | { type: "start"; id: string }
  | { type: "progress"; id: string; label: string; done: number; total: number }
  | { type: "done" | "failed" | "cancelled"; id: string };

let onJob: ((event: JobEvent) => void) | null = null;
let activeJob: {
  id: string;
  source: EventSource | null;
  timer: ReturnType<typeof setTimeout>;
  settleTimer?: ReturnType<typeof setTimeout>;
} | null = null;

export function watchJob(handler: ((event: JobEvent) => void) | null): void {
  onJob = handler;
}

function startJob(id: string): void {
  forgetJob();
  if (typeof EventSource === "undefined") return;
  onJob?.({ type: "start", id });
  const timer = setTimeout(() => subscribeJob(id), TIMING_MS.jobHintDelay);
  activeJob = { id, source: null, timer };
}

function subscribeJob(id: string): void {
  if (activeJob?.id !== id) return;
  const source = new EventSource(
    API + pathFor(ROUTES.jobEvents, { jobId: id }),
  );
  activeJob.source = source;
  source.addEventListener("progress", (event) => {
    if (activeJob?.id !== id) return;
    let data: unknown;
    try {
      data = JSON.parse((event as MessageEvent).data);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    const { label, done, total } = data as Record<string, unknown>;
    if (
      typeof label === "string" &&
      typeof done === "number" &&
      typeof total === "number" &&
      Number.isFinite(done) &&
      Number.isFinite(total)
    )
      onJob?.({ type: "progress", id, label, done, total });
  });
  for (const type of ["done", "failed", "cancelled"] as const)
    source.addEventListener(type, () => {
      if (activeJob?.id !== id) return;
      forgetJob();
      onJob?.({ type, id });
    });
}

function settleJob(id: string): void {
  if (activeJob?.id !== id) return;
  if (activeJob.source) {
    activeJob.settleTimer = setTimeout(
      () => finishJob(id),
      TIMING_MS.jobTerminalWait,
    );
    return;
  }
  finishJob(id);
}

function finishJob(id: string): void {
  if (activeJob?.id !== id) return;
  forgetJob();
  onJob?.({ type: "done", id });
}

export function cancelJob(): Promise<{ ok: true }> {
  const id = activeJob?.id;
  return id
    ? request<{ ok: true }>(
        ROUTES.cancelJob.method,
        pathFor(ROUTES.cancelJob, { jobId: id }),
      )
    : Promise.resolve({ ok: true });
}

export function forgetJob(): void {
  if (activeJob) {
    clearTimeout(activeJob.timer);
    clearTimeout(activeJob.settleTimer);
    activeJob.source?.close();
  }
  activeJob = null;
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

let viewTag: { id: string; etag: string } | null = null;

function keepViewTag(id: string) {
  return (etag: string | null) => {
    viewTag = etag ? { id, etag } : null;
  };
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
    jobId,
    response,
    onEtag,
    unwatched,
  }: RequestOptions & { response?: "blob" } = {},
): Promise<unknown> {
  const raw = body instanceof FormData || body instanceof Blob;
  const watch = unwatched ? null : watching(path);
  const sent = {
    ...(body !== undefined && !raw && { "Content-Type": "application/json" }),
    ...headers,
    ...(jobId && { "Rockett-Job": jobId }),
  };
  const pending = fetch(API + path, {
    method,
    ...(Object.keys(sent).length > 0 && { headers: sent }),
    ...(body !== undefined && { body: raw ? body : JSON.stringify(body) }),
    ...(signal && { signal }),
    ...(keepalive && { keepalive }),
  }).catch((e: unknown) => {
    if (e instanceof Error && e.name === "AbortError") throw e;
    throw new ApiError("Could not reach the server.", 0, "internal");
  });
  if (jobId) startJob(jobId);
  const res = await pending.catch((error: unknown) => {
    if (jobId) finishJob(jobId);
    throw error;
  });
  if (!res.ok) {
    if (jobId) finishJob(jobId);
    const error = await toApiError(res);
    if (error instanceof UnauthorizedError) onUnauthorized?.();
    if (res.status === 404) watch?.onMissing();
    throw error;
  }
  if (jobId) settleJob(jobId);
  onEtag?.(res.headers.get("ETag")?.replace(/^W\//, "") ?? null);
  if (response !== "blob") {
    const json = await res.json();
    received(json?.document);
    if (
      method !== "GET" &&
      !headers?.[PREVIEW_HEADER] &&
      json?.document?.id === watch?.id
    )
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

interface Stamp {
  position?: number | undefined;
  tx?: string | undefined;
  seq?: number | undefined;
}

export function send<P extends string, Req, Res>(
  route: Route<P, Req, Res>,
  params: PathParams<P>,
  {
    body,
    signal,
    position,
    tx,
    seq,
    ifMatch,
    onEtag,
  }: {
    body?: Req;
    signal?: AbortSignal | undefined;
    ifMatch?: string | undefined;
    onEtag?: (etag: string | null) => void;
  } & Stamp = {},
): Promise<Res> {
  const query = position === undefined ? "" : `?position=${position}`;
  const id: string | undefined = (params as Partial<Record<string, string>>).id;
  const revision =
    DOCUMENT_EDITS(route) && id !== undefined ? revisions.get(id) : undefined;
  const match =
    ifMatch ?? (revision === undefined ? undefined : `"${revision}"`);
  return request<Res>(route.method, pathFor(route, params) + query, {
    body,
    signal,
    ...(onEtag && { onEtag }),
    ...((DOCUMENT_EDITS(route) || route === ROUTES.importProject) && {
      jobId: crypto.randomUUID(),
    }),
    headers: {
      ...(match !== undefined && { "If-Match": match }),
      ...(tx !== undefined && { [TX_HEADER]: tx }),
      ...(seq !== undefined && { [PREVIEW_HEADER]: String(seq) }),
    },
  });
}

function fileForm(name: string, file: File): FormData {
  const form = new FormData();
  form.append(name, file);
  return form;
}

export const api = {
  watchJob,
  cancelJob,
  forgetJob,
  authStatus: () => send(AUTH_ROUTES.status, {}),
  me: () => send(AUTH_ROUTES.me, {}),
  login: (username: string, password: string) =>
    send(AUTH_ROUTES.login, {}, { body: { username, password } }),
  setup: (
    token: string,
    username: string,
    displayName: string,
    password: string,
  ) =>
    send(
      AUTH_ROUTES.setup,
      {},
      { body: { token, username, displayName, password } },
    ),
  logout: () => send(AUTH_ROUTES.logout, {}),
  totpEnrol: () => send(AUTH_ROUTES.totpEnrol, {}),
  totpCode: (route: "totp" | "totpConfirm" | "totpOff", code: string) =>
    send(AUTH_ROUTES[route], {}, { body: { code } }),
  changePassword: (current: string, next: string) =>
    send(AUTH_ROUTES.passwordChange, {}, { body: { current, next } }),
  listUsers: () => send(AUTH_ROUTES.users, {}),
  createUser: (user: {
    email?: string;
    username: string;
    displayName: string;
    role: User["role"];
    password: string;
  }) => send(AUTH_ROUTES.userCreate, {}, { body: user }),
  patchUser: (
    id: string,
    patch: {
      role?: User["role"];
      status?: User["status"];
      password?: string;
      email?: string | null;
    },
  ) => send(AUTH_ROUTES.userPatch, { id }, { body: patch }),
  health: () => send(ROUTES.health, {}),
  formats: () => send(ROUTES.formats, {}),
  modules: () => send(ROUTES.modules, {}),
  importStep: (file: File, projectId?: string, signal?: AbortSignal) => {
    const options = { body: fileForm("file", file), signal };
    return projectId
      ? send(ROUTES.importInto, { id: projectId }, options)
      : send(ROUTES.importProject, {}, options);
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
  getProjectMembers: (id: string) => send(ROUTES.getProjectMembers, { id }),
  projectMembers: (
    id: string,
    owner: string | null,
    members: ProjectMember[],
  ) => send(ROUTES.projectMembers, { id }, { body: { owner, members } }),
  deleteProject: (id: string, keepalive = false, revision?: number | string) =>
    request<{ ok: true }>(
      ROUTES.deleteProject.method,
      pathFor(ROUTES.deleteProject, { id }),
      {
        keepalive,
        ...(revision !== undefined && {
          headers: {
            "If-Match":
              typeof revision === "number" ? `"${revision}"` : revision,
          },
        }),
      },
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
    send(ROUTES.evaluate, { id }, { position }),
  tangentEdges: (id: string, edge: EdgeRef, beforeFeatureId?: string) =>
    send(ROUTES.tangentEdges, { id }, { body: { edge, beforeFeatureId } }),
  sizeLimit: (id: string, feature: SizedFeature, position: number) =>
    send(ROUTES.sizeLimit, { id }, { body: { feature }, position }),

  updateParameters: (id: string, edit: ParameterEdit, stamp?: Stamp) =>
    send(ROUTES.updateParameters, { id }, { body: edit, ...stamp }),
  addFeature: (id: string, feature: Feature, tx?: string, seq?: number) =>
    send(ROUTES.addFeature, { id }, { body: { feature }, tx, seq }),
  updateFeature: (
    id: string,
    fid: string,
    feature: Partial<Feature>,
    position?: number,
    tx?: string,
    seq?: number,
    parameterBindings?: ParameterBinding[],
  ) =>
    send(
      ROUTES.updateFeature,
      { id, fid },
      {
        body: parameterBindings ? { feature, parameterBindings } : { feature },
        position,
        tx,
        seq,
      },
    ),
  deleteFeature: (id: string, fid: string, tx?: string) =>
    send(ROUTES.deleteFeature, { id, fid }, { tx }),
  setTimeline: (id: string, position: number, tx?: string) =>
    send(ROUTES.setTimeline, { id }, { body: { position }, tx }),
  undo: (id: string, position?: number) =>
    send(ROUTES.undo, { id }, { position }),
  redo: (id: string, position?: number) =>
    send(ROUTES.redo, { id }, { position }),
  commitPreview: (id: string, tx: string) =>
    send(ROUTES.commitPreview, { id, tx }),
  abortPreview: (id: string, tx: string) =>
    send(ROUTES.abortPreview, { id, tx }),
  history: (id: string) => send(ROUTES.history, { id }),
  createCheckpoint: (id: string, label: string) =>
    send(ROUTES.createCheckpoint, { id }, { body: { label } }),
  restoreHistory: (id: string, snapshot: string) =>
    send(ROUTES.restoreHistory, { id }, { body: { snapshot } }),
  updateBody: (id: string, bodyId: string, patch: BodyEdit, tx?: string) =>
    send(ROUTES.updateBody, { id, bodyId }, { body: patch, tx }),
  updateGroups: (id: string, groups: TreeGroup[], tx?: string) =>
    send(ROUTES.updateGroups, { id }, { body: { groups }, tx }),
  stageNamingUpgrade: (id: string, accept: NamingDecision[] = []) =>
    send(ROUTES.stageNamingUpgrade, { id }, { body: { accept } }),
  commitNamingUpgrade: (id: string, accept: NamingDecision[] = []) =>
    send(ROUTES.commitNamingUpgrade, { id }, { body: { accept } }),
  getView: (id: string) =>
    send(ROUTES.getView, { id }, { onEtag: keepViewTag(id) }),
  putView: (id: string, view: ProjectView) =>
    send(
      ROUTES.putView,
      { id },
      {
        body: view,
        ifMatch: viewTag?.id === id ? viewTag.etag : undefined,
        onEtag: keepViewTag(id),
      },
    ),

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

  getThumbnail: (id: string) =>
    request(ROUTES.getThumbnail.method, pathFor(ROUTES.getThumbnail, { id }), {
      response: "blob",
    }).then((d) => d.blob),
  putThumbnail: (id: string, png: Blob) =>
    send(ROUTES.putThumbnail, { id }, { body: png }),

  readAsset: (id: string, assetId: string) =>
    request(ROUTES.asset.method, pathFor(ROUTES.asset, { id, assetId }), {
      response: "blob",
    }).then((d) => d.blob),
};
