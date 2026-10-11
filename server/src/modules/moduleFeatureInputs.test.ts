import { afterAll, beforeAll, expect, it } from "vitest";
import { Type } from "typebox";
import {
  createEmptyDocument,
  Placement,
  registerExtensionSpec,
  resolveDocumentParameters,
  type CadDocument,
  type ExtensionFeature,
} from "@rockett/shared";
import { engineFor, dropEngine, featureKey } from "../geometry/engine.js";
import { registerFeatureKind } from "../geometry/featureKinds.js";
import { registerBodySolids } from "../geometry/features.js";
import { bodyFingerprint } from "../geometry/fingerprint.js";
import { getKernel, initKernel, kernelVersion } from "../geometry/kernel.js";
import { finalizeNames } from "../geometry/naming.js";
import { ShapeMap } from "../geometry/shapeMap.js";
import { validateDocument } from "../api/validate.js";
import { ProjectStore } from "../store/projectStore.js";
import { HistoryStore } from "../store/historyStore.js";
import { collectBlobs } from "../store/blobGc.js";
import { sha256 } from "../store/jsonStore.js";
import { loadModules } from "./host.js";
import { InProcessKernel } from "../kernel/client.js";
import { FolderStore } from "../store/folderStore.js";
import { PLUGIN_API_VERSION, type ServerContext } from "@rockett/plugin-api";
import { featureSpec, resolvedFeatureInputs } from "@rockett/shared";
import { startTestApp } from "../../test/helpers/testApp.js";
import { MemoryStorage } from "../../test/helpers/memoryStorage.js";

type Linked = ExtensionFeature<{ linkId: string; choice?: number }>;
const storage = new MemoryStorage();
const store = new ProjectStore(storage, validateDocument);
const disposers: Array<() => void> = [];
let runs = 0;
let seen: unknown;

const linked: Linked = {
  id: "linked",
  name: "Linked",
  suppressed: false,
  type: "probe.input.block",
  version: 1,
  params: { linkId: "board" },
};

beforeAll(async () => {
  await initKernel();
  disposers.push(
    registerExtensionSpec({
      type: linked.type,
      label: "Linked",
      version: 1,
      params: Type.Object({
        linkId: Type.String(),
        choice: Type.Optional(Type.Number({ parameterUnit: "unitless" })),
      }),
      resolveInputs(input) {
        seen = input;
        const { params, extensions } = input;
        const snapshot = extensions["probe.input"]?.data as {
          links: Record<string, { hash: string; offset: number }>;
        };
        const source =
          snapshot?.links[`${params.linkId}${params.choice ?? ""}`];
        if (!source) throw new Error("linked source missing");
        return { identity: source, assets: [source.hash] };
      },
    }),
    registerFeatureKind({
      type: linked.type,
      evaluate({ state, sources, inputs }, f) {
        runs++;
        if (!inputs) throw new Error("resolved inputs missing");
        const bytes = sources.get(inputs.assets[0]!);
        if (!bytes) throw new Error("source bytes missing");
        const { width } = JSON.parse(Buffer.from(bytes).toString("utf8"));
        const { offset } = inputs.identity as { offset: number };
        const k = getKernel();
        const box = new k.BRepPrimAPI_MakeBox_2(width + offset, 2, 3);
        const shape = box.Shape();
        box.delete();
        registerBodySolids(
          state,
          `b:${f.id}`,
          shape,
          finalizeNames(shape, new ShapeMap(), f.id),
        );
        return { targets: ["b:linked"] };
      },
    }),
  );
});

afterAll(() => {
  for (const dispose of disposers.toReversed()) dispose();
});

async function fixture(owner = store) {
  const doc = await owner.create("Linked");
  const first = Buffer.from('{"width":10}');
  const second = Buffer.from('{"width":20}');
  const a = await owner.blobs(doc.id).put(first);
  const b = await owner.blobs(doc.id).put(second);
  doc.features = [structuredClone(linked)];
  doc.timelinePosition = 1;
  const replace = (hash: string, offset = 0) => {
    doc.extensions["probe.input"] = {
      version: 1,
      data: { links: { board: { hash, offset } } },
    };
  };
  replace(a);
  return { doc, first, second, a, b, replace };
}

