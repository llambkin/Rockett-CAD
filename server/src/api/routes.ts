import { Router, json, type Request, type RequestHandler } from "express";
import {
  DOCUMENT_EDITS,
  lacksTargets,
  MB,
  NAME_LENGTH,
  nextFeatureName,
  parse,
  pinTargets,
  PREVIEW_HEADER,
  ROUTES,
  SCHEMA_VERSION,
  startFirst,
  TX_HEADER,
  ValidationError,
  type ApiErrorBody,
  type ApiErrorCode,
  type CadDocument,
  type EvaluateResult,
  type ExportRequest,
  type Feature,
  type Method,
  type Route,
  type SizedFeature,
  type User,
  unsignedRefs,
} from "@rockett/shared";
import { build } from "../build.js";
import type { NoticeStore } from "../auth/noticeStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import { splitView } from "../store/migrations.js";
import type { FolderStore } from "../store/folderStore.js";
import { StoreError } from "../store/projectStore.js";
import { etag } from "../store/jsonStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import { HistoryStore, Previews } from "../store/historyStore.js";
import { collectBlobs } from "../store/blobGc.js";
import { requireAdmin } from "../auth/users.js";
import {
  acceptedNamingUpgrade,
  namingUpgraded,
  stageNamingUpgrade,
} from "../store/namingUpgrade.js";
import { InProcessKernel, type KernelClient } from "../kernel/client.js";
import { MeshCache } from "../kernel/meshCache.js";
import { meshRoute } from "./meshRoute.js";
import {
  knownKeys,
  record,
  validateBuilt,
  validateDocument,
  validateFeature,
} from "./validate.js";
import {
  downloadProjectFile,
  safeFileName,
  uploadProjectFile,
} from "./projectFile.js";
import { folderRoutes, requireFolderDestination } from "./folderRoutes.js";
import { projectMemberHandlers } from "./projectMembers.js";
import {
  discarding,
  IMPORT_LIMITS,
  JSON_BODY_LIMIT_BYTES,
  readUpload,
  receiveImage,
  receiveImport,
  receiveProjectFile,
  receiveThumbnail,
  type ImportLimits,
  type Upload,
} from "./uploads.js";
import {
  checkRevision,
  ifMatchRevision,
  keepNamingVersion,
  previewSequence,
  reply,
  RevisionConflict,
  transactionId,
} from "./revision.js";
import { omitHeldMeshes } from "./heldMeshes.js";
import { projectAccessGuard, visibleProjects } from "./projectAccess.js";
import { createJobRoutes } from "./jobRoutes.js";
import { registerSettingsRoutes } from "./settingsRoutes.js";
import type { UserStore } from "../auth/userStore.js";
import type { FriendStore } from "../auth/friendStore.js";

const STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  too_large: 413,
  conflict: 409,
  precondition_required: 428,
  unprocessable: 422,
  kernel: 503,
  internal: 500,
};

function sendError(res: any, body: ApiErrorBody) {
  res.status(STATUS[body.code]).json(body);
}

function fail(req: Request, res: any, err: any) {
  const code: ApiErrorCode =
    err instanceof StoreError || err instanceof ValidationError
      ? err.code
      : "internal";
  if (code !== "internal")
    return sendError(res, {
      error: err.message,
      code,
      ...(err.detail !== undefined && { detail: err.detail }),
      ...(err instanceof RevisionConflict && {
        revision: err.revision,
        ...(err.draft && { draft: err.draft }),
      }),
    });
  console.error(`[rockett] 500 ${req.route?.path}: Internal server error`);
  sendError(res, { error: "Internal server error", code });
}

function check(test: (req: any, res: any) => void): RequestHandler {
  return (req, res, next) => {
    try {
      test(req, res);
    } catch (err) {
      return fail(req, res, err);
    }
    next();
  };
}

const parseBody = (schema: NonNullable<Route["body"]>) =>
  check((req) => (req.body = parse(schema, req.body ?? {})));

