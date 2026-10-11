import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, expect, expectTypeOf, it } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  defineServerModule,
  PLUGIN_API_VERSION,
  StoreError,
  type ProjectService,
  type Route,
  type ServerModule,
} from "@rockett/plugin-api";
import { parseManifest, route } from "@rockett/shared";
import cam from "../../../modules/cam/manifest.json";
import elec from "../../../modules/elec/manifest.json";
import kicad from "../../../modules/kicad/manifest.json";
import measure from "../../../modules/measure/manifest.json";
import { cookieConfig } from "../auth/cookie.js";
import { requireSession } from "../auth/middleware.js";
import { DUMMY_HASH } from "../auth/password.js";
import { SessionStore } from "../auth/sessions.js";
import { UserStore } from "../auth/userStore.js";
import { createApiRouter } from "../api/routes.js";
import { validateDocument } from "../api/validate.js";
import { InProcessKernel } from "../kernel/client.js";
import { FolderStore } from "../store/folderStore.js";
import { ProjectStore } from "../store/projectStore.js";
import { LocalStorage } from "../store/storage.js";
import { listModules, loadModules } from "./host.js";

const serviceId = "provider.bytes";
const inputSchema = Type.Object({ hash: Type.String() });
const resultSchema = Type.Object({
  name: Type.String(),
  user: Type.String(),
  bytes: Type.Array(Type.Integer()),
  methods: Type.Array(Type.String()),
});

const provider = defineServerModule({
  activate({ services }) {
    services.provide(serviceId, async (doc, input, ctx) => {
      expectTypeOf(input).toEqualTypeOf<unknown>();
      expectTypeOf<keyof typeof ctx.blobs>().toEqualTypeOf<"get">();
      if (!Value.Check(inputSchema, input))
        throw new StoreError("Invalid service input", "unprocessable");
      return {
        name: doc.name,
        user: ctx.user.id,
        bytes: Array.from(await ctx.blobs.get(input.hash)),
        methods: Object.keys(ctx.blobs),
      };
    });
  },
});

let retained: ProjectService | undefined;

const consumer = (read: Route, edit: Route, user: Route): ServerModule =>
  defineServerModule({
    activate({ register }) {
      register.routeModule({
        id: "consumer.routes",
        mount(api) {
          const run: Parameters<typeof api.projectRoute>[1] = async (
            _doc,
            req,
            ctx,
          ) => {
            const service = ctx.services.get(serviceId);
            if (!service) return { error: "Requires module provider" };
            expectTypeOf(service).parameters.toEqualTypeOf<[input: unknown]>();
            retained = service;
            ctx.user = { ...ctx.user, id: "spoofed-consumer" };
            const result = await service(req.body);
            expectTypeOf(result).toEqualTypeOf<unknown>();
            if (!Value.Check(resultSchema, result))
              throw new StoreError("Invalid service result", "unprocessable");
            return result;
          };
          api.projectRoute(read, run);
          api.projectMutation(edit, async (doc, req, ctx) => ({
            label: "Read service",
            result: await run(doc, req, ctx),
          }));
          api.userRoute(user, async (_req, ctx) => ({
            methods: Object.keys(ctx),
          }));
        },
      });
    },
  });

const manifest = (id: string) => ({
  manifestVersion: 1,
  id,
  name: id,
  version: "1.0.0",
  apiRange: `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`,
  licence: "MIT",
  author: "Acme Ltd",
  contributes: {},
});

let close = async () => {};

afterEach(async () => {
  await close();
  close = async () => {};
  retained = undefined;
});

