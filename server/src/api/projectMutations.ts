import {
  collectTopoRefs,
  editedEntities,
  resolveDocumentParameters,
  type CadDocument,
  type EvaluateResult,
  type Feature,
  type FeatureRunStatus,
  PREVIEW_HEADER,
  TX_HEADER,
  ValidationError,
  type User,
} from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";
import { backupNamespace } from "../store/jsonStore.js";
import { discarding } from "./uploads.js";
import { previewSequence, reply, transactionId } from "./revision.js";
import type { Edit } from "./routeModules.js";
import type { RouterContext } from "./routerContext.js";
import { evaluationPosition } from "./evaluationPosition.js";

const UNBUILT = new Set<FeatureRunStatus>(["cancelled", "rolledBack"]);

const previewOwner = (res: any, user: User): string => {
  const session: string | undefined = res.locals.session;
  if (!session) throw new Error("auth middleware missing");
  return `${user.id}/${session}`;
};

function resolvedFeatures(doc: CadDocument): Feature[] {
  try {
    return resolveDocumentParameters(doc).features;
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "Invalid parameters",
    );
  }
}

function solveEdits(doc: CadDocument, before: Feature[]) {
  const previous = new Map(before.map((feature) => [feature.id, feature]));
  const stored = new Map(doc.features.map((feature) => [feature.id, feature]));
  for (const feature of resolvedFeatures(doc)) {
    if (feature.type !== "sketch") continue;
    const old = previous.get(feature.id);
    const sketch = stored.get(feature.id);
    const solved = editedEntities(
      old?.type === "sketch" ? old.constraints : [],
      feature,
    );
    if (sketch?.type === "sketch" && solved !== feature.entities)
      sketch.entities = solved;
  }
}

async function refreshSigs(
  kernel: RouterContext["kernel"],
  doc: CadDocument,
  before: { features: Feature[]; timelinePosition: number },
  { featureStatuses }: EvaluateResult,
) {
  const previous = before.features.map((feature) => JSON.stringify(feature));
  const kept = new Set(previous);
  const after = resolvedFeatures(doc).map((feature) => JSON.stringify(feature));
  const changed = after.findIndex((key, i) => key !== previous[i]);
  const start = Math.min(
    changed < 0 ? after.length : changed,
    before.timelinePosition,
  );
  const requests = featureStatuses.flatMap(({ status }, position) => {
    if (position < start || UNBUILT.has(status) || !kept.has(after[position]!))
      return [];
    const refs = collectTopoRefs(doc.features[position]!).filter(
      (ref) => ref.sig,
    );
    return refs.length > 0 ? [{ position, refs }] : [];
  });
  if (requests.length === 0) return;
  const sigs = await kernel.signResolved(doc, requests);
  requests.forEach(({ refs }, i) =>
    refs.forEach((ref, j) => {
      const sig = sigs[i]![j];
      if (sig) ref.sig = sig;
    }),
  );
}

async function keeping(
  store: RouterContext["store"],
  id: string,
  revision: number,
  write: () => Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch (err) {
    const stored = (await store.documents.stored(id).catch(() => ({}))) as {
      revision?: unknown;
    };
    if (typeof stored.revision !== "number" || stored.revision <= revision)
      throw err;
    console.error(`[rockett] project ${id} kept an edit: ${String(err)}`);
    throw new StoreError(
      "Your edit was saved, but the server failed after saving it.",
      "kept",
    );
  }
}

const extensionVersions = (doc: CadDocument) =>
  new Map(
    Object.entries(doc.extensions).map(([id, { version }]) => [id, version]),
  );

async function backupRaised(
  store: RouterContext["store"],
  stored: Map<string, number>,
  doc: CadDocument,
): Promise<void> {
  const raised = Object.entries(doc.extensions).flatMap(([id, { version }]) => {
    const from = stored.get(id);
    return from !== undefined && version > from
      ? [`${id.replaceAll("-", "_")}.v${from}.v${version}`]
      : [];
  });
  if (!raised.length || (await store.isTemporary(doc.id))) return;
  const backup = backupNamespace(
    store.documents.options.storage,
    store.documents.dir(doc.id),
  );
  await store.documents.exclusive(doc.id, () =>
    backup.backup(raised.join("_")),
  );
}

const ended = () =>
  new StoreError("This preview has ended. Start it again.", "not_found");

function previewStage(context: RouterContext) {
  const {
    previews,
    editable,
    evaluateAndSync,
    meshCache,
    history,
    store,
    send,
    evaluate,
  } = context;
  const stage = async function stage(
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
      const before = structuredClone(resolvedFeatures(loaded));
      const { label, document = loaded } = await edit(loaded, req, { user });
      solveEdits(document, before);
      staged = { owner, seq, label: staged?.label ?? label!, document };
    }
    const { document } = staged;
    const evaluation = await evaluateAndSync(
      document,
      evaluationPosition(req, document),
    );
    previews.keep(id, tx, staged);
    reply(res, {
      document,
      evaluation: meshCache.publish(id, document.revision, evaluation, false),
      history: await history.status(id),
    });
  };

  async function sendStored(req: any, res: any) {
    const doc = await store.load(req.params.id);
    const position = evaluationPosition(req, doc);
    await send(res, doc, await evaluate(doc, position), undefined, position);
  }

  return { stage, sendStored };
}

export function createProjectMutations(context: RouterContext) {
  const {
    store,
    history,
    jobs,
    wrap,
    editable,
    send,
    evaluateAndSync,
    kernel,
  } = context;
  const { stage, sendStored } = previewStage(context);
  const mutateProject = (edit: Edit, previewable = false) =>
    wrap(
      discarding<{ user: User }>(store.uploads, async (req, res, ctx) => {
        const tx = transactionId(req.get(TX_HEADER));
        const seq = req.get(PREVIEW_HEADER);
        if (seq !== undefined) {
          if (!previewable || tx === undefined)
            throw new ValidationError(
              `A preview needs ${TX_HEADER} on a feature or parameter edit.`,
            );
          return stage(req, res, ctx.user, tx, previewSequence(seq), edit);
        }
        const loaded = await editable(req, res);
        const before = structuredClone(resolvedFeatures(loaded));
        const { timelinePosition, revision } = loaded;
        const versions = extensionVersions(loaded);
        const {
          label,
          cursor,
          position,
          document = loaded,
          after,
          ...extra
        } = await edit(loaded, req, ctx);
        const saved = label !== undefined && document === loaded;
        if (saved) solveEdits(document, before);
        const evaluation = await evaluateAndSync(document, position);
        if (saved)
          await refreshSigs(
            kernel,
            document,
            { features: before, timelinePosition },
            evaluation,
          );
        await backupRaised(store, versions, document);
        await keeping(store, loaded.id, revision, async () => {
          await (label === undefined
            ? history.move(document, cursor, ctx.user.id)
            : history.save(document, label, tx, ctx.user.id));
          if (typeof after === "function") await after();
          jobs.committed();
          await send(res, document, evaluation, extra, position);
        });
      }),
    );
  return {
    mutateProject,
    previewOwner,
    ended,
    sendStored,
    keeping: (id: string, revision: number, write: () => Promise<void>) =>
      keeping(store, id, revision, write),
    refreshSigs: (
      doc: CadDocument,
      before: CadDocument,
      evaluation: EvaluateResult,
    ) =>
      refreshSigs(
        kernel,
        doc,
        {
          features: resolvedFeatures(before),
          timelinePosition: before.timelinePosition,
        },
        evaluation,
      ),
  };
}

export type ApiRoutes = RouterContext &
  ReturnType<typeof createProjectMutations>;
