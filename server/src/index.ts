/**
 * Rockett CAD server entrypoint.
 *
 * - Initialises the OCCT WASM kernel (once per process)
 * - Serves the REST API under /api
 * - Serves the built client (client/dist) in production
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { compileSchemas, DEFAULT_PORT, SCHEMA_VERSION } from "@rockett/shared";
import { ProjectStore } from "./store/projectStore.js";
import { validateDocument } from "./api/validate.js";
import { FolderStore } from "./store/folderStore.js";
import { LocalStorage } from "./store/storage.js";
import { InProcessKernel, type KernelClient } from "./kernel/client.js";
import { WorkerKernel } from "./kernel/workerKernel.js";
import { createApp, scheduleSweep } from "./app.js";
import { parseAllowedOrigins } from "./auth/origin.js";
import { SessionStore } from "./auth/sessions.js";
import { UserStore } from "./auth/userStore.js";
import { cookieConfig, type CookieConfig } from "./auth/cookie.js";
import { resetPassword } from "./auth/resetPassword.js";
import { TIMING_MS } from "./tunables.js";
import { listModules, loadModules } from "./modules/host.js";
import { serverModules } from "../../modules/index.server.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ROCKETT_PORT || DEFAULT_PORT);
const DATA_DIR = process.env.DATA_DIR || path.resolve(here, "../../data");
const MESH_CACHE_DIR =
  process.env.ROCKETT_MESH_CACHE_DIR || path.join(DATA_DIR, "mesh-cache");
const PLUGIN_DIRS = {
  root: process.env.ROCKETT_PLUGIN_DIR || path.join(DATA_DIR, "plugins"),
  stage: path.join(DATA_DIR, "plugin-stage"),
};

async function run() {
  if (process.argv[2] === "reset-password") {
    if (process.argv.length !== 4)
      throw new Error("Usage: reset-password <username>");
    const users = new UserStore(new LocalStorage(DATA_DIR, fs.promises));
    try {
      await resetPassword(users, process.argv[3]!, process.stdin);
    } catch {
      throw new Error("Password reset failed");
    }
    console.log("Password reset complete");
    return;
  }
  if (process.argv.length > 2) throw new Error("Unknown command");
  const allowedOrigins = parseAllowedOrigins(
    process.env.ROCKETT_ALLOWED_ORIGINS,
  );
  const cookie: CookieConfig = cookieConfig(process.env.ROCKETT_COOKIE_SECURE);
  await main(allowedOrigins, cookie);
}

async function startKernel(store: ProjectStore): Promise<KernelClient> {
  if (process.env.ROCKETT_KERNEL !== "inprocess") {
    console.log("[rockett] starting the kernel worker");
    return new WorkerKernel(
      store,
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./kernel/worker.ts"
          : "./kernel-worker.mjs",
        import.meta.url,
      ),
    );
  }
  console.log("[rockett] loading OCCT kernel…");
  const t0 = Date.now();
  const kernel = await InProcessKernel.start(store);
  console.log(`[rockett] kernel ready in ${Date.now() - t0}ms`);
  return kernel;
}

async function main(allowedOrigins: string[], cookie: CookieConfig) {
  compileSchemas();
  console.log(
    `[rockett] session cookie: ${cookie.secure ? "secure" : "plain HTTP"}`,
  );
  const storage = new LocalStorage(DATA_DIR, fs.promises);
  const store = new ProjectStore(storage, validateDocument);
  const folders = new FolderStore(storage);
  const kernel = await startKernel(store);
  console.log(`[rockett] data dir: ${DATA_DIR}`);
  const { recovered, outdated, failed } = await store.inventory();
  for (const id of recovered)
    console.log(`[rockett] project ${id}: rolled back an interrupted write`);
  for (const { key, error } of failed)
    console.error(`[rockett] project ${key}: ${error}`);
  if (outdated.length)
    console.log(
      `[rockett] ${outdated.length} projects predate schema ${SCHEMA_VERSION} or the project manifest; each is backed up and migrated on its next save`,
    );

  await loadModules(serverModules, kernel, store, folders, PLUGIN_DIRS);
  for (const { id, status, error } of listModules())
    if (error) console.error(`[rockett] module ${id} ${status}: ${error}`);

  // static client (production build)
  const candidates = [
    path.resolve(here, "../../client/dist"), // repo layout (dev/prod)
    path.resolve(here, "./client/dist"), // Docker image layout
    path.resolve(here, "../client/dist"),
  ];
  const clientDir = candidates.find((c) =>
    fs.existsSync(path.join(c, "index.html")),
  );
  const { app, sweep } = await createApp({
    store,
    folders,
    kernel,
    clientDir,
    allowedOrigins,
    users: new UserStore(storage),
    sessions: await SessionStore.open(storage),
    cookie,
    meshDir: MESH_CACHE_DIR,
  });
  if (clientDir) {
    console.log(`[rockett] serving client from ${clientDir}`);
  } else {
    console.log(
      "[rockett] no client build found: API only (use Vite dev server)",
    );
  }

  const server = app.listen(PORT, () => {
    const { port } = server.address() as AddressInfo;
    console.log(`[rockett] listening on http://0.0.0.0:${port}`);
  });
  scheduleSweep(server, sweep);
  server.on("request", (_req, res) =>
    res.once("close", () => {
      if (!server.listening) server.closeIdleConnections();
    }),
  );
  const stop = () => {
    setTimeout(() => process.exit(1), TIMING_MS.shutdownGrace).unref();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

run().catch((err) => {
  console.error(`[rockett] ${(err as Error).message}`);
  process.exit(1);
});