async function evaluated(doc: CadDocument) {
  const sources = await store.sources(doc, engineFor(doc.id).sources);
  const evaluation = engineFor(doc.id).evaluate(doc, undefined, sources);
  expect(evaluation.featureStatuses.map((s) => s.status)).toEqual(["ok"]);
  const body = evaluation.bodies[0]!;
  return {
    sources,
    width: body.bbox.max[0],
    key: featureKey(doc.features[0]!, doc, sources),
    fingerprint: bodyFingerprint({
      doc,
      sources,
      bodyId: body.bodyId,
      placement: Placement.identity(),
      selection: [],
      camVersion: "1",
      kernel: kernelVersion(),
      evaluation,
    }),
  };
}

it("replaces committed extension input under unchanged link params and restores warm geometry and CAM identity on undo", async () => {
  const { doc, first, second, a, b, replace } = await fixture();
  try {
    const history = new HistoryStore(storage, store);
    await store.save(doc, null);
    const before = structuredClone(doc.features);
    const count = runs;
    const one = await evaluated(doc);
    expect(one.sources.get(a)).toEqual(first);
    expect(one.width).toBeCloseTo(10, 6);
    const same = structuredClone(doc);
    same.extensions["probe.input"] = {
      version: 1,
      data: { links: { board: { offset: 0, hash: a } } },
    };
    const noop = await evaluated(same);
    expect(noop.key).toBe(one.key);
    expect(noop.fingerprint).toBe(one.fingerprint);
    expect(runs).toBe(count + 1);
    replace(b);
    await history.save(doc, "Replace input");
    expect(doc.features).toEqual(before);
    const two = await evaluated(doc);
    expect(two.sources.get(b)).toEqual(second);
    expect(two.sources.has(a)).toBe(false);
    expect(two.width).toBeCloseTo(20, 6);
    expect(two.key).not.toBe(one.key);
    expect(two.fingerprint).not.toBe(one.fingerprint);
    const restored = await history.peek(doc, -1);
    Object.assign(doc, restored.document);
    await history.move(doc, restored.cursor);
    const undo = await evaluated(doc);
    expect(undo.width).toBeCloseTo(10, 6);
    expect(undo.key).toBe(one.key);
    expect(undo.fingerprint).toBe(one.fingerprint);
    const retained = await collectBlobs(store, doc.id, [], false);
    expect(retained.skipped).toMatch(/extension data/);
    expect(await store.blobs(doc.id).get(a)).toEqual(first);
    expect(await store.blobs(doc.id).get(b)).toEqual(second);
    replace(a, 4);
    const identityOnly = await evaluated(doc);
    expect(identityOnly.width).toBeCloseTo(14, 6);
    expect(identityOnly.key).not.toBe(one.key);
    expect(identityOnly.fingerprint).not.toBe(one.fingerprint);
    expect(doc.features).toEqual(before);
  } finally {
    dropEngine(doc.id);
  }
});

it("uses the same identity for implicit target aliases and crash quarantine", async () => {
  const { doc, a, b, replace } = await fixture();
  try {
    const one = await evaluated(doc);
    const sources = one.sources;
    const engine = engineFor(doc.id);
    engine.setQuarantine([{ featureId: linked.id, featureKey: one.key }]);
    const blocked = engine.evaluate(doc, undefined, sources);
    expect(blocked.featureStatuses[0]!.status).toBe("error");
    replace(b);
    expect((await evaluated(doc)).width).toBeCloseTo(20, 6);
    engine.setQuarantine([]);
    replace(a);
    await evaluated(doc);
    const count = runs;
    const withTargets = { ...linked, targets: ["b:linked"] };
    doc.features = [withTargets];
    const alias = await evaluated(doc);
    expect(alias.width).toBeCloseTo(10, 6);
    expect(runs).toBe(count);
    replace(b);
    expect((await evaluated(doc)).width).toBeCloseTo(20, 6);
    expect(runs).toBe(count + 1);
  } finally {
    dropEngine(doc.id);
  }
});

