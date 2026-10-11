import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import {
  SETTINGS,
  moduleHostSettings,
  registerSettings,
  type CadDocument,
  type ProjectFile,
} from "@rockett/shared";
import { moduleProjectFixture } from "../../../server/src/api/moduleProjectFixture.js";
import { loadModules } from "../../../server/src/modules/host.js";
import { BlobStore } from "../../../server/src/store/blobStore.js";
import { collectBlobs } from "../../../server/src/store/blobGc.js";
import { backupNamespace } from "../../../server/src/store/jsonStore.js";
import { ProjectStore } from "../../../server/src/store/projectStore.js";
import { validateDocument } from "../../../server/src/api/validate.js";
import manifest from "../manifest.json";
import server from "../server.js";

const namespace = manifest.id;
const board = `(kicad_pcb (version 20241229) (general (thickness 1.6))
  (gr_rect (start 0 0) (end 50 30) (layer "Edge.Cuts") (width 0.05)))`;
const bytes = (text: string) => Buffer.from(text);
const digest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const unknown = { nested: [null, { future: [false, 0, ""] }] };
type Link = {
  sourceKind: string;
  sourceAsset: string;
  sha256: string;
  snapshotAsset: string;
  formatVersion: number;
  outlineOwner: string;
  generator?: string;
  generatorVersion?: string;
};
const linksOf = (doc: CadDocument) =>
  (doc.extensions[namespace]!.data as { links: Record<string, Link> }).links;
let close = async () => {};

afterEach(async () => {
  vi.restoreAllMocks();
  await close();
  close = async () => {};
});

async function fixture(importBytes?: number) {
  const f = await moduleProjectFixture(
    { id: "fixture.empty", mount() {} },
    importBytes === undefined ? {} : { importBytes },
  );
  f.off();
  let stop = await loadModules(
    [{ manifest, server }],
    f.kernel,
    f.store,
    f.folders,
  );
  f.remount();
  close = async () => {
    stop();
    await f.close();
  };
  const write = async (
    source = bytes(board),
    identity = f.editor,
    revision?: number,
    body: unknown = { source: source.toString("base64") },
  ) =>
    f.request(
      `/projects/${f.doc.id}/m/rockett/kicad/upload`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `"${revision ?? (await f.store.load(f.doc.id)).revision}"`,
        },
        body: JSON.stringify(body),
      },
      identity,
    );
  const move = async (kind: "undo" | "redo" | "rename", body = {}) => {
    const response = await f.request(`/projects/${f.doc.id}/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${(await f.store.load(f.doc.id)).revision}"`,
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
  };
  const unavailable = async (state: "disabled" | "absent") => {
    stop();
    registerSettings(
      moduleHostSettings(namespace).filter(({ key }) => !SETTINGS.has(key)),
    );
    if (state === "disabled")
      await f.store.settings.patch(
        { scope: "app" },
        { set: { [`plugin.${namespace}.enabled`]: false } },
      );
    stop = await loadModules(
      state === "absent" ? [] : [{ manifest, server }],
      f.kernel,
      f.store,
      f.folders,
    );
    f.remount();
  };
  const download = async (): Promise<ProjectFile> => {
    const response = await f.request(`/projects/${f.doc.id}/file`);
    expect(response.status).toBe(200);
    return response.json();
  };
  const upload = async (file: ProjectFile) => {
    const body = new FormData();
    body.append("file", new Blob([JSON.stringify(file)]), "board.rockett");
    return f.request("/projects/file", { method: "POST", body });
  };
  return { ...f, write, move, unavailable, download, upload };
}

async function unchanged(
  f: Awaited<ReturnType<typeof fixture>>,
  attempt: () => Promise<Response>,
  status: number,
  reason?: string,
) {
  const before = await f.store.load(f.doc.id);
  const blobs = await f.store.blobs(f.doc.id).list();
  const history = await (
    await f.request(`/projects/${f.doc.id}/history`)
  ).json();
  const put = vi.spyOn(BlobStore.prototype, "put");
  const response = await attempt();
  expect(response.status).toBe(status);
  if (reason) expect((await response.json()).error).toContain(reason);
  expect(put).not.toHaveBeenCalled();
  put.mockRestore();
  expect(await f.store.load(f.doc.id)).toEqual(before);
  expect(await f.store.blobs(f.doc.id).list()).toEqual(blobs);
  expect(
    await (await f.request(`/projects/${f.doc.id}/history`)).json(),
  ).toEqual(history);
}

