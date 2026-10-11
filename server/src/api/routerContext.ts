import { Router, json, type RequestHandler } from "express";
import {
  DOCUMENT_EDITS,
  moduleBody,
  NAME_LENGTH,
  ROUTES,
  type BodyPayload,
  type CadDocument,
  type MeshedEvaluation,
  type Method,
  type Route,
  type User,
} from "@rockett/shared";
import type { NoticeStore } from "../auth/noticeStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { FolderStore } from "../store/folderStore.js";
import type { ProjectQueue } from "../store/projectQueue.js";
import { HistoryStore, Previews } from "../store/historyStore.js";
import { AssemblyStore } from "../assembly/store.js";
import type { KernelClient } from "../kernel/client.js";
import { MeshCache } from "../kernel/meshCache.js";
import { JSON_BODY_LIMIT_BYTES } from "./uploads.js";
import { IMPORT_LIMITS, type ImportLimits } from "../tunables.js";
import { checkRevision, reply } from "./revision.js";
import { projectAccessGuard } from "./projectAccess.js";
import { createJobRoutes } from "./jobRoutes.js";
import type { UserStore } from "../auth/userStore.js";
import type { FriendStore } from "../auth/friendStore.js";
import { fail, parseBody, requireRevision } from "./apiErrors.js";
import { pruneGroups } from "./bodyRoutes.js";
function projectWrapper(
  store: ProjectStore,
  projects: ProjectQueue,
  jobs: ReturnType<typeof createJobRoutes>,
) {
  return (fn: (req: any, res: any, ctx: { user: User }) => Promise<void>) =>
    (req: any, res: any) => {
      const user: User | undefined = res.locals.user;
      if (!user) return fail(req, res, new Error("auth middleware missing"));
      const ctx = { user };
      const { id } = req.params;
      const result = id
        ? projects.run(id, () => store.touch(id).then(() => fn(req, res, ctx)))
        : fn(req, res, ctx);
      void result.then(jobs.settled, jobs.settled);
      result.catch((err) => fail(req, res, err));
    };
}

function projectReply(history: HistoryStore, meshCache: MeshCache) {
  return async (
    res: any,
    doc: CadDocument,
    meshed?: MeshedEvaluation,
    extra?: object,
    position?: number,
  ) => {
    const evaluation =
      meshed &&
      meshCache.publish(
        doc.id,
        doc.revision,
        meshed,
        position === undefined || position === doc.timelinePosition,
      );
    return reply(res, {
      ...extra,
      document: doc,
      ...(evaluation && { evaluation, history: await history.status(doc.id) }),
    });
  };
}

function seededName(doc: CadDocument, { bodyId, name }: BodyPayload) {
  const base = name === bodyId ? "" : name;
  if (!base) {
    const n = (doc.counters["body"] ?? 0) + 1;
    doc.counters["body"] = n;
    return `Body${n}`;
  }
  const taken = new Set(Object.values(doc.bodyMeta).map((meta) => meta.name));
  let free = base;
  for (let n = 2; taken.has(free); n++)
    free = `${base.slice(0, NAME_LENGTH - `${n}`.length - 3)} (${n})`;
  return free;
}

function synchronisedEvaluation(
  evaluate: ReturnType<typeof createJobRoutes>["evaluate"],
) {
  return async function evaluateAndSync(doc: CadDocument, position?: number) {
    const evaluation = await evaluate(doc, position);
    let metaChanged = pruneGroups(doc, evaluation, position);
    for (const body of evaluation.bodies) {
      const meta = doc.bodyMeta[body.bodyId];
      const owned = moduleBody(body.bodyId);
      if (meta && (!owned || meta.name === body.name)) continue;
      doc.bodyMeta[body.bodyId] = owned
        ? { ...meta, name: body.name }
        : { name: seededName(doc, body) };
      metaChanged = true;
    }
    if (metaChanged)
      for (const body of evaluation.bodies)
        body.name = doc.bodyMeta[body.bodyId]!.name;
    return evaluation;
  };
}

export function createRouterContext(
  store: ProjectStore,
  folders: FolderStore,
  projects: ProjectQueue,
  limits: Partial<ImportLimits>,
  kernel: KernelClient,
  users?: UserStore,
  notices?: NoticeStore,
  friends?: FriendStore,
  meshDir?: string,
) {
  const { uploadBytes, importBytes } = { ...IMPORT_LIMITS, ...limits };
  const router = Router();
  const history = new HistoryStore(store.documents.options.storage, store);
  const assemblies = new AssemblyStore(store);
  const previews = new Previews();
  const meshCache = new MeshCache({}, meshDir);
  const jobs = createJobRoutes(store, kernel, fail);
  router.use(json({ limit: JSON_BODY_LIMIT_BYTES }));
  router.param("id", projectAccessGuard(store, folders));
  const on = (route: Route, ...handlers: RequestHandler[]) => {
    if (DOCUMENT_EDITS(route) && route.method === "GET")
      throw new Error(`document edit ${route.path} must use a write method`);
    const method = route.method.toLowerCase() as Lowercase<Method>;
    if (
      router.stack.some(
        ({ route: mounted }) =>
          mounted?.path === route.path &&
          ("effect" in mounted ? mounted.effect : undefined) !== route.effect &&
          mounted.stack.some((layer) => layer.method === method),
      )
    )
      throw new Error(`route ${route.method} ${route.path} is already mounted`);
    return Object.assign(router.route(route.path), { effect: route.effect })[
      method
    ](
      ...(route.body ? [parseBody(route.body)] : []),
      ...(DOCUMENT_EDITS(route) ? [requireRevision] : []),
      ...(route === ROUTES.jobEvents || route === ROUTES.cancelJob
        ? []
        : [jobs.start]),
      ...handlers,
    );
  };

  const evaluate = jobs.evaluate;
  const wrap = projectWrapper(store, projects, jobs);
  const send = projectReply(history, meshCache);
  const evaluateAndSync = synchronisedEvaluation(evaluate);

  const editable = async (req: any, res: any) => {
    const doc = await store.load(req.params.id);
    checkRevision(doc, res.locals.revision);
    return doc;
  };

  return {
    router,
    store,
    folders,
    kernel,
    users,
    notices,
    friends,
    uploadBytes,
    importBytes,
    history,
    assemblies,
    previews,
    meshCache,
    jobs,
    on,
    evaluate,
    wrap,
    editable,
    send,
    evaluateAndSync,
  };
}

export type RouterContext = ReturnType<typeof createRouterContext>;
