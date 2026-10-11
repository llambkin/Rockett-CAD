import { createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { Type } from "typebox";
import { PLUGIN_API_VERSION, type RouteModule } from "@rockett/plugin-api";
import {
  MB,
  parseManifest,
  route,
  ROUTES,
  type CadDocument,
} from "@rockett/shared";
import cam from "../../../modules/cam/manifest.json";
import kicad from "../../../modules/kicad/manifest.json";
import { BlobStore } from "../store/blobStore.js";
import { collectBlobs } from "../store/blobGc.js";
import { ProjectStore } from "../store/projectStore.js";
import { validateDocument } from "./validate.js";
import { moduleProjectFixture } from "./moduleProjectFixture.js";

const budget = 8;
const original = [0, 255, 10, 13, 128, 1, 0, 99];
const digest = (bytes: number[]) =>
  createHash("sha256").update(Uint8Array.from(bytes)).digest("hex");
const body = Type.Object({
  bytes: Type.Array(Type.Integer({ minimum: 0, maximum: 255 })),
  hash: Type.Optional(Type.String()),
  projectId: Type.Optional(Type.String()),
});
const zstdBody = Type.Object({
  bytes: Type.Array(Type.Integer({ minimum: 0, maximum: 255 })),
  maxBytes: Type.Integer(),
});
const heap = () => {
  const { heapUsed, arrayBuffers } = process.memoryUsage();
  return heapUsed + arrayBuffers;
};
let grown = 0;

const module: RouteModule = {
  id: "blobs.routes",
  mount(api) {
    api.projectRoute(
      route<never, unknown>()("GET", "/projects/:id/m/blobs/:hash"),
      async (_doc, req, ctx) => {
        expectTypeOf<keyof typeof ctx.blobs>().toEqualTypeOf<"get">();
        expectTypeOf(ctx.blobs.get).parameters.toEqualTypeOf<[hash: string]>();
        const bytes = await ctx.blobs.get(req.params.hash);
        expectTypeOf(bytes).toEqualTypeOf<Uint8Array>();
        bytes.fill(42);
        return {
          bytes: Array.from(await ctx.blobs.get(req.params.hash)),
          methods: Object.keys(ctx.blobs).toSorted(),
        };
      },
    );
    api.projectMutation(
      route<{ bytes: number[]; hash?: string; projectId?: string }, unknown>()(
        "POST",
        "/projects/:id/m/blobs/store",
        body,
        "document",
      ),
      async (doc, req, ctx) => {
        expectTypeOf<keyof typeof ctx.blobs>().toEqualTypeOf<"get" | "put">();
        expectTypeOf(ctx.blobs.put).parameters.toEqualTypeOf<
          [bytes: Uint8Array]
        >();
        const previous = req.body.hash
          ? Array.from(await ctx.blobs.get(req.body.hash))
          : undefined;
        const bytes = Uint8Array.from(req.body.bytes);
        const pending = ctx.blobs.put(bytes);
        bytes.fill(42);
        const hash = await pending;
        doc.extensions["blobs"] = { version: 1, data: { hash } };
        return {
          label: "Store module blob",
          hash,
          previous,
          bytes: Array.from(await ctx.blobs.get(hash)),
          methods: Object.keys(ctx.blobs).toSorted(),
        };
      },
    );
    api.projectRoute(
      route<{ bytes: number[]; maxBytes: number }, unknown>()(
        "POST",
        "/projects/:id/m/blobs/unzstd",
        zstdBody,
      ),
      async (_doc, req, ctx) => {
        expectTypeOf(ctx.unzstd).parameters.toEqualTypeOf<
          [bytes: Uint8Array, maxBytes: number]
        >();
        expectTypeOf(ctx.unzstd).returns.toEqualTypeOf<Uint8Array>();
        const bytes = Uint8Array.from(req.body.bytes);
        const before = heap();
        try {
          return { bytes: Array.from(ctx.unzstd(bytes, req.body.maxBytes)) };
        } finally {
          grown = heap() - before;
        }
      },
    );
    api.userRoute(
      route<never, unknown>()("GET", "/m/blobs/context"),
      async (_req, ctx) => ({ methods: Object.keys(ctx).toSorted() }),
    );
  },
};

let close = async () => {};

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
  close = async () => {};
});

