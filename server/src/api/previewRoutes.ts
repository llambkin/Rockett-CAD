import { ROUTES } from "@rockett/shared";
import { validateDocument } from "./validate.js";
import { RevisionConflict, transactionId } from "./revision.js";
import type { ApiRoutes } from "./projectMutations.js";
import { evaluationPosition } from "./evaluationPosition.js";

export function previewRoutes(context: ApiRoutes) {
  const {
    on,
    wrap,
    mutateProject,
    history,
    previews,
    store,
    previewOwner,
    ended,
    sendStored,
    evaluateAndSync,
    jobs,
    send,
  } = context;
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
}