it("refuses a board below the KiCad 9 floor before storing blobs, links or history", async () => {
  const f = await fixture();
  await unchanged(
    f,
    () => f.write(bytes(board.replace("20241229", "20240108"))),
    400,
    "KiCad 9",
  );
});

it("stores exact BOM source bytes and a content-hashed versioned snapshot through actual module activation", async () => {
  const f = await fixture();
  const source = bytes(`\uFEFF${board}`);
  const response = await f.write(source);
  expect(response.status).toBe(200);
  const result = (await response.json()) as {
    linkId: string;
    document: CadDocument;
  };
  expect(result.linkId).toMatch(/^[0-9a-f-]{36}$/);
  const link = linksOf(result.document)[result.linkId]!;
  expect(link).toEqual({
    sourceKind: "upload",
    sourceAsset: digest(source),
    sha256: digest(source),
    formatVersion: 20241229,
    snapshotAsset: expect.stringMatching(/^[0-9a-f]{64}$/),
    outlineOwner: "kicad",
  });
  expect(await f.store.blob(f.doc.id, link.sourceAsset)).toEqual(source);
  const snapshot = await f.store.blob(f.doc.id, link.snapshotAsset);
  expect(digest(snapshot)).toBe(link.snapshotAsset);
  expect(JSON.parse(snapshot.toString())).toMatchObject({
    version: 1,
    data: {
      formatVersion: 20241229,
      thickness: 1.6,
      footprints: [],
      warnings: [],
    },
  });
  expect(result.document.moduleAssets!.namespaces).toEqual({
    [namespace]: [link.sourceAsset, link.snapshotAsset],
  });
  expect(result.document.features).toEqual([]);
  expect(
    await backupNamespace(f.storage, f.store.documents.dir(f.doc.id)).names(),
  ).toEqual([]);
});

it.each([9, 10])(
  "uploads synthetic KiCad %i footprints and preserves optional generator metadata",
  async (version) => {
    const f = await fixture();
    const source = readFileSync(
      new URL(`fixtures/footprints-kicad${version}.kicad_pcb`, import.meta.url),
    );
    const response = await f.write(source);
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      linkId: string;
      document: CadDocument;
    };
    const link = linksOf(result.document)[result.linkId]!;
    expect(link.sha256).toBe(digest(source));
    const snapshot = JSON.parse(
      (await f.store.blob(f.doc.id, link.snapshotAsset)).toString(),
    );
    expect(snapshot.data.footprints).not.toHaveLength(0);
    expect(snapshot.data.formatVersion).toBe(link.formatVersion);
  },
);

it("keeps generator fields separate from the dated format and warns for newer boards", async () => {
  const f = await fixture();
  const response = await f.write(
    bytes(
      board
        .replace("20241229", "20990101")
        .replace(
          "(general",
          '(generator pcbnew) (generator_version "10.99") (general',
        ),
    ),
  );
  expect(response.status).toBe(200);
  const result = (await response.json()) as {
    linkId: string;
    document: CadDocument;
  };
  const link = linksOf(result.document)[result.linkId]!;
  expect(link).toMatchObject({
    formatVersion: 20990101,
    generator: "pcbnew",
    generatorVersion: "10.99",
  });
  expect(
    JSON.parse((await f.store.blob(f.doc.id, link.snapshotAsset)).toString())
      .data.warnings,
  ).toEqual(["untested version"]);
});

it("refuses malformed UTF-8, syntax, geometry and excessive nesting before storage", async () => {
  const f = await fixture();
  for (const source of [
    Buffer.concat([bytes(board), Buffer.from([0xc3, 0x28])]),
    bytes(board.slice(0, -1)),
    bytes(board.replace("(end 50 30)", "(end 0 0)")),
    bytes("(".repeat(1025) + ")".repeat(1025)),
    bytes(board.replace(/\)$/, ' (footprint "bad" (at nan 0)))')),
  ])
    await unchanged(f, () => f.write(source), 400);
  for (const body of [
    { source: "%" },
    { source: "Zh==" },
    { source: 3 },
    { source: "", bytes: [] },
  ])
    await unchanged(
      f,
      () => f.write(undefined, undefined, undefined, body),
      400,
    );
});