async function fixture(importBytes = budget) {
  const f = await moduleProjectFixture(module, { importBytes });
  close = f.close;
  const { store, doc, request, editor, viewer, outsider, storage } = f;
  const base = `/projects/${doc.id}`;
  const write = async (
    bytes: number[],
    options: { revision?: number; hash?: string; projectId?: string } = {},
    identity = editor!,
  ) =>
    request(
      `${base}/m/blobs/store`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${options.revision ?? (await store.load(doc.id)).revision}"`,
        },
        body: JSON.stringify({ bytes, ...options }),
      },
      identity,
    );
  const read = (hash: string, identity = editor!, project = doc.id) =>
    request(
      `/projects/${project}/m/blobs/${encodeURIComponent(hash)}`,
      {},
      identity,
    );
  return {
    store,
    storage,
    doc,
    editor: editor!,
    viewer: viewer!,
    outsider: outsider!,
    request,
    write,
    read,
  };
}

it("round trips exact immutable bytes and reuses the same content hash", async () => {
  const f = await fixture();
  const first = await f.write(original);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    hash: digest(original),
    bytes: original,
    methods: ["get", "put"],
  });
  const repeated = await f.write(original, { hash: digest(original) });
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toMatchObject({
    hash: digest(original),
    previous: original,
  });
  expect(await (await f.read(digest(original))).json()).toEqual({
    bytes: original,
    methods: ["get"],
  });
  expect(await f.store.blobs(f.doc.id).list()).toEqual([digest(original)]);
  expect(await (await f.request("/m/blobs/context")).json()).toEqual({
    methods: ["user"],
  });
});

it("keeps both first-party manifests compatible with the public API minor", () => {
  const range = `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`;
  for (const manifest of [cam, kicad]) {
    expect(manifest.apiRange).toBe(range);
    expect(parseManifest(manifest, PLUGIN_API_VERSION).status).toBe(
      "compatible",
    );
    expect(
      parseManifest({ ...manifest, apiRange: "^0.6" }, PLUGIN_API_VERSION)
        .status,
    ).toBe("incompatible");
  }
});

it("permits viewer reads and refuses viewer or outsider writes before storage", async () => {
  const f = await fixture();
  expect((await f.write(original)).status).toBe(200);
  const put = vi.spyOn(BlobStore.prototype, "put");
  const read = await f.read(digest(original), f.viewer);
  expect(read.status).toBe(200);
  expect(await read.json()).toEqual({ bytes: original, methods: ["get"] });
  expect((await f.write([1], {}, f.viewer)).status).toBe(403);
  expect((await f.write([1], {}, f.outsider)).status).toBe(404);
  expect((await f.read(digest(original), f.outsider)).status).toBe(404);
  expect(put).not.toHaveBeenCalled();
  expect(await f.store.blobs(f.doc.id).list()).toEqual([digest(original)]);
});

it("binds reads and writes to the authorised project even when the request names another", async () => {
  const f = await fixture();
  const other = await f.store.create("Other blobs", f.editor.user.id);
  expect((await f.write(original, { projectId: other.id })).status).toBe(200);
  expect(await f.store.blobs(other.id).list()).toEqual([]);
  expect((await f.read(digest(original), f.editor, other.id)).status).toBe(404);
  const foreign = await f.store.blobs(other.id).put(Uint8Array.from([7]));
  const put = vi.spyOn(BlobStore.prototype, "put");
  expect(
    (await f.write([1], { hash: foreign, projectId: other.id })).status,
  ).toBe(404);
  expect(put).not.toHaveBeenCalled();
  const source = await f.store.documents.source(f.doc.id);
  const stored = await f.store.load(f.doc.id);
  await f.storage.writeAtomic(
    source.file,
    JSON.stringify({ ...stored, id: other.id }),
  );
  expect((await f.read(foreign)).status).toBe(404);
  expect(await (await f.read(digest(original))).json()).toMatchObject({
    bytes: original,
  });
});

it("refuses invalid or corrupt hashes through both callback capabilities", async () => {
  const f = await fixture();
  expect((await f.write(original)).status).toBe(200);
  await f.storage.writeAtomic(
    f.store.blobs(f.doc.id).file(digest(original)),
    Uint8Array.from([1]),
  );
  const put = vi.spyOn(BlobStore.prototype, "put");
  for (const [hash, status] of [
    ["not-a-hash", 400],
    [digest(original), 500],
  ] as const) {
    expect((await f.read(hash)).status).toBe(status);
    expect((await f.write([1], { hash })).status).toBe(status);
  }
  expect(put).not.toHaveBeenCalled();
  expect((await f.store.load(f.doc.id)).revision).toBe(f.doc.revision + 1);
});

