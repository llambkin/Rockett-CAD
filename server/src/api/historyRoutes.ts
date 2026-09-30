import { ROUTES, type HistoryMark } from "@rockett/shared";
import { validateDocument } from "./validate.js";
import type { UserStore } from "../auth/userStore.js";
import type { ApiRoutes } from "./projectMutations.js";
import { userNames } from "./projectRoutes.js";
async function markNames(users?: UserStore) {
  const named = await userNames(users);
  return (mark: HistoryMark) =>
    mark.by ? { ...mark, byName: named.get(mark.by) ?? mark.by } : mark;
}

export function historyRoutes(context: ApiRoutes) {
  const { on, wrap, history, users, mutateProject } = context;
  on(
    ROUTES.history,
    wrap(async (req, res) => {
      const list = await history.list(req.params.id);
      const name = await markNames(users);
      res.json({
        ...list,
        entries: list.entries.map(name),
        checkpoints: list.checkpoints.map(name),
      });
    }),
  );
  on(
    ROUTES.createCheckpoint,
    wrap(async (req, res, ctx) => {
      const { id } = req.params;
      const mark = await history.checkpoint(id, req.body.label, ctx.user.id);
      res.json({ checkpoint: (await markNames(users))(mark) });
    }),
  );
  on(
    ROUTES.restoreHistory,
    mutateProject(async (current, req) => {
      const restored = await history.restore(current, req.body.snapshot);
      validateDocument(restored.document);
      return restored;
    }),
  );
}
