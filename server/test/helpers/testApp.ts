import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp } from "../../src/app.js";
import { ProjectStore } from "../../src/store/projectStore.js";
import { FolderStore } from "../../src/store/folderStore.js";
import { LocalStorage } from "../../src/store/storage.js";

export interface TestRequest extends RequestInit {
  cookie?: string;
}

export interface TestApp {
  origin: string;
  dataDir: string;
  store: ProjectStore;
  request(url: string, init?: TestRequest): Promise<Response>;
  close(): Promise<void>;
}

export async function startTestApp(
  options: { clientDir?: string; allowedOrigins?: string[] } = {},
): Promise<TestApp> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-app-"));
  const store = new ProjectStore(dataDir);
  await store.init();
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on(
    "request",
    createApp({
      store,
      folders: new FolderStore(new LocalStorage(dataDir, fs)),
      clientDir: options.clientDir,
      allowedOrigins: [origin, ...(options.allowedOrigins ?? [])],
    }),
  );
  return {
    origin,
    dataDir,
    store,
    request(url, { cookie, headers, ...init } = {}) {
      const merged = new Headers(headers);
      if (!merged.has("Origin")) merged.set("Origin", origin);
      if (cookie !== undefined) merged.set("Cookie", cookie);
      return fetch(`${origin}${url}`, { ...init, headers: merged });
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
