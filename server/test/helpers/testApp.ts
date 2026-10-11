import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import { createApp, type TrustProxy } from "../../src/app.js";
import { ProjectStore } from "../../src/store/projectStore.js";
import { validateDocument } from "../../src/api/validate.js";
import { FolderStore } from "../../src/store/folderStore.js";
import { LocalStorage } from "../../src/store/storage.js";
import { InProcessKernel, type KernelClient } from "../../src/kernel/client.js";
import { SessionStore } from "../../src/auth/sessions.js";
import { UserStore } from "../../src/auth/userStore.js";
import { cookieConfig } from "../../src/auth/cookie.js";
import type { AccessIdentity } from "../../src/auth/middleware.js";
import { loadModules, type HostModule } from "../../src/modules/host.js";

export interface TestRequest extends RequestInit {
  cookie?: string | null;
}

export const localTestUser: RequestHandler = (_req, res, next) => {
  res.locals.user = { id: "test" };
  next();
};

export interface TestApp {
  origin: string;
  dataDir: string;
  store: ProjectStore;
  folders: FolderStore;
  users: UserStore;
  sessions: SessionStore;
  cookie: string;
  sweep(): Promise<void>;
  request(url: string, init?: TestRequest): Promise<Response>;
  close(): Promise<void>;
}

export async function startTestApp(
  options: {
    clientDir?: string;
    allowedOrigins?: string[];
    now?: () => number;
    kernel?: (store: ProjectStore) => KernelClient;
    cookieSecure?: string;
    seedUser?: boolean;
    setupToken?: string;
    access?: AccessIdentity;
    dataDir?: string;
    trustProxy?: TrustProxy;
    modules?: readonly HostModule[];
  } = {},
): Promise<TestApp> {
  const dataDir =
    options.dataDir ??
    (await fs.mkdtemp(path.join(os.tmpdir(), "rockett-app-")));
  const storage = new LocalStorage(dataDir, fs);
  const store = new ProjectStore(storage, validateDocument, options.now);
  const users = new UserStore(storage, options.now);
  const sessions = await SessionStore.open(storage, options.now);
  const cookie = cookieConfig(options.cookieSecure);
  const user =
    options.seedUser === false
      ? undefined
      : await users.create({
          username: "tester",
          displayName: "Tester",
          role: "admin",
          passwordHash: "scrypt$test",
        });
  const authCookie = user
    ? `${cookie.name}=${await sessions.create(user.id)}`
    : "";
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const folders = new FolderStore(storage);
  const kernel = options.kernel?.(store) ?? new InProcessKernel(store);
  const unload = options.modules
    ? await loadModules(options.modules, kernel, store, folders)
    : () => {};
  const { app, sweep } = await createApp({
    store,
    folders,
    kernel,
    clientDir: options.clientDir,
    allowedOrigins: [origin, ...(options.allowedOrigins ?? [])],
    users,
    sessions,
    cookie,
    ...(options.setupToken !== undefined && { setupToken: options.setupToken }),
    ...(options.access !== undefined && { access: options.access }),
    ...(options.trustProxy !== undefined && {
      trustProxy: options.trustProxy,
    }),
  }).catch(async (err: unknown) => {
    unload();
    await new Promise((resolve) => server.close(resolve));
    throw err;
  });
  server.on("request", app);
  return {
    origin,
    dataDir,
    store,
    folders,
    users,
    sessions,
    cookie: authCookie,
    sweep,
    request(url, { cookie: requestCookie, headers, ...init } = {}) {
      const merged = new Headers(headers);
      if (!merged.has("Origin")) merged.set("Origin", origin);
      if (requestCookie !== null)
        merged.set("Cookie", requestCookie ?? authCookie);
      return fetch(`${origin}${url}`, { ...init, headers: merged });
    },
    async close() {
      unload();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
