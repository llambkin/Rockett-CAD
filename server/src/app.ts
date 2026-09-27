import express, { type Express, type Router } from "express";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { createApiRouter } from "./api/routes.js";
import { ValidationError } from "@rockett/shared";
import { gzipJson } from "./api/gzipJson.js";
import { requireAllowedOrigin } from "./auth/origin.js";
import { requireSession } from "./auth/middleware.js";
import { AccessKeyStore } from "./auth/cfAccess.js";
import type { AccessIdentity } from "./auth/middleware.js";
import { cookieConfig, type CookieConfig } from "./auth/cookie.js";
import { createAuthRouter } from "./auth/routes.js";
import { createFriendRouter } from "./auth/friendRoutes.js";
import { FriendStore } from "./auth/friendStore.js";
import type { SessionStore } from "./auth/sessions.js";
import type { UserStore } from "./auth/userStore.js";
import type { ProjectStore } from "./store/projectStore.js";
import type { FolderStore } from "./store/folderStore.js";
import { ProjectQueue } from "./store/projectQueue.js";
import type { KernelClient } from "./kernel/client.js";
import { TIMING_MS } from "./tunables.js";

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
      .filter(
        (file) =>
          COMPRESSIBLE.test(file) &&
          !file.split(path.sep).some((part) => part.startsWith(".")),
      )
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
    res.sendFile("index.html", { root: clientDir });
  });
  return router;
}

export interface AppDeps {
  store: ProjectStore;
  folders: FolderStore;
  kernel: KernelClient;
  clientDir?: string | undefined;
  allowedOrigins: readonly string[];
  users: UserStore;
  sessions: SessionStore;
  cookie?: CookieConfig;
  setupToken?: string;
  access?: AccessIdentity;
}

export function createApp({
  store,
  folders,
  kernel,
  clientDir,
  allowedOrigins,
  users,
  sessions,
  cookie = cookieConfig(process.env.ROCKETT_COOKIE_SECURE),
  setupToken = process.env.ROCKETT_SETUP_TOKEN,
  access,
}: AppDeps): { app: Express; sweep: () => Promise<void> } {
  const app = express();
  const projects = new ProjectQueue();
  app.disable("x-powered-by");
  app.use("/api", requireAllowedOrigin(allowedOrigins));
  app.use("/api", gzipJson);
  const team = process.env.ROCKETT_CF_ACCESS_TEAM;
  const aud = process.env.ROCKETT_CF_ACCESS_AUD;
  const identity =
    access ??
    (team && aud
      ? { team, aud, keys: new AccessKeyStore(team), now: Date.now }
      : undefined);
  app.use("/api", requireSession(sessions, users, cookie.name, identity));
  app.use("/api", createAuthRouter(users, sessions, cookie, setupToken));
  app.use(
    "/api",
    createFriendRouter(
      users,
      new FriendStore(store.documents.options.storage),
      store,
    ),
  );
  app.use("/api", createApiRouter(store, folders, projects, {}, kernel, users));
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  if (clientDir) app.use(serveClient(clientDir));
  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status =
        err instanceof ValidationError
          ? 400
          : typeof err === "object" &&
              err !== null &&
              "status" in err &&
              typeof err.status === "number" &&
              err.status >= 400 &&
              err.status < 500
            ? err.status
            : 500;
      console.error(
        `[rockett] ${status} ${req.route?.path ?? "unmatched"}: ${status === 500 ? "Internal server error" : "Request failed"}`,
      );
      res.status(status).json({
        error: status === 500 ? "Internal server error" : "Request failed",
      });
    },
  );
  const sweep = async () => {
    for (const id of await store.temporaryIds())
      if (await projects.run(id, () => store.expire(id))) kernel.drop(id);
  };
  return { app, sweep };
}

export function scheduleSweep(server: Server, sweep: () => Promise<void>) {
  const run = () =>
    void sweep().catch((err) =>
      console.error("[rockett] temporary project sweep failed:", err),
    );
  run();
  const timer = setInterval(run, TIMING_MS.temporaryProjectSweep);
  server.once("close", () => clearInterval(timer));
}
