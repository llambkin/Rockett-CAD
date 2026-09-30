import type { Router } from "express";
import type { NoticeStore } from "../auth/noticeStore.js";
import type { ProjectStore } from "../store/projectStore.js";
import type { FolderStore } from "../store/folderStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import { InProcessKernel, type KernelClient } from "../kernel/client.js";
import type { ImportLimits } from "./uploads.js";
import { mountRouteModule, mountRouteModules } from "./routeModules.js";
import { registerSettingsRoutes } from "./settingsRoutes.js";
import type { UserStore } from "../auth/userStore.js";
import type { FriendStore } from "../auth/friendStore.js";
export { sendError } from "./apiErrors.js";
import { createRouterContext } from "./routerContext.js";
import { createProjectMutations } from "./projectMutations.js";
import "./measureRoutes.js";
import { jobRoutes, systemRoutes } from "./systemRoutes.js";
import { projectRoutes } from "./projectRoutes.js";
import {
  evaluationRoutes,
  tangentEdgesRoute,
  sizeLimitRoute,
  exportAssetRoutes,
} from "./geometryRoutes.js";
import { importRoutes } from "./importRoutes.js";
import { featureRoutes } from "./featureRoutes.js";
import { previewRoutes } from "./previewRoutes.js";
import { historyRoutes } from "./historyRoutes.js";
import { documentRoutes } from "./documentRoutes.js";
import { bodyRoutes } from "./bodyRoutes.js";

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
  const context = createRouterContext(
    store,
    folders,
    projects,
    limits,
    kernel,
    users,
    notices,
    friends,
  );
  const api = { ...context, ...createProjectMutations(context) };
  const { router, on, wrap } = api;
  jobRoutes(api);
  registerSettingsRoutes(on, wrap, store.settings);
  systemRoutes(api);
  projectRoutes(api);
  evaluationRoutes(api);
  importRoutes(api);
  featureRoutes(api);
  previewRoutes(api);
  historyRoutes(api);
  tangentEdgesRoute(api);
  mountRouteModule(api, bodyRoutes);
  documentRoutes(api);
  sizeLimitRoute(api);
  mountRouteModules(api);
  exportAssetRoutes(api);
  return router;
}
