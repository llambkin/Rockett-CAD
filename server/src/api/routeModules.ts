import type { RequestHandler } from "express";
import type {
  ProjectMutation,
  RouteContext,
  RouteModule as ModuleOf,
  RouteModuleApi,
} from "@rockett/plugin-api";
import {
  createRegistry,
  DOCUMENT_EDITS,
  REGISTRY_ID,
  ValidationError,
  type CadDocument,
  type Route,
} from "@rockett/shared";
import type { KernelClient } from "../kernel/client.js";
import type { ProjectStore } from "../store/projectStore.js";
import { projectServices } from "../modules/services.js";
import { unzstd } from "../modules/unzstd.js";
import { withinImportBudget } from "./importers.js";
import { projectAssets } from "./projectAssets.js";

export type Edit = (
  doc: CadDocument,
  req: any,
  ctx: RouteContext,
) => Promise<ProjectMutation>;

interface ModuleApi extends RouteModuleApi {
  kernel: KernelClient;
}

export type RouteModule = ModuleOf<ModuleApi> & { namespace?: string };

export const routeModules = createRegistry<RouteModule>(
  "route module",
  (module) => module.id,
);

export const registerRouteModule = (module: RouteModule, namespace?: string) =>
  routeModules.register(
    namespace === undefined ? module : { ...module, namespace },
  );

export const BODY_ROUTE_MODULE = "bodies";

function moduleSegment(id: string): string {
  const moduleId = REGISTRY_ID.exec(id)?.[1];
  if (!moduleId) throw new Error(`route module ${id} has an invalid id`);
  return `/m/${moduleId}/`;
}

const projectPrefix = (id: string) =>
  id.includes(".") ? `/projects/:id${moduleSegment(id)}` : "/projects/:id/";

type RouterApi = {
  kernel: KernelClient;
  store: ProjectStore;
  importBytes: number;
  on(route: Route, ...handlers: RequestHandler[]): void;
  wrap(
    fn: (req: any, res: any, ctx: RouteContext) => Promise<void>,
  ): RequestHandler;
  mutateProject(edit: Edit): RequestHandler;
};

function projectContext(
  { store, importBytes }: Pick<RouterApi, "store" | "importBytes">,
  doc: CadDocument,
  id: string,
  ctx: RouteContext,
) {
  const get = async (hash: string) =>
    Uint8Array.from(await store.blob(id, hash));
  const scope = { ...ctx, blobs: { get } };
  return {
    ...scope,
    services: projectServices(doc, scope),
    unzstd: (bytes: Uint8Array, maxBytes: number) =>
      unzstd(bytes, maxBytes, importBytes),
  };
}

export function mountRouteModule(router: RouterApi, module: RouteModule): void {
  const { kernel, store, importBytes, on, wrap, mutateProject } = router;
  const inside = (route: Route, start = projectPrefix(module.id)) => {
    if (!route.path.startsWith(start))
      throw new Error(
        `route module ${module.id} must mount ${route.path} under ${start}`,
      );
    return route;
  };
  module.mount({
    kernel,
    projectRoute: (route, read) => {
      if (DOCUMENT_EDITS(route))
        throw new Error(
          `route module ${module.id} must mount ${route.path} as a mutation`,
        );
      on(
        inside(route),
        wrap(async (req, res, ctx) => {
          const doc = await store.load(req.params.id);
          res.json(
            await read(
              doc,
              req,
              projectContext(router, doc, req.params.id, ctx),
            ),
          );
        }),
      );
    },
    projectMutation: (route, edit) => {
      inside(route);
      if (!DOCUMENT_EDITS(route))
        throw new Error(
          `route module ${module.id} must declare ${route.path} as a document edit`,
        );
      on(
        route,
        mutateProject(async (doc, req, ctx) => {
          const id = req.params.id;
          const context = projectContext(router, doc, id, ctx);
          const assets = projectAssets(doc, module.namespace);
          const result = await edit(doc, req, {
            ...context,
            assets: assets.capability,
            blobs: {
              ...context.blobs,
              put: async (bytes) => {
                withinImportBudget({ size: bytes.byteLength }, importBytes);
                return store.blobs(id).put(Buffer.from(bytes));
              },
            },
          });
          const document = result.document ?? doc;
          if (document.id !== id)
            throw new ValidationError(
              "A module mutation must keep the authorised project id",
            );
          assets.apply(document);
          return result;
        }),
      );
    },
    userRoute: (route, handle) => {
      inside(route, moduleSegment(module.id));
      if (route.effect || /\/:id(\/|$)/.test(route.path))
        throw new Error(
          `route module ${module.id} user route ${route.path} cannot name a project`,
        );
      on(
        route,
        wrap(async (req, res, ctx) => {
          res.json(await handle(req, ctx));
        }),
      );
    },
  });
}

export function mountRouteModules(router: RouterApi): void {
  for (const module of routeModules.list())
    if (module.id !== BODY_ROUTE_MODULE) mountRouteModule(router, module);
}
