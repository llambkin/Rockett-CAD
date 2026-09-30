import { ROUTES, SCHEMA_VERSION } from "@rockett/shared";
import { build } from "../build.js";
import type { ApiRoutes } from "./projectMutations.js";

export function jobRoutes(context: ApiRoutes) {
  const { on, jobs } = context;
  on(ROUTES.jobEvents, jobs.events);
  on(ROUTES.cancelJob, jobs.cancel);
}

export function systemRoutes(context: ApiRoutes) {
  const { on, wrap, kernel } = context;
  on(ROUTES.health, (_req, res) => {
    if (!res.locals.user) return res.json({ ok: true });
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
}
