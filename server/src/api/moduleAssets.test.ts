import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { Type } from "typebox";
import {
  PLUGIN_API_VERSION,
  type RouteModule,
  type ServerContext,
} from "@rockett/plugin-api";
import {
  route,
  SCHEMA_VERSION,
  SETTINGS,
  MODULE_ASSET_LIMIT,
  registerSettings,
  moduleHostSettings,
  type CadDocument,
  type ProjectFile,
} from "@rockett/shared";
import { collectBlobs } from "../store/blobGc.js";
import { backupNamespace, sha256 } from "../store/jsonStore.js";
import { ProjectStore } from "../store/projectStore.js";
import { loadModules } from "../modules/host.js";
import { validateDocument } from "./validate.js";
import { moduleProjectFixture } from "./moduleProjectFixture.js";

const namespace = "acme.portable";
const source = Uint8Array.from([0, 255, 10, 13, 128, 1, 0, 99]);
const snapshot = Uint8Array.from([255, 0, 73, 70, 0, 10]);
const unknown = {
  nested: [null, { vendor: "preserve", future: [false, 0, ""] }],
};
const hashes = [sha256(source), sha256(snapshot)];
const editRoute = route<
  {
    refs?: string[];
    tamper?: string;
    replace?: boolean;
    excessive?: boolean;
    projectId?: string;
  },
  unknown
