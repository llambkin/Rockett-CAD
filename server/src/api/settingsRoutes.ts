import type { Request, RequestHandler, Response } from "express";
import {
  ROUTES,
  SettingsError,
  type Route,
  type SettingsPatch,
} from "@rockett/shared";
import {
  SettingsConflict,
  type SettingsLayer,
  type SettingsStore,
} from "../store/settingsStore.js";

export function registerSettingsRoutes(
  on: (route: Route, ...handlers: RequestHandler[]) => void,
  wrap: (
    handler: (req: Request, res: Response) => Promise<void>,
  ) => RequestHandler,
  store: SettingsStore,
): void {
  const update = async (req: Request, res: Response, layer: SettingsLayer) => {
    const expected = req.get("If-Match");
    if (!expected)
      return void res.status(428).json({
        error: "Send If-Match with the settings ETag.",
        code: "precondition_required",
      });
    try {
      const values = await store.patch(
        layer,
        req.body as SettingsPatch,
        expected,
      );
      res.set("ETag", store.version(values)).json(values);
    } catch (err) {
      if (err instanceof SettingsConflict)
        return void res
          .status(409)
          .json({ error: err.message, code: "conflict" });
      if (!(err instanceof SettingsError)) throw err;
      res.status(400).json({
        error: "invalid settings",
        code: "validation",
        errors: err.errors.map((item) =>
          Object.assign({}, item, {
            path: `/set/${item.key}${item.path ?? ""}`,
          }),
        ),
      });
    }
  };

  on(
    ROUTES.appSettings,
    wrap(async (_req, res) => {
      const { values, version } = await store.readVersioned({ scope: "app" });
      res.set("ETag", version).json(values);
    }),
  );
  on(
    ROUTES.patchAppSettings,
    wrap(async (req, res) => {
      if (res.locals.user.role !== "admin")
        return void res.status(403).json({ error: "forbidden" });
      await update(req, res, { scope: "app" });
    }),
  );
  on(
    ROUTES.projectSettings,
    wrap(async (req, res) => {
      const { values, version } = await store.readVersioned({
        scope: "project",
        id: req.params.id as string,
      });
      res.set("ETag", version).json(values);
    }),
  );
  on(
    ROUTES.patchProjectSettings,
    wrap(async (req, res) => {
      await update(req, res, { scope: "project", id: req.params.id as string });
    }),
  );
}
