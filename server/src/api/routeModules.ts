import type { Request, RequestHandler } from "express";
import {
  createRegistry,
  type CadDocument,
  type Route,
  type User,
} from "@rockett/shared";
import type { KernelClient } from "../kernel/client.js";
import type { ProjectStore } from "../store/projectStore.js";

type Mutation = (
  { label: string; cursor?: never } | { cursor: number; label?: never }
) & {
  document?: CadDocument;
  position?: number | undefined;
  [extra: string]: unknown;
};

export type Edit = (doc: CadDocument, req: any) => Promise<Mutation>;

type Context = { user: User };

type ProjectRead = (
  doc: CadDocument,
  req: Request,
  ctx: Context,
) => Promise<unknown>;

export interface ModuleApi {
  kernel: KernelClient;
  projectRoute(route: Route, read: ProjectRead): void;
  projectMutation(route: Route, edit: Edit): void;
}

export interface RouteModule {
  id: string;
  mount(api: ModuleApi): void;
}

export const routeModules = createRegistry<RouteModule>(
  "route module",
  (module) => module.id,
);

export const registerRouteModule = routeModules.register;

export const BODY_ROUTE_MODULE = "bodies";

const MODULE_ID = /^([a-z][a-z0-9-]*)[.][A-Za-z0-9.-]+$/;

function prefix(id: string): string {
  if (!id.includes(".")) return "/projects/:id/";
  const moduleId = MODULE_ID.exec(id)?.[1];
  if (!moduleId) throw new Error(`route module ${id} has an invalid id`);
  return `/projects/:id/m/${moduleId}/`;
}

type RouterApi = {
  kernel: KernelClient;
  store: ProjectStore;
  edits: Set<Route>;
  on(route: Route, ...handlers: RequestHandler[]): void;
  wrap(fn: (req: any, res: any, ctx: Context) => Promise<void>): RequestHandler;
  mutateProject(edit: Edit): RequestHandler;
};

export function mountRouteModule(router: RouterApi, module: RouteModule): void {
  const { kernel, store, edits, on, wrap, mutateProject } = router;
  const start = prefix(module.id);
  const inside = (route: Route) => {
    if (!route.path.startsWith(start))
      throw new Error(
        `route module ${module.id} must mount ${route.path} under ${start}`,
      );
    return route;
  };
  module.mount({
    kernel,
    projectRoute: (route, read) =>
      on(
        inside(route),
        wrap(async (req, res, ctx) => {
          res.json(await read(await store.load(req.params.id), req, ctx));
        }),
      ),
    projectMutation: (route, edit) => {
      edits.add(inside(route));
      on(route, mutateProject(edit));
    },
  });
}

export function mountRouteModules(router: RouterApi): void {
  for (const module of routeModules.list())
    if (module.id !== BODY_ROUTE_MODULE) mountRouteModule(router, module);
}
