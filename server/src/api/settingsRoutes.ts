import type { Request, RequestHandler, Response } from "express";
import {
  ROUTES,
  SettingsError,
  type Route,
  type SettingsPatch,
} from "@rockett/shared";
import type { SettingsLayer, SettingsStore } from "../store/settingsStore.js";

export function registerSettingsRoutes(
  on: (route: Route, ...handlers: RequestHandler[]) => void,
  wrap: (
    handler: (req: Request, res: Response) => Promise<void>,
  ) => RequestHandler,
  store: SettingsStore,
): void {
  const update = async (req: Request, res: Response, layer: SettingsLayer) => {
    try {
      res.json(await store.patch(layer, req.body as SettingsPatch));
    } catch (err) {
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
      res.json(await store.read({ scope: "app" }));
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
      res.json(
        await store.read({ scope: "project", id: req.params.id as string }),
      );
    }),
  );
  on(
    ROUTES.patchProjectSettings,
    wrap(async (req, res) => {
      await update(req, res, { scope: "project", id: req.params.id as string });
    }),
  );
}