it("refuses oversize and stale edits before calling put or changing history", async () => {
  const f = await fixture();
  const history = await (
    await f.request(`/projects/${f.doc.id}/history`)
  ).json();
  const before = await f.store.load(f.doc.id);
  const put = vi.spyOn(BlobStore.prototype, "put");
  const oversize = await f.write([...original, 1]);
  expect(oversize.status).toBe(413);
  expect(await oversize.json()).toMatchObject({ code: "too_large" });
  expect(
    (await f.write(original, { revision: before.revision + 1 })).status,
  ).toBe(409);
  expect(put).not.toHaveBeenCalled();
  expect(await f.store.blobs(f.doc.id).list()).toEqual([]);
  expect(await f.store.load(f.doc.id)).toEqual(before);
  expect(
    await (await f.request(`/projects/${f.doc.id}/history`)).json(),
  ).toEqual(history);
});

it("serialises competing mutations and checks the revision before the second put", async () => {
  const f = await fixture();
  const put = vi.spyOn(BlobStore.prototype, "put");
  const responses = await Promise.all([
    f.write([1], { revision: f.doc.revision }),
    f.write([2], { revision: f.doc.revision }),
  ]);
  expect(responses.map((response) => response.status).toSorted()).toEqual([
    200, 409,
  ]);
  expect(put).toHaveBeenCalledTimes(1);
  expect(await f.store.blobs(f.doc.id).list()).toHaveLength(1);
  expect((await f.store.load(f.doc.id)).revision).toBe(f.doc.revision + 1);
});

it("retains module bytes through undo, blob collection, redo and a cold store reload", async () => {
  const f = await fixture();
  const saved = await f.write(original);
  expect(saved.status).toBe(200);
  const result = (await saved.json()) as { document: CadDocument };
  const move = async (target: (typeof ROUTES)["undo" | "redo"]) => {
    const response = await f.request(target.path.replace(":id", f.doc.id), {
      method: target.method,
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { document: CadDocument }).document;
  };
  const undone = await move(ROUTES.undo);
  expect(undone.extensions).toEqual({});
  expect(
    await collectBlobs(f.store, f.doc.id, [], false, Number.MAX_SAFE_INTEGER),
  ).toMatchObject({ orphans: [], kept: 1 });
  expect(await (await f.read(digest(original))).json()).toMatchObject({
    bytes: original,
  });
  const redone = await move(ROUTES.redo);
  expect(redone.extensions).toEqual(result.document.extensions);
  const reloaded = new ProjectStore(f.storage, validateDocument);
  expect((await reloaded.load(f.doc.id)).extensions).toEqual(
    result.document.extensions,
  );
  expect(Array.from(await reloaded.blob(f.doc.id, digest(original)))).toEqual(
    original,
  );
});

it("decodes zstd through the route context and refuses input or output over its budget", async () => {
  const f = await fixture(4096);
  const decode = async (bytes: Uint8Array, maxBytes: number) => {
    const response = await f.request(`/projects/${f.doc.id}/m/blobs/unzstd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: Array.from(bytes), maxBytes }),
    });
    return { status: response.status, body: await response.json() };
  };
  const text = Buffer.from("(embedded_file (name pad.step))\n".repeat(40));
  const packed = zstdCompressSync(text);
  expect(await decode(packed, text.byteLength)).toEqual({
    status: 200,
    body: { bytes: Array.from(text) },
  });
  expect(await decode(packed, text.byteLength - 1)).toEqual({
    status: 413,
    body: {
      code: "too_large",
      error: "The compressed data expands past 0.00122 MB, the limit.",
    },
  });
  expect(await decode(new Uint8Array(4097), MB)).toEqual({
    status: 413,
    body: {
      code: "too_large",
      error: "This file is 0.003907 MB; imports are limited to 0.003906 MB.",
    },
  });
  expect(await decode(Uint8Array.from([1, 2, 3, 4]), MB)).toEqual({
    status: 400,
    body: {
      code: "validation",
      error: "The compressed data is not valid Zstandard.",
    },
  });
  const uncapped = 64 * MB;
  const frame = zstdCompressSync(new Uint8Array(MB));
  const bomb = Buffer.concat(
    Array.from({ length: uncapped / MB }, () => frame),
  );
  expect(bomb.byteLength).toBeLessThan(4096);
  expect(await decode(bomb, MB)).toMatchObject({ status: 413 });
  expect(grown).toBeLessThan(uncapped);
});
