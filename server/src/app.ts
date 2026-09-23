import express, { type Express } from "express";
import path from "node:path";
import { createApiRouter } from "./api/routes.js";
import { requireAllowedOrigin } from "./auth/origin.js";
import type { ProjectStore } from "./store/projectStore.js";
import type { FolderStore } from "./store/folderStore.js";

export interface AppDeps {
  store: ProjectStore;
  folders: FolderStore;
  clientDir?: string | undefined;
  allowedOrigins: readonly string[];
}

export function createApp({
  store,
  folders,
  clientDir,
  allowedOrigins,
}: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", requireAllowedOrigin(allowedOrigins));
  app.use("/api", createApiRouter(store, folders));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }
  return app;
}
