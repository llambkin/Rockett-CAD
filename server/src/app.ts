import express, { type Express } from "express";
import type { Server } from "node:http";
import path from "node:path";
import { createApiRouter } from "./api/routes.js";
import { requireAllowedOrigin } from "./auth/origin.js";
import type { ProjectStore } from "./store/projectStore.js";
import type { FolderStore } from "./store/folderStore.js";
import { ProjectQueue } from "./store/projectQueue.js";
import { dropEngine } from "./geometry/engine.js";

const HOUR = 60 * 60 * 1000;

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
}: AppDeps): { app: Express; sweep: () => Promise<void> } {
  const app = express();
  const projects = new ProjectQueue();
  app.disable("x-powered-by");
  app.use("/api", requireAllowedOrigin(allowedOrigins));
  app.use("/api", createApiRouter(store, folders, projects));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }
  const sweep = async () => {
    for (const id of await store.temporaryIds())
      if (await projects.run(id, () => store.expire(id))) dropEngine(id);
  };
  return { app, sweep };
}

export function scheduleSweep(server: Server, sweep: () => Promise<void>) {
  const run = () =>
    void sweep().catch((err) =>
      console.error("[rockett] temporary project sweep failed:", err),
    );
  run();
  const timer = setInterval(run, HOUR);
  server.once("close", () => clearInterval(timer));
}
