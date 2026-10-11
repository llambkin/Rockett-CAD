import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { RouteModule } from "@rockett/plugin-api";
import { cookieConfig } from "../auth/cookie.js";
import { requireSession } from "../auth/middleware.js";
import { DUMMY_HASH } from "../auth/password.js";
import { SessionStore } from "../auth/sessions.js";
import { UserStore } from "../auth/userStore.js";
import { InProcessKernel } from "../kernel/client.js";
import { FolderStore } from "../store/folderStore.js";
import { ProjectStore } from "../store/projectStore.js";
import { LocalStorage } from "../store/storage.js";
import type { ImportLimits } from "../tunables.js";
import { registerRouteModule } from "./routeModules.js";
import { createApiRouter } from "./routes.js";
import { validateDocument } from "./validate.js";

export async function moduleProjectFixture(
  module: RouteModule,
  limits: Partial<ImportLimits> = {},
  namespace?: string,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "module-blobs-"));

  const storage = new LocalStorage(dir, fs);
  const store = new ProjectStore(storage, validateDocument);
  const folders = new FolderStore(storage);
  const users = new UserStore(storage);
  const sessions = await SessionStore.open(storage);
  const cookie = cookieConfig(undefined);
  const identities = await Promise.all(
    ["owner", "editor", "viewer", "outsider"].map(async (username) => {
      const user = await users.create({
        username,
        displayName: username,
        role: "member",
        passwordHash: DUMMY_HASH,
      });
      return {
        user,
        cookie: `${cookie.name}=${await sessions.create(user.id)}`,
      };
    }),
  );
  const [owner, editor, viewer, outsider] = identities;
  const doc = await store.create("Shared blobs", owner!.user.id);
  await store.setProjectAccess(doc.id, {
    owner: owner!.user.id,
    members: [
      { userId: editor!.user.id, role: "edit" },
      { userId: viewer!.user.id, role: "view" },
    ],
  });
  const off = registerRouteModule(module, namespace);

  const kernel = await InProcessKernel.start(store);
  const makeApp = () => {
    const app = express();
    app.use("/api", requireSession(sessions, users, cookie));
    app.use("/api", createApiRouter(store, folders, undefined, limits, kernel));
    return app;
  };
  let app = makeApp();
  const remount = () => {
    app = makeApp();
  };
  const server = http.createServer((req, res) => app(req, res));
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const close = async () => {
    off();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(dir, { recursive: true, force: true });
  };
  const origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  const request = (url: string, init: RequestInit = {}, identity = editor!) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", identity.cookie);
    return fetch(`${origin}/api${url}`, { ...init, headers });
  };
  return {
    store,
    storage,
    folders,
    kernel,
    doc,
    owner: owner!,
    editor: editor!,
    viewer: viewer!,
    outsider: outsider!,
    request,
    close,
    off,
    remount,
  };
}
