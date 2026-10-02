import { ROUTES } from "@rockett/shared";
import { etag } from "../store/jsonStore.js";
import { collectBlobs } from "../store/blobGc.js";
import { requireAdmin } from "../auth/users.js";
import {
  acceptedNamingUpgrade,
  stageNamingUpgrade,
  upgradeViews,
} from "../store/namingUpgrade.js";
import { receiveThumbnail } from "./uploads.js";
import type { ApiRoutes } from "./projectMutations.js";

function namingRoutes(context: ApiRoutes) {
  const { on, wrap, store, kernel, previews, mutateProject } = context;
  on(
    ROUTES.stageNamingUpgrade,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      res.json(await stageNamingUpgrade(store, kernel, doc, req.body.accept));
    }),
  );

  on(
    ROUTES.commitNamingUpgrade,
    mutateProject(async (doc, req) => {
      const plan = await acceptedNamingUpgrade(
        store,
        kernel,
        doc,
        req.body.accept,
      );
      return {
        label: "Upgrade naming",
        ...plan,
        after: () => upgradeViews(store, doc.id, plan.mappings),
      };
    }),
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
}

function viewRoutes(context: ApiRoutes) {
  const { on, wrap, store } = context;
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
}

export function documentRoutes(context: ApiRoutes) {
  const { on, mutateProject } = context;
  on(
    ROUTES.updateParameters,
    mutateProject(async (doc, req) => {
      doc.parameters = req.body.parameters;
      doc.parameterBindings = req.body.parameterBindings;
      return { label: "Edit parameters" };
    }, true),
  );
  namingRoutes(context);
  viewRoutes(context);
}