it("refuses missing, corrupt and another project's source even when held bytes claim its hash", async () => {
  const { doc, first, a, b, replace } = await fixture();
  const other = await store.create("Other");
  const foreignBytes = Buffer.from('{"width":30}');
  const foreign = await store.blobs(other.id).put(foreignBytes);
  replace(foreign);
  await expect(store.sources(doc)).rejects.toThrow(/not found/);
  await expect(
    store.sources(doc, new Map([[foreign, foreignBytes]])),
  ).rejects.toThrow(/not found/);
  replace(b);
  await storage.writeAtomic(store.blobs(doc.id).file(b), first);
  await expect(store.sources(doc)).rejects.toThrow(/corrupt/);
  await expect(
    store.sources(doc, new Map([[b, Buffer.from('{"width":20}')]])),
  ).rejects.toThrow(/corrupt/);
  replace(a);
  const sources = await store.sources(doc, new Map([[a, new Uint8Array()]]));
  expect(sources.get(a)).toEqual(first);
  const poisoned = new Map([[a, foreignBytes]]);
  expect(() => featureKey(linked, doc, poisoned)).toThrow(/corrupt/);
  expect(() => engineFor(doc.id).evaluate(doc, undefined, poisoned)).toThrow(
    /corrupt/,
  );
  dropEngine(doc.id);
  const missing = sha256("missing");
  replace(missing);
  await expect(store.sources(doc)).rejects.toThrow(/not found/);
});

it("gives pure detached immutable resolver inputs and leaves core feature key bytes identical", async () => {
  const { doc } = await fixture();
  await store.sources(doc);
  const input = seen as {
    params: Linked["params"];
    extensions: CadDocument["extensions"];
  };
  expect(input.params).toEqual(linked.params);
  expect(Object.isFrozen(input.params)).toBe(true);
  expect(Object.isFrozen(input.extensions["probe.input"]!.data)).toBe(true);
  expect(input.params).not.toBe(
    doc.features[0]!.type === linked.type
      ? (doc.features[0] as Linked).params
      : undefined,
  );
  expect(Object.isFrozen(input)).toBe(true);
  expect(Object.keys(input).toSorted()).toEqual(["extensions", "params"]);
  const core = {
    id: "x",
    type: "constructionPlane",
    name: "Plane",
    suppressed: false,
    method: {
      kind: "offset",
      base: { kind: "origin", plane: "XY" },
      distance: 3,
    },
  };
  expect(featureKey(core, doc, new Map())).toBe(JSON.stringify(core));
});

it("counts repeated module assets once without a false aggregate byte refusal", async () => {
  const { doc, replace } = await fixture();
  const bytes = Buffer.from('{"width":10}' + " ".repeat(2 * 1024 * 1024));
  const hash = await store.blobs(doc.id).put(bytes);
  replace(hash);
  doc.features = Array.from({ length: 50 }, (_, i) => ({
    ...linked,
    id: `linked${i}`,
  }));
  doc.timelinePosition = doc.features.length;
  expect(await store.sources(doc)).toEqual(new Map([[hash, bytes]]));
});

it("preserves module source bytes and unknown extensions through duplicate and .rockett round trips", async () => {
  const app = await startTestApp();
  try {
    const { doc, a, first } = await fixture(app.store);
    doc.extensions["unknown.keep"] = {
      version: 9,
      data: { opaque: [1, null, { value: "unchanged" }] },
    };
    await app.store.save(doc, null);
    const duplicate = await app.store.duplicate(doc.id);
    expect(duplicate.extensions).toEqual(doc.extensions);
    expect((await app.store.sources(duplicate)).get(a)).toEqual(first);
    const response = await app.request(`/api/projects/${doc.id}/file`);
    expect(response.status).toBe(200);
    const file = await response.json();
    expect(file.assets[a]).toBe(first.toString("base64"));
    const body = new FormData();
    body.append("file", new Blob([JSON.stringify(file)]), "linked.rockett");
    const uploaded = await app.request("/api/projects/file", {
      method: "POST",
      body,
    });
    expect(uploaded.status).toBe(200);
    const imported = (await uploaded.json()).document as CadDocument;
    expect(imported.extensions).toEqual(doc.extensions);
    expect((await app.store.sources(imported)).get(a)).toEqual(first);
    expect(await app.store.blob(imported.id, a)).toEqual(first);
  } finally {
    await app.close();
  }
});