async function fixture(
  providers: { id: string; server: ServerModule }[] = [
    { id: "provider", server: provider },
  ],
  disabled = false,
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "module-services-"));
  close = () => fs.rm(dir, { recursive: true, force: true });
  const storage = new LocalStorage(dir, fs);
  if (disabled)
    await storage.writeAtomic(
      "settings/app.json",
      JSON.stringify({
        version: 1,
        values: { "plugin.provider.enabled": false },
      }),
    );
  const store = new ProjectStore(storage, validateDocument);
  const folders = new FolderStore(storage);
  const users = new UserStore(storage);
  const sessions = await SessionStore.open(storage);
  const cookie = cookieConfig(undefined);
  const identities = await Promise.all(
    ["owner", "viewer", "outsider"].map(async (username) => {
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
  const [owner, viewer, outsider] = identities;
  const doc = await store.create("Service source", owner!.user.id);
  await store.setProjectAccess(doc.id, {
    owner: owner!.user.id,
    members: [{ userId: viewer!.user.id, role: "view" }],
  });
  const hash = await store.blobs(doc.id).put(Uint8Array.from([0, 255, 128, 1]));
  const kernel = new InProcessKernel(store);
  const read = route<unknown, unknown>()(
    "POST",
    "/projects/:id/m/consumer/read",
    Type.Unknown(),
    "viewer",
  );
  const edit = route<unknown, unknown>()(
    "POST",
    "/projects/:id/m/consumer/edit",
    Type.Unknown(),
    "document",
  );
  const user = route<never, unknown>()("GET", "/m/consumer/context");
  const unload = await loadModules(
    [
      ...providers.map(({ id, server }) => ({
        manifest: manifest(id),
        server,
      })),
      { manifest: manifest("consumer"), server: consumer(read, edit, user) },
    ],
    kernel,
    store,
    folders,
  );
  close = async () => {
    unload();
    await fs.rm(dir, { recursive: true, force: true });
  };
  const app = express();
  app.use("/api", requireSession(sessions, users, cookie));
  app.use("/api", createApiRouter(store, folders, undefined, {}, kernel));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  close = async () => {
    unload();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(dir, { recursive: true, force: true });
  };
  const origin = `http://localhost:${(server.address() as AddressInfo).port}/api`;
  const invoke = (
    input: unknown = { hash },
    identity = owner!,
    project = doc.id,
    mutation = false,
  ) =>
    fetch(
      `${origin}/projects/${project}/m/consumer/${mutation ? "edit" : "read"}`,
      {
        method: "POST",
        headers: {
          Cookie: identity.cookie,
          "Content-Type": "application/json",
          "If-Match": `"${doc.revision}"`,
        },
        body: JSON.stringify(input),
      },
    );
  return {
    store,
    doc,
    hash,
    owner: owner!,
    viewer: viewer!,
    outsider: outsider!,
    invoke,
    unload,
    origin,
  };
}

it("round trips plugin-API-typed services bound to the document, authenticated user and read-only blobs", async () => {
  const f = await fixture();
  expect(listModules().map(({ status }) => status)).toEqual([
    "loaded",
    "loaded",
  ]);
  const read = await f.invoke({
    hash: f.hash,
    user: f.outsider.user,
    projectId: "another",
  });
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual({
    name: "Service source",
    user: f.owner.user.id,
    bytes: [0, 255, 128, 1],
    methods: ["get"],
  });
  const edit = await f.invoke(undefined, f.owner, f.doc.id, true);
  expect(edit.status).toBe(200);
  expect(await edit.json()).toMatchObject({
    result: { user: f.owner.user.id, methods: ["get"] },
  });
  const user = await fetch(`${f.origin}/m/consumer/context`, {
    headers: { Cookie: f.owner.cookie },
  });
  expect(await user.json()).toEqual({ methods: ["user"] });
});

it.each(["missing", "disabled", "failed"])(
  "reports an explicit missing service for a %s provider",
  async (state) => {
    const server =
      state === "failed"
        ? defineServerModule({
            activate(ctx) {
              provider.activate(ctx);
              throw new Error("Provider failed");
            },
          })
        : provider;
    const f = await fixture(
      state === "missing" ? [] : [{ id: "provider", server }],
      state === "disabled",
    );
    if (state !== "missing") expect(listModules()[0]!.status).toBe(state);
    const response = await f.invoke();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      error: "Requires module provider",
    });
  },
);

