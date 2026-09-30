import { Router, json, type RequestHandler } from "express";
import {
  DOCUMENT_EDITS,
  ROUTES,
  type CadDocument,
  type EvaluateResult,
  type Method,
  type Route,
  type User,
} from "@rockett/shared";
import type { NoticeStore } from "../auth/noticeStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { FolderStore } from "../store/folderStore.js";
import type { ProjectQueue } from "../store/projectQueue.js";
import { HistoryStore, Previews } from "../store/historyStore.js";
import type { KernelClient } from "../kernel/client.js";
import { MeshCache } from "../kernel/meshCache.js";
import {
  IMPORT_LIMITS,
  JSON_BODY_LIMIT_BYTES,
  type ImportLimits,
} from "./uploads.js";
import { checkRevision, reply } from "./revision.js";
import { omitHeldMeshes } from "./heldMeshes.js";
import { projectAccessGuard } from "./projectAccess.js";
import { createJobRoutes } from "./jobRoutes.js";
import type { UserStore } from "../auth/userStore.js";
import type { FriendStore } from "../auth/friendStore.js";
import { fail, check, parseBody, requireRevision } from "./apiErrors.js";
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
    evaluation?: EvaluateResult,
    extra?: object,
    position?: number,
  ) => {
    if (evaluation)
      meshCache.publish(
        doc.id,
        doc.revision,
        evaluation.bodies,
        position === undefined || position === doc.timelinePosition,
      );
    return reply(res, {
      ...extra,
      document: doc,
      ...(evaluation && { evaluation, history: await history.status(doc.id) }),
    });
  };
}

function synchronisedEvaluation(
  evaluate: ReturnType<typeof createJobRoutes>["evaluate"],
) {
  return async function evaluateAndSync(doc: CadDocument, position?: number) {
    const evaluation = await evaluate(doc, position);
    let metaChanged = pruneGroups(doc, evaluation, position);
    for (const body of evaluation.bodies) {
      if (!doc.bodyMeta[body.bodyId]) {
        const n = (doc.counters["body"] ?? 0) + 1;
        doc.counters["body"] = n;
        doc.bodyMeta[body.bodyId] = { name: `Body${n}` };
        metaChanged = true;
      }
    }
    if (metaChanged)
      evaluation.bodies = evaluation.bodies.map((body) => ({
        ...body,
        name: doc.bodyMeta[body.bodyId]!.name,
      }));
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
) {
  const { uploadBytes } = { ...IMPORT_LIMITS, ...limits };
  const router = Router();
  const history = new HistoryStore(store.documents.options.storage, store);
  const previews = new Previews();
  const meshCache = new MeshCache();
  const jobs = createJobRoutes(store, kernel, fail);
  router.use(json({ limit: JSON_BODY_LIMIT_BYTES }), check(omitHeldMeshes));
  router.param("id", projectAccessGuard(store, folders));
  const on = (route: Route, ...handlers: RequestHandler[]) => {
    if (DOCUMENT_EDITS(route) && route.method === "GET")
      throw new Error(`document edit ${route.path} must use a write method`);
    const method = route.method.toLowerCase() as Lowercase<Method>;
    if (
      router.stack.some(
        ({ route: mounted }) =>
          mounted?.path === route.path &&
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
    history,
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