const requireRevision = check((req, res) => {
  res.locals.revision = ifMatchRevision(req.get("If-Match"));
});

type Mutation = (
  { label: string; cursor?: never } | { cursor: number; label?: never }
) & {
  document?: CadDocument;
  position?: number | undefined;
  [extra: string]: unknown;
};

type Edit = (doc: CadDocument, req: any) => Promise<Mutation>;

const KEEPS_TARGETS = new Set(["name", "suppressed"]);

function keepsTargets(patch: object): boolean {
  return (
    !("targets" in patch) &&
    Object.keys(patch).every((key) => KEEPS_TARGETS.has(key))
  );
}

function retargets(patch: object): boolean {
  return !("targets" in patch) && !keepsTargets(patch);
}

function evaluationPosition(req: any, doc: CadDocument): number | undefined {
  if (req.query.position === undefined) return undefined;
  const position = Number(req.query.position);
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > doc.features.length
  )
    throw new ValidationError("invalid evaluation position");
  return position;
}

function pruneGroups(
  doc: CadDocument,
  evaluation: EvaluateResult,
  position: number | undefined,
): boolean {
  const sketches = new Set(
    doc.features.filter((f) => f.type === "sketch").map((f) => f.id),
  );
  const bodies =
    position === undefined && doc.timelinePosition === doc.features.length
      ? new Set(evaluation.bodies.map((b) => b.bodyId))
      : null;
  let changed = false;
  for (const group of doc.groups) {
    const kept = group.members.filter((id) =>
      group.kind === "sketch" ? sketches.has(id) : (bodies?.has(id) ?? true),
    );
    changed ||= kept.length !== group.members.length;
    group.members = kept;
  }
  return changed;
}

