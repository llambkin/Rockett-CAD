import express, { type Express, type Router } from "express";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { createApiRouter } from "./api/routes.js";
import { gzipJson } from "./api/gzipJson.js";
import { requireAllowedOrigin } from "./auth/origin.js";
import type { ProjectStore } from "./store/projectStore.js";
import type { FolderStore } from "./store/folderStore.js";
import { ProjectQueue } from "./store/projectQueue.js";
import { dropEngine } from "./geometry/engine.js";

const HOUR = 60 * 60 * 1000;
const COMPRESSIBLE = /\.(?:js|css|html)$/;
const gzipAsync = promisify(gzip);
const toUrl = (file: string) => `/${file.split(path.sep).join("/")}`;

function cacheControl(urlPath: string) {
  if (urlPath.startsWith("/assets/"))
    return "public, max-age=31536000, immutable";
  if (urlPath === "/index.html") return "no-cache";
  return undefined;
}

function serveClient(clientDir: string): Router {
  const files = new Set(
    readdirSync(clientDir, { recursive: true, encoding: "utf8" })
      .filter((file) => COMPRESSIBLE.test(file))
      .map(toUrl),
  );
  const gzipped = new Map<string, Promise<Buffer>>();
  const router = express.Router();
  router.get("/{*splat}", (req, res, next) => {
    const url = req.path === "/" ? "/index.html" : req.path;
    res.vary("Accept-Encoding");
    if (!files.has(url) || req.acceptsEncodings("gzip", "identity") !== "gzip")
      return next();
    let body = gzipped.get(url);
    if (!body) {
      body = readFile(path.join(clientDir, url)).then((raw) =>
        gzipAsync(raw, { level: 6 }),
      );
      gzipped.set(url, body);
    }
    body.then(
      (data) => {
        const control = cacheControl(url);
        if (control) res.set("Cache-Control", control);
        res.type(path.extname(url)).set("Content-Encoding", "gzip").send(data);
      },
      () => {
        gzipped.delete(url);
        next();
      },
    );
  });
  router.use(
    express.static(clientDir, {
      setHeaders(res, file) {
        const control = cacheControl(toUrl(path.relative(clientDir, file)));
        if (control) res.setHeader("Cache-Control", control);
      },
    }),
  );
  router.get("/{*splat}", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(clientDir, "index.html"));
  });
  return router;
}

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
  app.use("/api", gzipJson);
  app.use("/api", createApiRouter(store, folders, projects));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  if (clientDir) app.use(serveClient(clientDir));
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