it("refuses viewer, outsider, missing revision and stale edits before storage", async () => {
  const f = await fixture();
  await unchanged(f, () => f.write(undefined, f.viewer), 403);
  await unchanged(f, () => f.write(undefined, f.outsider), 404);
  await unchanged(
    f,
    () => f.write(undefined, f.editor, f.doc.revision + 1),
    409,
  );
  await unchanged(
    f,
    () =>
      f.request(`/projects/${f.doc.id}/m/rockett/kicad/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: bytes(board).toString("base64") }),
      }),
    428,
  );
});

it("refuses configured budgets for either size ordering without storing the smaller asset", async () => {
  const sized = await fixture();
  const saved = await sized.write();
  expect(saved.status).toBe(200);
  const document = (await saved.json()).document as CadDocument;
  const link = Object.values(linksOf(document))[0]!;
  const snapshotBytes = (
    await sized.store.blob(sized.doc.id, link.snapshotAsset)
  ).length;
  expect(snapshotBytes).toBeGreaterThan(bytes(board).length);
  await close();
  close = async () => {};
  for (const source of [
    bytes(board),
    bytes(`${board}\n#${"padding".repeat(snapshotBytes)}`),
  ]) {
    const f = await fixture(Math.max(source.length, snapshotBytes) - 1);
    const before = await f.store.load(f.doc.id);
    const history = await (
      await f.request(`/projects/${f.doc.id}/history`)
    ).json();
    expect((await f.write(source)).status).toBe(413);
    expect(await f.store.blobs(f.doc.id).list()).toEqual([]);
    expect(await f.store.load(f.doc.id)).toEqual(before);
    expect(
      await (await f.request(`/projects/${f.doc.id}/history`)).json(),
    ).toEqual(history);
    await close();
    close = async () => {};
  }
});

it.each([
  { version: 3, data: unknown },
  { version: 0, data: { links: {} } },
  { version: 1, data: unknown },
  { version: 1, data: { links: { future: unknown } } },
])(
  "preserves and refuses unknown existing own data %j before storage",
  async (envelope) => {
    const f = await fixture();
    const doc = await f.store.load(f.doc.id);
    doc.extensions[namespace] = envelope;
    await f.store.save(doc, f.owner.user.id);
    await unchanged(f, () => f.write(), 400, "KiCad data");
  },
);

it.each(["missing", "corrupt", "foreign"])(
  "refuses %s prior link bytes before any new put",
  async (kind) => {
    const f = await fixture();
    expect((await f.write()).status).toBe(200);
    const doc = await f.store.load(f.doc.id);
    const link = Object.values(linksOf(doc))[0]!;
    if (kind === "corrupt") {
      await f.storage.writeAtomic(
        f.store.blobs(doc.id).file(link.sourceAsset),
        bytes("damaged"),
      );
    } else {
      const foreign = await f.store.create("Other board", f.owner.user.id);
      const hash =
        kind === "foreign"
          ? await f.store.blobs(foreign.id).put(bytes("foreign board"))
          : "0".repeat(64);
      link.sourceAsset = hash;
      link.sha256 = hash;
      doc.moduleAssets!.namespaces[namespace] = [];
      await f.store.save(doc, f.owner.user.id);
    }
    await unchanged(
      f,
      () => f.write(bytes(board.replace("50 30", "60 30"))),
      kind === "corrupt" ? 500 : 404,
    );
  },
);

