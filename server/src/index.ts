/**
 * Rockett CAD server entrypoint.
 *
 * - Initialises the OCCT WASM kernel (once per process)
 * - Serves the REST API under /api
 * - Serves the built client (client/dist) in production
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { initKernel } from "./geometry/kernel.js";
import { ProjectStore } from "./store/projectStore.js";
import { createApiRouter } from "./api/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ROCKETT_PORT || 8788);
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "../../data");

async function main() {
  console.log("[rockett] loading OCCT kernel…");
  const t0 = Date.now();
  await initKernel();
  console.log(`[rockett] kernel ready in ${Date.now() - t0}ms`);

  const store = new ProjectStore(DATA_DIR);
  await store.init();
  console.log(`[rockett] data dir: ${DATA_DIR}`);

  const app = express();
  app.disable("x-powered-by");
  app.use("/api", createApiRouter(store));

  // static client (production build)
  const candidates = [
    path.resolve(__dirname, "../../client/dist"), // repo layout (dev/prod)
    path.resolve(__dirname, "./client/dist"), // Docker image layout
    path.resolve(__dirname, "../client/dist"),
  ];
  const clientDir = candidates.find((c) => fs.existsSync(path.join(c, "index.html")));
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDir, "index.html"));
    });
    console.log(`[rockett] serving client from ${clientDir}`);
  } else {
    console.log("[rockett] no client build found — API only (use Vite dev server)");
  }

  app.listen(PORT, () => {
    console.log(`[rockett] listening on http://0.0.0.0:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[rockett] fatal:", err);
  process.exit(1);
});