>()(
  "POST",
  "/projects/:id/m/acme/portable/assets",
  Type.Object({
    refs: Type.Optional(Type.Array(Type.String())),
    tamper: Type.Optional(Type.String()),
    replace: Type.Optional(Type.Boolean()),
    excessive: Type.Optional(Type.Boolean()),
    projectId: Type.Optional(Type.String()),
  }),
  "document",
);
const module: RouteModule = {
  id: `${namespace}.routes`,
  mount(api) {
    api.projectMutation(editRoute, async (doc, req, ctx) => {
      expectTypeOf(ctx.assets.set).parameters.toEqualTypeOf<
        [hashes: readonly string[]]
      >();
      doc.extensions[namespace] = { version: 1, data: unknown };
      if (!req.body.refs) {
        await ctx.blobs.put(source);
        await ctx.blobs.put(snapshot);
      }
      const refs = req.body.excessive
        ? Array.from({ length: MODULE_ASSET_LIMIT + 1 }, () => hashes[0]!)
        : (req.body.refs ?? [...hashes]);
      ctx.assets.set(refs);
      refs.fill("not-a-hash");
      if (req.body.projectId) doc.id = req.body.projectId;
      if (req.body.replace)
        doc.extensions[namespace] = structuredClone({
          version: 1,
          data: unknown,
        });
      if (req.body.tamper === "omit") delete doc.moduleAssets;
      else if (req.body.tamper === "legacy") delete doc.moduleAssets?.legacy;
      else if (req.body.tamper === "opaque") {
        Object.assign(Object(doc.moduleAssets?.legacy), { changed: true });
        doc.moduleAssets!.legacy = "overwritten";
      } else if (req.body.tamper) {
        doc.moduleAssets ??= { namespaces: {} };
        doc.moduleAssets.namespaces[req.body.tamper] = hashes;
      }
      return {
        label: "Store portable assets",
        ...(req.body.replace && { document: structuredClone(doc) }),
      };
    });
  },
};
let close = async () => {};
afterEach(async () => {
  vi.restoreAllMocks();
  await close();
  close = async () => {};
});
async function fixture() {
  const f = await moduleProjectFixture(module, {}, namespace);
  close = f.close;
  const edit = async (body = {}, identity = f.editor) =>
    f.request(
      editRoute.path.replace(":id", f.doc.id),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
        },
        body: JSON.stringify(body),
      },
      identity,
    );
  const download = async (id = f.doc.id): Promise<ProjectFile> => {
    const response = await f.request(`/projects/${id}/file`);
    expect(response.status).toBe(200);
    return response.json();
  };
  const upload = async (file: ProjectFile) => {
    const body = new FormData();
    body.append("file", new Blob([JSON.stringify(file)]), "portable.rockett");
    return f.request("/projects/file", { method: "POST", body });
  };
  return { ...f, edit, download, upload };
}
async function exact(store: ProjectStore, doc: CadDocument) {
  expect(doc.features).toEqual([]);
  expect(doc.extensions[namespace]).toEqual({
    version: 1,
    data: unknown,
  });
  expect(doc.moduleAssets!.namespaces[namespace]).toEqual(hashes);
  expect(Object.hasOwn(doc.moduleAssets!, "legacy")).toBe(false);
  expect(await store.blob(doc.id, hashes[0]!)).toEqual(Buffer.from(source));
  expect(await store.blob(doc.id, hashes[1]!)).toEqual(Buffer.from(snapshot));
}
it("retains featureless source and snapshot through save, undo, cold reopen, duplicate and portable import", async () => {
  const f = await fixture();
  expect((await f.edit({ replace: true })).status).toBe(200);
  await exact(f.store, await f.store.load(f.doc.id));
  const move = async (kind: "undo" | "redo") => {
    const response = await f.request(`/projects/${f.doc.id}/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
  };
  await move("undo");
  expect((await f.store.load(f.doc.id)).extensions).toEqual({});
  expect(
    await collectBlobs(f.store, f.doc.id, [], false, Number.MAX_SAFE_INTEGER),
  ).toMatchObject({ orphans: [], kept: 2 });
  await move("redo");
  const cold = new ProjectStore(f.storage, validateDocument);
  await exact(cold, await cold.load(f.doc.id));
  await exact(
    cold,
    await cold.duplicate(f.doc.id, undefined, f.editor.user.id),
  );
  const file = await f.download();
  expect(file.assets).toEqual(
    Object.fromEntries([
      [hashes[0], Buffer.from(source).toString("base64")],
      [hashes[1], Buffer.from(snapshot).toString("base64")],
    ]),
  );
  const imported = await f.upload(file);
  expect(imported.status).toBe(200);
  await exact(
    cold,
    ((await imported.json()) as { document: CadDocument }).document,
  );
});
it.each(["disabled", "absent"])(
  "retains portable assets with the module %s",
  async (state) => {
    const f = await fixture();
    expect((await f.edit()).status).toBe(200);
    f.off();
    const manifest = {
      manifestVersion: 1,
      id: namespace,
      name: "Portable",
      version: "1.0.0",
      apiRange: `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`,
      licence: "MIT",
      author: "Fixture",
      contributes: {},
    };
    registerSettings(
      moduleHostSettings(namespace).filter(({ key }) => !SETTINGS.has(key)),
    );
    if (state === "disabled")
      await f.store.settings.patch(
        { scope: "app" },
        { set: { [`plugin.${namespace}.enabled`]: false } },
      );
    const activate = vi.fn((ctx: ServerContext) => {
      ctx.register.routeModule(module);
    });
    const stop = await loadModules(
      state === "absent" ? [] : [{ manifest, server: { activate } }],
      f.kernel,
      f.store,
      f.folders,
    );
    try {
      f.remount();
      expect(activate).not.toHaveBeenCalled();
      expect((await f.edit()).status).toBe(404);
      const saved = await f.request(`/projects/${f.doc.id}/rename`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
        },
        body: JSON.stringify({ name: "Module unavailable" }),
      });
      expect(saved.status).toBe(200);
      const undone = await f.request(`/projects/${f.doc.id}/undo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
        },
        body: "{}",
      });
      expect(undone.status).toBe(200);
      expect(await f.store.blob(f.doc.id, hashes[0]!)).toEqual(
        Buffer.from(source),
      );
      expect(await f.store.blob(f.doc.id, hashes[1]!)).toEqual(
        Buffer.from(snapshot),
      );
      expect(
        await collectBlobs(
          f.store,
          f.doc.id,
          [],
          false,
          Number.MAX_SAFE_INTEGER,
        ),
      ).toMatchObject({ orphans: [], kept: 2 });
      const redone = await f.request(`/projects/${f.doc.id}/redo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
        },
        body: "{}",
      });
      expect(redone.status).toBe(200);
      const cold = new ProjectStore(f.storage, validateDocument);
      await exact(cold, await cold.load(f.doc.id));
      await exact(
        cold,
        await cold.duplicate(f.doc.id, undefined, f.editor.user.id),
      );
      const imported = await f.upload(await f.download());
      expect(imported.status).toBe(200);
      await exact(
        cold,
        ((await imported.json()) as { document: CadDocument }).document,
      );
    } finally {
      stop();
    }
  },
);
it("binds declarations to the exact dotted manifest namespace through the host", async () => {
  const f = await fixture();
  f.off();
  const stop = await loadModules(
    [
      {
        manifest: {
          manifestVersion: 1,
          id: namespace,
          name: "Portable",
          version: "1.0.0",
          apiRange: `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`,
          licence: "MIT",
          author: "Fixture",
          contributes: {},
        },
        server: {
          activate(ctx) {
            ctx.register.routeModule(module);
          },
        },
      },
    ],
    f.kernel,
    f.store,
    f.folders,
  );
  try {
    f.remount();
    expect((await f.edit({ replace: true })).status).toBe(200);
    const doc = await f.store.load(f.doc.id);
    await exact(f.store, doc);
    expect(Object.keys(doc.moduleAssets!.namespaces)).toEqual([namespace]);
  } finally {
    stop();
  }
});

it("refuses missing, corrupt, foreign, malformed and foreign namespace refs atomically", async () => {
  const f = await fixture();
  const before = await f.store.load(f.doc.id);
  const history = await (
    await f.request(`/projects/${f.doc.id}/history`)
  ).json();
  const foreign = await f.store.create("Foreign", f.owner.user.id);
  const foreignHash = await f.store
    .blobs(foreign.id)
    .put(Uint8Array.from([45]));
  const corrupt = await f.store.blobs(f.doc.id).put(Uint8Array.from([46]));
  await f.storage.writeAtomic(
    f.store.blobs(f.doc.id).file(corrupt),
    Uint8Array.from([47]),
  );
  for (const [body, status] of [
    [{ refs: [sha256(Uint8Array.from([48]))] }, 404],
    [{ refs: [foreignHash] }, 404],
    [{ refs: [corrupt] }, 500],
    [{ refs: ["not-a-hash"] }, 400],
    [{ refs: [hashes[0]!, hashes[0]!] }, 400],
    [{ excessive: true }, 400],
    [{ refs: [], tamper: "foreign.module" }, 400],
    [{ refs: [], tamper: namespace }, 400],
    [{ refs: [foreignHash], projectId: foreign.id }, 400],
  ] as const) {
    expect((await f.edit(body)).status).toBe(status);
    expect(await f.store.load(f.doc.id)).toEqual(before);
    expect(
      await (await f.request(`/projects/${f.doc.id}/history`)).json(),
    ).toEqual(history);
  }
});
it("refuses viewer and outsider asset declarations before callback storage", async () => {
  const f = await fixture();
  const put = vi.spyOn(f.store, "blobs");
  expect((await f.edit({}, f.viewer)).status).toBe(403);
  expect((await f.edit({}, f.outsider)).status).toBe(404);
  expect(put).not.toHaveBeenCalled();
  expect(await f.store.load(f.doc.id)).toEqual(f.doc);
});
it("refuses malformed and incomplete portable files without adding a project", async () => {
  const f = await fixture();
  expect((await f.edit()).status).toBe(200);
  const file = await f.download();
  const before = await f.store.documents.keys();
  for (const change of [
    (copy: ProjectFile) => {
      delete copy.assets[hashes[0]!];
    },
    (copy: ProjectFile) => {
      copy.assets[hashes[0]!] = Buffer.from([1]).toString("base64");
    },
    (copy: ProjectFile) => {
      copy.document.moduleAssets!.namespaces[namespace] = ["invalid"];
    },
  ]) {
    const copy = structuredClone(file);
    change(copy);
    expect((await f.upload(copy)).status).toBe(400);
    expect(await f.store.documents.keys()).toEqual(before);
  }
});
it("backs up previous-schema bytes before saving and restores the same unknown JSON", async () => {
  const f = await fixture();
  const old = {
    ...f.doc,
    schemaVersion: 45,
    moduleAssets: { old: unknown },
    extensions: {
      "future.module": {
        version: 99,
        data: unknown,
        assets: "legacy-module-extra",
        extra: unknown,
      },
    },
  };
  const original = JSON.stringify(old);
  const stored = await f.store.documents.source(f.doc.id);
  await f.storage.writeAtomic(stored.file, original);
  const loaded = await f.store.load(f.doc.id);
  expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
  expect(loaded.extensions).toEqual(old.extensions);
  expect(loaded.moduleAssets).toEqual({
    namespaces: {},
    legacy: old.moduleAssets,
  });
  expect((await f.edit()).status).toBe(200);
  expect((await f.store.load(f.doc.id)).extensions["future.module"]).toEqual(
    old.extensions["future.module"],
  );
  expect((await f.download()).document.moduleAssets!.legacy).toEqual(
    old.moduleAssets,
  );
  const backups = backupNamespace(f.storage, f.store.documents.dir(f.doc.id));
  const name = (await backups.names()).find((entry) =>
    entry.startsWith("v45-"),
  );
  expect(name).toBeDefined();
  const entries = new Map(await backups.verify(name!));
  const relative = stored.file.slice(
    f.store.documents.dir(f.doc.id).length + 1,
  );
  expect(
    (await backups.verified(name!, relative, entries.get(relative)!)).toString(
      "utf8",
    ),
  ).toBe(original);
  await backups.restore(name!);
  expect((await f.store.load(f.doc.id)).extensions).toEqual(old.extensions);
});
it.each(
  [
    null,
    [],
    { namespaces: {} },
    { namespaces: {}, extra: unknown },
    { namespaces: { legacy: ["unmanaged"] } },
    0,
    "legacy",
    false,
  ].flatMap((value) =>
    ["omit", "legacy", "opaque"].map((tamper) => ({ value, tamper })),
  ),
)(
  "preserves previous-schema root collision %j without interpreting references",
  async ({ value, tamper }) => {
    const f = await fixture();
    const previous = {
      ...f.doc,
      schemaVersion: 45,
      moduleAssets: value,
      extensions: {
        "future.module": { version: 8, data: unknown, assets: hashes },
      },
    };
    const sourceFile = await f.store.documents.source(f.doc.id);
    await f.storage.writeAtomic(sourceFile.file, JSON.stringify(previous));
    const loaded = await f.store.load(f.doc.id);
    expect(loaded.moduleAssets).toEqual({ namespaces: {}, legacy: value });
    expect(loaded.extensions).toEqual(previous.extensions);
    const foreign = await f.store.blobs(f.doc.id).put(Uint8Array.from([72]));
    loaded.moduleAssets!.namespaces["foreign.module"] = [foreign];
    await f.store.save(loaded, f.editor.user.id);
    const cold = new ProjectStore(f.storage, validateDocument);
    expect((await cold.load(f.doc.id)).moduleAssets).toEqual(
      loaded.moduleAssets,
    );
    expect((await f.edit({ replace: true, tamper })).status).toBe(200);
    expect((await cold.load(f.doc.id)).moduleAssets).toEqual({
      namespaces: { "foreign.module": [foreign], [namespace]: hashes },
      legacy: value,
    });
  },
);
it("keeps absent asset metadata absent through previous-schema load and backed-up save", async () => {
  const f = await fixture();
  expect(f.doc.moduleAssets).toBeUndefined();
  const previous = {
    ...f.doc,
    schemaVersion: 45,
    extensions: {
      "future.module": { version: 8, data: unknown, assets: "legacy" },
    },
  };
  const raw = JSON.stringify(previous);
  const sourceFile = await f.store.documents.source(f.doc.id);
  await f.storage.writeAtomic(sourceFile.file, raw);
  const loaded = await f.store.load(f.doc.id);
  expect(loaded.moduleAssets).toBeUndefined();
  expect(loaded.extensions).toEqual(previous.extensions);
  await f.store.save(loaded, f.editor.user.id);
  const backups = backupNamespace(f.storage, f.store.documents.dir(f.doc.id));
  const backup = (await backups.names()).find((name) =>
    name.startsWith("v45-"),
  );
  expect(backup).toBeDefined();
  await backups.restore(backup!);
  expect((await f.storage.read(sourceFile.file)).toString("utf8")).toBe(raw);
  expect(
    (await new ProjectStore(f.storage, validateDocument).load(f.doc.id))
      .moduleAssets,
  ).toBeUndefined();
});