it("keeps two stable links, prior own extras, foreign JSON and all declared references", async () => {
  const f = await fixture();
  const first = await f.write();
  expect(first.status).toBe(200);
  const saved = (await first.json()) as {
    linkId: string;
    document: CadDocument;
  };
  const doc = saved.document;
  const firstLink = linksOf(doc)[saved.linkId]!;
  Object.assign(firstLink, { extra: unknown });
  Object.assign(doc.extensions[namespace]!, { extra: unknown });
  Object.assign(doc.extensions[namespace]!.data as object, { extra: unknown });
  doc.extensions["future.module"] = Object.assign(
    { version: 99, data: unknown },
    { extra: unknown },
  );
  const prior = await f.store.blobs(f.doc.id).put(bytes("unknown own asset"));
  const foreign = await f.store.blobs(f.doc.id).put(bytes("foreign asset"));
  doc.moduleAssets!.namespaces[namespace]!.push(prior);
  doc.moduleAssets!.namespaces["future.module"] = [foreign];
  await f.store.save(doc, f.owner.user.id);
  const second = await f.write(bytes(board.replace("50 30", "60 30")));
  expect(second.status).toBe(200);
  const result = (await second.json()) as {
    linkId: string;
    document: CadDocument;
  };
  expect(result.linkId).not.toBe(saved.linkId);
  expect(linksOf(result.document)[saved.linkId]).toEqual(firstLink);
  expect(Object.keys(linksOf(result.document))).toHaveLength(2);
  expect(result.document.extensions["future.module"]).toEqual(
    doc.extensions["future.module"],
  );
  expect(result.document.extensions[namespace]).toMatchObject({
    extra: unknown,
    data: { extra: unknown },
  });
  expect(result.document.moduleAssets!.namespaces[namespace]).toContain(prior);
  expect(result.document.moduleAssets!.namespaces["future.module"]).toEqual([
    foreign,
  ]);
});

it.each(["disabled", "absent"] as const)(
  "retains featureless exact assets through undo, cold reads and project files with the module %s",
  async (state) => {
    const f = await fixture();
    const source = bytes(`\uFEFF${board}`);
    const response = await f.write(source);
    expect(response.status).toBe(200);
    const saved = (await response.json()).document as CadDocument;
    const link = Object.values(linksOf(saved))[0]!;
    const snapshot = await f.store.blob(f.doc.id, link.snapshotAsset);
    await f.move("undo");
    expect((await f.store.load(f.doc.id)).extensions).toEqual({});
    expect(
      await collectBlobs(f.store, f.doc.id, [], false, Number.MAX_SAFE_INTEGER),
    ).toMatchObject({ orphans: [], kept: 2 });
    await f.move("redo");
    await f.unavailable(state);
    expect((await f.write()).status).toBe(404);
    await f.move("rename", { name: "Board preserved" });
    await f.move("undo");
    await f.move("redo");
    const cold = new ProjectStore(f.storage, validateDocument);
    const exact = async (doc: CadDocument) => {
      expect(doc.features).toEqual([]);
      expect(doc.extensions).toEqual(saved.extensions);
      expect(doc.moduleAssets).toEqual(saved.moduleAssets);
      expect(await cold.blob(doc.id, link.sourceAsset)).toEqual(source);
      expect(await cold.blob(doc.id, link.snapshotAsset)).toEqual(snapshot);
    };
    await exact(await cold.load(f.doc.id));
    await exact(await cold.duplicate(f.doc.id, undefined, f.editor.user.id));
    const file = await f.download();
    expect(file.assets).toEqual({
      [link.sourceAsset]: source.toString("base64"),
      [link.snapshotAsset]: snapshot.toString("base64"),
    });
    const imported = await f.upload(file);
    expect(imported.status).toBe(200);
    await exact((await imported.json()).document);
  },
);

it("loads and backs up previous-schema bytes before initializing the first KiCad envelope", async () => {
  const f = await fixture();
  const previous = {
    ...f.doc,
    schemaVersion: 45,
    extensions: { "future.module": { version: 9, data: unknown } },
  };
  const raw = JSON.stringify(previous);
  const original = await f.store.documents.source(f.doc.id);
  await f.storage.writeAtomic(original.file, raw);
  expect((await f.write()).status).toBe(200);
  expect((await f.store.load(f.doc.id)).extensions["future.module"]).toEqual(
    previous.extensions["future.module"],
  );
  const backups = backupNamespace(f.storage, f.store.documents.dir(f.doc.id));
  const name = (await backups.names()).find((entry) =>
    entry.startsWith("v45-"),
  );
  expect(name).toBeDefined();
  await backups.restore(name!);
  expect((await f.storage.read(original.file)).toString()).toBe(raw);
  expect(
    (await new ProjectStore(f.storage, validateDocument).load(f.doc.id))
      .extensions,
  ).toEqual(previous.extensions);
});
