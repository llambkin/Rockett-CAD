import express, {
  type ErrorRequestHandler,
  type Express,
  type Router,
} from "express";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { createApiRouter, sendError } from "./api/routes.js";
import { ValidationError, type ApiErrorCode } from "@rockett/shared";
import { gzipJson } from "./api/gzipJson.js";
import { requireAllowedOrigin } from "./auth/origin.js";
import { requireSession } from "./auth/middleware.js";
import { AccessKeyStore } from "./auth/cfAccess.js";
import type { AccessIdentity } from "./auth/middleware.js";
import { cookieConfig, type CookieConfig } from "./auth/cookie.js";
import { createAuthRouter } from "./auth/routes.js";
import { createFriendRouter } from "./auth/friendRoutes.js";
import { FriendStore } from "./auth/friendStore.js";
import { NoticeStore } from "./auth/noticeStore.js";
import type { SessionStore } from "./auth/sessions.js";
import type { UserStore } from "./auth/userStore.js";
import type { ProjectStore } from "./store/projectStore.js";
import type { FolderStore } from "./store/folderStore.js";
import { ProjectQueue } from "./store/projectQueue.js";
import type { KernelClient } from "./kernel/client.js";
import { TIMING_MS } from "./tunables.js";

const COMPRESSIBLE = /\.(?:js|css|html)$/;
const ASSETS = "/assets/";
const gzipAsync = promisify(gzip);
const toUrl = (file: string) => `/${file.split(path.sep).join("/")}`;

function cacheControl(urlPath: string) {
  if (urlPath.startsWith(ASSETS)) return "public, max-age=31536000, immutable";
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
  router.get("/{*splat}", (req, res) => {
    if (req.path.startsWith(ASSETS)) return res.sendStatus(404);
    res.set("Cache-Control", "no-cache");
    res.sendFile("index.html", { root: clientDir });
  });
  return router;
}

const IMPORT_MAP = /<script\b[^>]*\btype=["']?importmap\b[^>]*>/i;

async function scriptSources(clientDir: string | undefined) {
  if (!clientDir) return "'self'";
  const index = path.join(clientDir, "index.html");
  const [, ...maps] = (await readFile(index, "utf8")).split(IMPORT_MAP);
  if (maps.length === 0) return "'self'";
  const map =
    maps.length === 1 ? maps[0]?.match(/^([^]*?)<\/script>/i)?.[1] : undefined;
  if (map === undefined)
    throw new Error(`${index} has an import map the CSP cannot hash`);
  return `'self' 'sha256-${createHash("sha256").update(map).digest("base64")}'`;
}

const answerError: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number"
      ? err.status
      : 500;
  const code: ApiErrorCode =
    err instanceof ValidationError
      ? err.code
      : status === 413
        ? "too_large"
        : status >= 400 && status < 500
          ? "validation"
          : "internal";
  const error =
    code === "internal" ? "Internal server error" : "Request failed";
  sendError(res, { error, code });
  console.error(
    `[rockett] ${res.statusCode} ${req.route?.path ?? "unmatched"}: ${error}`,
  );
};

export type TrustProxy = number | string | false;

export function trustProxyConfig(value: string | undefined): TrustProxy {
  const setting = value?.trim() ?? "";
  if (setting === "") return false;
  if (/^\d+$/.test(setting)) return Number(setting);
  try {
    express().set("trust proxy", setting);
  } catch {
    throw new Error(
      "ROCKETT_TRUST_PROXY must be a hop count or a comma-separated list of proxy addresses",
    );
  }
  return setting;
}

interface AppDeps {
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
  trustProxy?: TrustProxy;
  meshDir?: string;
}

export async function createApp({
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
  trustProxy = trustProxyConfig(process.env.ROCKETT_TRUST_PROXY),
  meshDir,
}: AppDeps): Promise<{ app: Express; sweep: () => Promise<void> }> {
  const scriptSrc = await scriptSources(clientDir);
  await store.uploads.empty();
  const app = express();
  const projects = new ProjectQueue();
  const notices = new NoticeStore(store.documents.options.storage);
  const friends = new FriendStore(store.documents.options.storage);
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy);
  app.use((_req, res, next) => {
    res.set({
      "Content-Security-Policy": `default-src 'none'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  app.use("/api", requireAllowedOrigin(allowedOrigins));
  app.use("/api", gzipJson);
  const team = process.env.ROCKETT_CF_ACCESS_TEAM;
  const aud = process.env.ROCKETT_CF_ACCESS_AUD;
  const identity =
    access ??
    (team && aud
      ? { team, aud, keys: new AccessKeyStore(team), now: Date.now }
      : undefined);
  app.use("/api", requireSession(sessions, users, cookie, identity));
  app.use("/api", createAuthRouter(users, sessions, cookie, setupToken));
  app.use("/api", createFriendRouter(users, friends, store, folders, notices));
  app.use(
    "/api",
    createApiRouter(
      store,
      folders,
      projects,
      {},
      kernel,
      users,
      notices,
      friends,
      meshDir,
    ),
  );
  app.use("/api", (_req, res) => {
    sendError(res, { error: "Not found", code: "not_found" });
  });
  if (clientDir) app.use(serveClient(clientDir));
  app.use((_req, res) => res.sendStatus(404));
  app.use(answerError);
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