it("invalidates retained callables on unload and resolves a replacement provider on each invocation", async () => {
  const f = await fixture();
  expect((await f.invoke()).status).toBe(200);
  const call = retained!;
  f.unload();
  await expect(call({ hash: f.hash })).rejects.toMatchObject({
    code: "unprocessable",
  });
  const failed = await loadModules(
    [
      {
        manifest: manifest("provider"),
        server: defineServerModule({
          activate(ctx) {
            provider.activate(ctx);
            throw new Error("Provider failed");
          },
        }),
      },
    ],
    new InProcessKernel(f.store),
    f.store,
    new FolderStore(f.store.documents.options.storage),
  );
  expect(listModules()[0]!.status).toBe("failed");
  await expect(call({ hash: f.hash })).rejects.toMatchObject({
    code: "unprocessable",
  });
  failed();
  const off = await loadModules(
    [
      {
        manifest: manifest("provider"),
        server: defineServerModule({
          activate({ services }) {
            services.provide(serviceId, async () => "replacement");
          },
        }),
      },
    ],
    new InProcessKernel(f.store),
    f.store,
    new FolderStore(f.store.documents.options.storage),
  );
  try {
    expect(await call({ hash: f.hash })).toBe("replacement");
  } finally {
    off();
  }
  await expect(call({ hash: f.hash })).rejects.toMatchObject({
    code: "unprocessable",
  });
});

it.each(["duplicate", "namespace"])(
  "rolls back a provider's earlier registration on %s failure",
  async (failure) => {
    const broken = defineServerModule({
      activate({ services }) {
        services.provide(serviceId, async () => "first");
        services.provide(
          failure === "duplicate" ? serviceId : "other.bytes",
          async () => "second",
        );
      },
    });
    const f = await fixture([{ id: "provider", server: broken }]);
    expect(listModules()[0]!.status).toBe("failed");
    expect(listModules()[0]!.error).toContain(
      failure === "duplicate"
        ? "already has provider.bytes"
        : "must start with provider.",
    );
    expect(await (await f.invoke()).json()).toEqual({
      error: "Requires module provider",
    });
  },
);

it("permits viewer reads and refuses outsiders or hashes from another project", async () => {
  const f = await fixture();
  const view = await f.invoke(undefined, f.viewer);
  expect(view.status).toBe(200);
  expect(await view.json()).toMatchObject({
    user: f.viewer.user.id,
    bytes: [0, 255, 128, 1],
  });
  expect((await f.invoke(undefined, f.outsider)).status).toBe(404);
  expect((await f.invoke(undefined, f.viewer, f.doc.id, true)).status).toBe(
    403,
  );
  const other = await f.store.create("Other", f.owner.user.id);
  const foreign = await f.store.blobs(other.id).put(Uint8Array.from([7]));
  expect((await f.invoke({ hash: foreign, projectId: other.id })).status).toBe(
    404,
  );
  expect((await f.invoke({ hash: f.hash }, f.owner, other.id)).status).toBe(
    404,
  );
});

it("leaves input and result schema refusal with the provider and consumer", async () => {
  const f = await fixture();
  const invalid = await f.invoke({ hash: 123 });
  expect(invalid.status).toBe(422);
  expect(await invalid.json()).toMatchObject({
    error: "Invalid service input",
  });
  f.unload();
  const off = await loadModules(
    [
      {
        manifest: manifest("provider"),
        server: defineServerModule({
          activate({ services }) {
            services.provide(serviceId, async () => ({ bytes: "malformed" }));
          },
        }),
      },
    ],
    new InProcessKernel(f.store),
    f.store,
    new FolderStore(f.store.documents.options.storage),
  );
  try {
    const invalidResult = await f.invoke();
    expect(invalidResult.status).toBe(422);
    expect(await invalidResult.json()).toMatchObject({
      error: "Invalid service result",
    });
  } finally {
    off();
  }
});

it("advances the host API and every first-party range together without workspace bumps", () => {
  expect(PLUGIN_API_VERSION).toBe("0.23.0");
  const [major, minor] = PLUGIN_API_VERSION.split(".").map(Number);
  for (const firstParty of [cam, elec, kicad, measure]) {
    expect(firstParty.apiRange).toBe(`^${major}.${minor}`);
    expect(parseManifest(firstParty, PLUGIN_API_VERSION).status).toBe(
      "compatible",
    );
    expect(
      parseManifest(
        { ...firstParty, apiRange: `^${major}.${minor! - 1}` },
        PLUGIN_API_VERSION,
      ).status,
    ).toBe("incompatible");
  }
});