export function createApiRouter(
  store: ProjectStore,
  folders: FolderStore,
  projects = new ProjectQueue(),
  limits: Partial<ImportLimits> = {},
  kernel: KernelClient = new InProcessKernel(store),
  users?: UserStore,
  notices?: NoticeStore,
  friends?: FriendStore,
): Router {
  const { uploadBytes, importBytes } = { ...IMPORT_LIMITS, ...limits };
  const router = Router();
  const history = new HistoryStore(store.documents.options.storage, store);
  const previews = new Previews();
  const meshCache = new MeshCache();
  const jobs = createJobRoutes(store, kernel, fail);
  router.use(json({ limit: JSON_BODY_LIMIT_BYTES }), check(omitHeldMeshes));
  router.param("id", projectAccessGuard(store, folders));
  const on = (route: Route, ...handlers: RequestHandler[]) =>
    router[route.method.toLowerCase() as Lowercase<Method>](
      route.path,
      ...(route.body ? [parseBody(route.body)] : []),
      ...(DOCUMENT_EDITS.has(route) ? [requireRevision] : []),
      ...(route === ROUTES.jobEvents || route === ROUTES.cancelJob
        ? []
        : [jobs.start]),
      ...handlers,
    );

  on(ROUTES.jobEvents, jobs.events);
  on(ROUTES.cancelJob, jobs.cancel);
  const evaluate = jobs.evaluate;

  // Serialize the whole load/edit/save/evaluate operation for each project.
  // Locking only save() would still allow two requests to edit stale copies.
  const wrap =
    (fn: (req: any, res: any, ctx: { user: User }) => Promise<void>) =>
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

  registerSettingsRoutes(on, wrap, store.settings);

  const editable = async (req: any, res: any) => {
    const doc = await store.load(req.params.id);
    checkRevision(doc, res.locals.revision);
    return doc;
  };

  const send = async (
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

  async function pinned(
    doc: CadDocument,
    index: number,
    hidden: string[] = [],
  ) {
    const feature = doc.features[index]!;
    if (lacksTargets(feature))
      pinTargets(feature, await kernel.visibleTargets(doc, index, hidden));
  }

  async function written(doc: CadDocument, index: number, user: User) {
    await pinned(doc, index, (await store.view(doc.id, user.id)).hidden.bodies);
    startFirst(doc.features[index]!);
  }

  async function signed(
    doc: CadDocument,
    index: number,
    feature: Feature,
    previous?: Feature,
  ) {
    const refs = unsignedRefs(feature, previous);
    if (!refs.length) return;
    const sigs = await kernel.stateQuery(doc, {
      kind: "sign",
      position: index,
      refs,
    });
    refs.forEach((ref, i) => {
      const sig = sigs[i];
      if (sig) ref.sig = sig;
    });
  }

  async function evaluateAndSync(doc: CadDocument, position?: number) {
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
  }

  const previewOwner = (res: any, user: User): string => {
    const session: string | undefined = res.locals.session;
    if (!session) throw new Error("auth middleware missing");
    return `${user.id}/${session}`;
  };

  const ended = () =>
    new StoreError("This preview has ended. Start it again.", "not_found");

  async function stage(
    req: any,
    res: any,
    user: User,
    tx: string,
    seq: number,
    edit: Edit,
  ) {
    const { id } = req.params;
    const owner = previewOwner(res, user);
    const open = previews.find(id, tx, owner);
    if (!open && seq !== 1) throw ended();
    let staged = open;
    if (!staged || seq > staged.seq) {
      const loaded = staged
        ? structuredClone(staged.document)
        : await editable(req, res);
      const { label, document = loaded } = await edit(loaded, req);
      staged = { owner, seq, label: staged?.label ?? label!, document };
    }
    const { document } = staged;
    const evaluation = await evaluateAndSync(
      document,
      evaluationPosition(req, document),
    );
    previews.keep(id, tx, staged);
    meshCache.publish(id, document.revision, evaluation.bodies, false);
    reply(res, { document, evaluation, history: await history.status(id) });
  }

  async function sendStored(req: any, res: any) {
    const doc = await store.load(req.params.id);
    const position = evaluationPosition(req, doc);
    await send(res, doc, await evaluate(doc, position), undefined, position);
  }

  const mutateProject = (edit: Edit, previewable = false) =>
    wrap(
      discarding<{ user: User }>(store.uploads, async (req, res, ctx) => {
        const tx = transactionId(req.get(TX_HEADER));
        const seq = req.get(PREVIEW_HEADER);
        if (seq !== undefined) {
          if (!previewable || tx === undefined)
            throw new ValidationError(
              `A preview needs ${TX_HEADER} on a feature add or edit.`,
            );
          return stage(req, res, ctx.user, tx, previewSequence(seq), edit);
        }
        const loaded = await editable(req, res);
        const {
          label,
          cursor,
          position,
          document = loaded,
          ...extra
        } = await edit(loaded, req);
        const evaluation = await evaluateAndSync(document, position);
        await (label === undefined
          ? history.move(document, cursor, ctx.user.id)
          : history.save(document, label, tx, ctx.user.id));
        jobs.committed();
        await send(res, document, evaluation, extra, position);
      }),
    );

  on(ROUTES.health, (_req, res) => {
    res.json({
      ok: true,
      ...build(),
      schemaVersion: SCHEMA_VERSION,
      describe: process.env.ROCKETT_DESCRIBE || null,
      kernelVersion: kernel.version(),
      kernel: kernel.status(),
    });
  });

  on(
    ROUTES.formats,
    wrap(async (_req, res) => {
      res.json(await kernel.formats());
    }),
  );

  on(
    ROUTES.listProjects,
    wrap(async (_req, res, ctx) => {
      const named = new Map(
        (await users?.list())?.map((user) => [user.id, user.displayName]) ?? [],
      );
      const listed = await visibleProjects(store, folders, ctx.user);
      res.json(
        await Promise.all(
          listed.map(async (project) => {
            const access = await store
              .projectAccess(project.id)
              .catch((error) => {
                if (project.status !== "ok") return null;
                throw error;
              });
            const owner = access?.owner ?? null;
            return Object.assign(project, {
              owner,
              ownerName:
                access === null
                  ? "Unavailable"
                  : owner
                    ? (named.get(owner) ?? owner)
                    : null,
            });
          }),
        ),
      );
    }),
  );

  const members = projectMemberHandlers(store, users, notices, friends);
  on(ROUTES.projectMembers, wrap(members.put));
  on(ROUTES.getProjectMembers, wrap(members.get));

  on(
    ROUTES.createProject,
    wrap(async (req, res, ctx) => {
      const name = (req.body.name ?? "Untitled").slice(0, NAME_LENGTH);
      const { folderId } = req.body;
      if (folderId !== undefined)
        await requireFolderDestination(folders, ctx.user, folderId);
      const doc =
        folderId === undefined
          ? await store.create(name, ctx.user.id)
          : await folders.createIn(folderId, () =>
              store.create(name, ctx.user.id),
            );
      res.json({ document: doc });
    }),
  );

  on(ROUTES.downloadProjectFile, wrap(downloadProjectFile(store)));
  on(
    ROUTES.uploadProjectFile,
    receiveProjectFile,
    wrap(uploadProjectFile(store, folders)),
  );

  on(
    ROUTES.getProject,
    wrap(async (req, res) => {
      await send(res, await store.load(req.params.id));
    }),
  );

  on(
    ROUTES.deleteProject,
    wrap(async (req, res) => {
      await store.remove(req.params.id);
      kernel.drop(req.params.id);
      meshCache.drop(req.params.id);
      await folders.place(req.params.id, null);
      res.json({ ok: true });
    }),
  );

  on(
    ROUTES.duplicateProject,
    wrap(async (req, res, ctx) => {
      const copy = await store.duplicate(
        req.params.id,
        req.body.name ? req.body.name.slice(0, NAME_LENGTH) : undefined,
        ctx.user.id,
      );
      res.json({ document: copy });
    }),
  );

  on(
    ROUTES.renameProject,
    wrap(async (req, res, ctx) => {
      const doc = await editable(req, res);
      doc.name = (req.body.name ?? doc.name).slice(0, NAME_LENGTH);
      await history.save(doc, undefined, undefined, ctx.user.id);
      await send(res, doc);
    }),
  );

  for (const [route, handler] of folderRoutes(
    folders,
    store,
    users,
    notices,
    friends,
  ))
    on(route, wrap(handler));

  on(ROUTES.mesh, wrap(meshRoute(store, meshCache, evaluate)));

  on(
    ROUTES.evaluate,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const position = evaluationPosition(req, doc);
      const result = await evaluate(doc, position);
      meshCache.publish(
        doc.id,
        doc.revision,
        result.bodies,
        position === undefined || position === doc.timelinePosition,
      );
      res.json(result);
    }),
  );

  on(
    ROUTES.replaceDocument,
    mutateProject(async (stored, req) => {
      const sent = req.body?.document;
      if (!sent || sent.id !== req.params.id)
        throw new ValidationError("document id mismatch");
      validateDocument(sent);
      const document = splitView(sent).doc as unknown as CadDocument;
      const position = evaluationPosition(req, document);
      if (!(await namingUpgraded(store, stored.id)))
        keepNamingVersion(stored, document);
      return { label: "Replace document", document, position };
    }),
  );

  const receiveStep = receiveImport(store.uploads, uploadBytes);
  type Received = Awaited<ReturnType<typeof received>>;
  async function received(req: any) {
    const file: Upload | undefined = req.file;
    const imported = await kernel.importStep(
      file && {
        name: file.originalname,
        bytes: () => readUpload(store.uploads, file, importBytes),
      },
    );
    imported.features.forEach(validateFeature);
    return { ...imported, file: file! };
  }
  async function insert(doc: CadDocument, upload: Received) {
    const { file, label, features, sources } = upload;
    try {
      const at = Math.min(doc.timelinePosition, doc.features.length);
      doc.features.splice(at, 0, ...features);
      doc.timelinePosition = at + features.length;
      if (Buffer.byteLength(JSON.stringify(doc), "utf8") > 40 * MB)
        throw new ValidationError(
          `This import would exceed the 40 MB project limit. Start a separate project for this ${label} file.`,
        );
      const evaluation = await evaluate(doc, undefined, sources);
      for (const feature of features) {
        const status = evaluation.featureStatuses.find(
          (s) => s.featureId === feature.id,
        );
        if (status?.status !== "ok" && status?.status !== "warning")
          throw new ValidationError(status?.error ?? `${label} import failed`);
      }
      for (const [hash, bytes] of sources)
        await (hash === file.hash
          ? store.blobs(doc.id).adopt(file)
          : store.blobs(doc.id).put(bytes));
      return { label: `Import ${upload.filename}` };
    } catch (error) {
      kernel.drop(doc.id);
      throw error;
    }
  }
  on(
    ROUTES.importStep,
    receiveStep,
    wrap(
      discarding<{ user: User }>(store.uploads, async (req, res, ctx) => {
        const upload = await received(req);
        const doc = await store.create(
          upload.filename.replace(/\.[^.]*$/, ""),
          ctx.user.id,
        );
        jobs.bindProject(doc.id);
        try {
          await insert(doc, upload);
          const evaluation = await evaluateAndSync(doc);
          await store.save(doc, ctx.user.id);
          await send(res, doc, evaluation);
        } catch (error) {
          kernel.drop(doc.id);
          await store.remove(doc.id);
          jobs.bindProject(null);
          throw error;
        }
      }),
    ),
  );
  on(
    ROUTES.importStepInto,
    receiveStep,
    mutateProject(async (doc, req) => insert(doc, await received(req))),
  );

  on(
    ROUTES.addFeature,
    mutateProject(async (doc, req) => {
      const feature = req.body?.feature as Feature;
      record(feature, "feature");
      knownKeys(feature, feature.type);
      feature.name ||= nextFeatureName(doc, feature.type);
      validateFeature(feature);
      if (doc.features.some((f) => f.id === feature.id))
        throw new ValidationError("duplicate feature id");
      const at = Math.min(doc.timelinePosition, doc.features.length);
      if (
        feature.type === "sketch" &&
        feature.plane.kind === "face" &&
        feature.entities.length === 0
      ) {
        feature.entities = await kernel.stateQuery(doc, {
          kind: "projectFace",
          position: at,
          face: feature.plane.face,
        });
        validateBuilt(feature);
      }
      await signed(doc, at, feature);
      doc.features.splice(at, 0, feature);
      doc.timelinePosition = at + 1;
      await written(doc, at, req.res.locals.user);
      return { label: `Add ${feature.name}` };
    }, true),
  );

  on(
    ROUTES.updateFeature,
    mutateProject(async (doc, req) => {
      const position = evaluationPosition(req, doc);
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      const current = doc.features[idx];
      if (!current) throw new StoreError("feature not found", "not_found");
      const patch = req.body?.feature as Partial<Feature>;
      record(patch, "feature");
      if (patch.type !== undefined && patch.type !== current.type)
        throw new ValidationError("feature type cannot change");
      knownKeys(patch, current.type);
      const updated = { ...current, ...patch, id: current.id } as Feature;
      if (retargets(patch)) Reflect.deleteProperty(updated, "targets");
      validateFeature(updated);
      await signed(doc, idx, updated, current);
      doc.features[idx] = updated;
      await (keepsTargets(patch)
        ? pinned(doc, idx)
        : written(doc, idx, req.res.locals.user));
      return { label: `Edit ${updated.name}`, position };
    }, true),
  );

  // Resolve against geometry BEFORE the sketch, so projections cannot depend
  // on their own extrude or another downstream feature. This is read-only.
  on(
    ROUTES.projectEdge,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const index = doc.features.findIndex((f) => f.id === req.params.fid);
      const sketch = doc.features[index];
      if (!sketch || sketch.type !== "sketch")
        throw new ValidationError("Sketch not found");
      const { edge, entityId } = req.body;
      res.json({
        entities: await kernel.stateQuery(doc, {
          kind: "projectEdge",
          position: index,
          plane: sketch.plane,
          edge,
          entityId,
        }),
      });
    }),
  );

  on(
    ROUTES.deleteFeature,
    mutateProject(async (doc, req) => {
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      if (idx < 0) throw new StoreError("feature not found", "not_found");
      const [deleted] = doc.features.splice(idx, 1);
      if (doc.timelinePosition > idx) doc.timelinePosition--;
      return { label: `Delete ${deleted!.name}` };
    }),
  );

  on(
    ROUTES.setTimeline,
    mutateProject(async (doc, req) => {
      const { position } = req.body;
      if (position > doc.features.length)
        throw new ValidationError("invalid timeline position", "/position");
      doc.timelinePosition = position;
      return { label: "Roll timeline" };
    }),
  );

  const moveCursor = (step: -1 | 1) =>
    mutateProject(async (current, req) => {
      const { document, cursor } = await history.peek(current, step);
      validateDocument(document);
      return { cursor, document, position: evaluationPosition(req, document) };
    });
  on(ROUTES.undo, moveCursor(-1));
  on(ROUTES.redo, moveCursor(1));

  on(
    ROUTES.commitPreview,
    wrap(async (req, res, ctx) => {
      const { id, tx } = req.params;
      transactionId(tx);
      const open = previews.find(id, tx, previewOwner(res, ctx.user));
      if (!open) {
        const done = (await history.read(id))?.entries.some(
          (entry) => entry.tx === tx,
        );
        if (!done) throw ended();
        return sendStored(req, res);
      }
      const { document, label } = open;
      const stored = await store.load(id);
      if (stored.revision !== document.revision)
        throw new RevisionConflict(stored.revision, document);
      const position = evaluationPosition(req, document);
      const evaluation = await evaluateAndSync(document, position);
      await history.save(document, label, tx, ctx.user.id);
      previews.end(id, tx);
      jobs.committed();
      await send(res, document, evaluation, undefined, position);
    }),
  );
  on(
    ROUTES.abortPreview,
    wrap(async (req, res, ctx) => {
      const { id, tx } = req.params;
      transactionId(tx);
      previews.find(id, tx, previewOwner(res, ctx.user));
      previews.end(id, tx);
      await sendStored(req, res);
    }),
  );

  on(
    ROUTES.history,
    wrap(async (req, res) => res.json(await history.list(req.params.id))),
  );
  on(
    ROUTES.createCheckpoint,
    wrap(async (req, res) =>
      res.json({
        checkpoint: await history.checkpoint(req.params.id, req.body.label),
      }),
    ),
  );
  on(
    ROUTES.restoreHistory,
    mutateProject(async (current, req) => {
      const restored = await history.restore(current, req.body.snapshot);
      validateDocument(restored.document);
      return restored;
    }),
  );

  on(
    ROUTES.tangentEdges,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const { edge, beforeFeatureId } = req.body;
      const index = doc.features.findIndex((f) => f.id === beforeFeatureId);
      res.json({
        edges: await kernel.stateQuery(doc, {
          kind: "tangentEdges",
          position: index === -1 ? undefined : index,
          edge,
        }),
      });
    }),
  );

  on(
    ROUTES.updateGroups,
    mutateProject(async (doc, req) => {
      doc.groups = req.body.groups;
      return { label: "Edit groups" };
    }),
  );

  on(
    ROUTES.updateBody,
    mutateProject(async (doc, req) => {
      const meta = doc.bodyMeta[req.params.bodyId];
      if (!meta) throw new StoreError("body not found", "not_found");
      const label = `Rename ${meta.name}`;
      if (req.body.name !== undefined)
        meta.name = req.body.name.slice(0, NAME_LENGTH);
      return { label };
    }),
  );

  on(
    ROUTES.stageNamingUpgrade,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      res.json(await stageNamingUpgrade(store, kernel, doc, req.body.accept));
    }),
  );

  on(
    ROUTES.commitNamingUpgrade,
    mutateProject(async (doc, req) => ({
      label: "Upgrade naming",
      ...(await acceptedNamingUpgrade(store, kernel, doc, req.body.accept)),
    })),
  );

  on(
    ROUTES.collectBlobs,
    requireAdmin,
    wrap(async (req, res) => {
      const { id } = req.params;
      res.json(
        await collectBlobs(
          store,
          id,
          previews.documents(id),
          req.body.dryRun ?? true,
        ),
      );
    }),
  );

  on(
    ROUTES.getThumbnail,
    wrap(async (req, res) => {
      const { data, tag } = await store.thumbnails.read(req.params.id);
      res
        .set({ ETag: tag, "Cache-Control": "no-cache" })
        .type("png")
        .send(data);
    }),
  );

  on(
    ROUTES.putThumbnail,
    receiveThumbnail,
    wrap(async (req, res) => {
      const tag = await store.thumbnails.write(req.params.id, req.body);
      res.set("ETag", tag).json({ ok: true });
    }),
  );

  on(
    ROUTES.getView,
    wrap(async (req, res, ctx) => {
      const view = await store.view(req.params.id, ctx.user.id);
      res.set("ETag", etag(view)).json(view);
    }),
  );

  on(
    ROUTES.putView,
    wrap(async (req, res, ctx) => {
      const view = await store.setView(
        req.params.id,
        ctx.user.id,
        req.body,
        req.get("If-Match"),
      );
      res.set("ETag", etag(view)).json(view);
    }),
  );

  on(
    ROUTES.sizeLimit,
    wrap(async (req, res) => {
      const feature = req.body?.feature as SizedFeature;
      record(feature, "feature");
      if (!["fillet", "chamfer", "shell"].includes(feature.type))
        throw new ValidationError(
          "size limits cover fillet, chamfer and shell",
        );
      const doc = await store.load(req.params.id);
      knownKeys(feature, feature.type);
      feature.name ||= nextFeatureName(doc, feature.type);
      validateFeature(feature);
      res.json(
        await kernel.stateQuery(doc, {
          kind: "sizeLimit",
          position: evaluationPosition(req, doc),
          feature,
        }),
      );
    }),
  );

  on(
    ROUTES.measure,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      res.json(
        await kernel.stateQuery(doc, { kind: "measure", request: req.body }),
      );
    }),
  );

  on(
    ROUTES.exportModel,
    wrap(async (req, res, ctx) => {
      if (req.body.retain && res.locals.projectRole === "view")
        return res.status(403).json({ error: "forbidden" });
      const doc = await store.load(req.params.id);
      const view = await store.view(doc.id, ctx.user.id);
      const { retain, ...request }: ExportRequest = req.body;
      const { data, mime, ext } = await kernel.export(doc, {
        ...request,
        hidden: view.hidden.bodies,
      });
      const fileName = `${safeFileName(doc.name) || "model"}.${ext}`;
      res.setHeader("Content-Type", mime);
      if (retain) {
        await store.saveExport(doc.id, fileName, data);
      }
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      res.send(data);
    }),
  );

  on(
    ROUTES.uploadImage,
    receiveImage,
    wrap(async (req, res) => {
      await store.load(req.params.id); // ensure project exists
      if (!req.file) throw new ValidationError("image file required");
      const { assetId } = await store.saveAsset(req.params.id, req.file.buffer);
      res.json({ assetId });
    }),
  );

  on(
    ROUTES.asset,
    wrap(async (req, res) => {
      const asset = await store.readAsset(req.params.id, req.params.assetId);
      res.type(asset.mime).send(asset.data);
    }),
  );

  return router;
}