it("round trips the named-parameter source used by module geometry without rewriting saved inputs", async () => {
  const app = await startTestApp();
  let projectId: string | undefined;
  try {
    const { doc, a, b, second } = await fixture(app.store);
    projectId = doc.id;
    doc.features = [{ ...linked, params: { linkId: "board", choice: 0 } }];
    doc.parameters = [
      { name: "choice", expression: "1", unit: "unitless", comment: "" },
    ];
    doc.parameterBindings = [
      { featureId: linked.id, path: "/params/choice", expression: "choice" },
    ];
    doc.extensions["probe.input"] = {
      version: 1,
      data: {
        links: {
          board0: { hash: a, offset: 0 },
          board1: { hash: b, offset: 0 },
        },
      },
    };
    await app.store.save(doc, null);
    const before = structuredClone(doc);
    const sources = await app.store.sources(doc);
    expect(sources).toEqual(new Map([[b, second]]));
    const effective = {
      ...doc,
      features: resolveDocumentParameters(doc).features,
    };
    const key = featureKey(effective.features[0]!, effective, sources);
    expect(JSON.parse(key)[1]).toEqual({
      identity: { hash: b, offset: 0 },
      assets: [b],
    });
    const result = engineFor(doc.id).evaluate(doc, undefined, sources);
    expect(result.featureStatuses[0]?.status).toBe("ok");
    expect(result.bodies[0]?.bbox.max[0]).toBeCloseTo(20, 6);
    const response = await app.request(`/api/projects/${doc.id}/file`);
    expect(response.status).toBe(200);
    const file = await response.json();
    expect(file.assets).toEqual({ [b]: second.toString("base64") });
    const body = new FormData();
    body.append("file", new Blob([JSON.stringify(file)]), "named.rockett");
    const uploaded = await app.request("/api/projects/file", {
      method: "POST",
      body,
    });
    expect(uploaded.status).toBe(200);
    const imported = (await uploaded.json()).document as CadDocument;
    expect(imported.features).toEqual(before.features);
    expect(imported.parameters).toEqual(before.parameters);
    expect(imported.parameterBindings).toEqual(before.parameterBindings);
    const importedSources = await app.store.sources(imported);
    expect(importedSources).toEqual(sources);
    const restored = {
      ...imported,
      features: resolveDocumentParameters(imported).features,
    };
    expect(featureKey(restored.features[0]!, restored, importedSources)).toBe(
      key,
    );
    expect(doc).toEqual(before);
  } finally {
    if (projectId) dropEngine(projectId);
    await app.close();
  }
});

it("scopes typed resolver registration to its module and removes it on unload and failed activation", async () => {
  const manifest = {
    manifestVersion: 1,
    id: "probe.lifecycle",
    name: "Lifecycle",
    version: "1.0.0",
    apiRange: `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`,
    licence: "MIT",
    author: "Acme",
    contributes: {},
  };
  const type = "probe.lifecycle.input";
  let context: ServerContext | undefined;
  const module = {
    manifest,
    server: {
      activate(ctx: ServerContext) {
        context = ctx;
        ctx.register.extensionSpec({
          type,
          label: "Input",
          version: 1,
          params: Type.Object({ number: Type.Number() }),
          resolveInputs: ({ params }) => ({
            identity: params.number,
            assets: [],
          }),
        });
      },
    },
  };
  const kernel = new InProcessKernel(store);
  const folders = new FolderStore(storage);
  const unload = await loadModules([module], kernel, store, folders);
  const feature: ExtensionFeature<{ number: number }> = {
    ...linked,
    type,
    params: { number: 4 },
  };
  try {
    expect(
      resolvedFeatureInputs(feature, createEmptyDocument("life", "Life")),
    ).toEqual({ identity: 4, assets: [] });
    expect(() =>
      context!.register.extensionSpec({
        type: "foreign.input",
        label: "Foreign",
        version: 1,
        params: Type.Object({}),
      }),
    ).toThrow(/must start/);
    expect(() =>
      context!.register.extensionSpec({
        type: "probe.lifecycle.nested.input",
        label: "Nested",
        version: 1,
        params: Type.Object({}),
      }),
    ).toThrow(/module/);
    expect(featureSpec("probe.lifecycle.nested.input")).toBeUndefined();
  } finally {
    unload();
  }
  expect(featureSpec(type)).toBeUndefined();
  const failed = await loadModules(
    [
      {
        manifest,
        server: {
          activate(ctx) {
            module.server.activate(ctx);
            throw new Error("failed after resolver");
          },
        },
      },
    ],
    kernel,
    store,
    folders,
  );
  expect(featureSpec(type)).toBeUndefined();
  failed();
});
