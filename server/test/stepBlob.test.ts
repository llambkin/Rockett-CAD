import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  createEmptyDocument,
  SCHEMA_VERSION,
  type CadDocument,
  type Feature,
} from "@rockett/shared";
import { initKernel, volumeOf } from "../src/geometry/kernel.js";
import { dropEngine, engineFor, featureKey } from "../src/geometry/engine.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { validateDocument } from "../src/api/validate.js";
import { LocalStorage } from "../src/store/storage.js";
import { stepFixture } from "./helpers/stepFixture.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

const raw = await fs.readFile(
  path.join(import.meta.dirname, "fixtures", "schema", "v7.json"),
  "utf8",
);
const fixture = JSON.parse(raw);
const id: string = fixture.id;
const inline: string = fixture.features.find(
  (f: Feature) => f.type === "importStep",
).data;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const hash = crypto
  .createHash("sha256")
  .update(Buffer.from(inline, "utf8"))
  .digest("hex");

let app: TestApp;

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

async function seeded(documentJson = raw, temporary = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-stepblob-"));
  const project = path.join(dir, "projects", id);
  await fs.mkdir(path.join(project, "assets"), { recursive: true });
  await fs.writeFile(path.join(project, "document.json"), documentJson);
  await fs.writeFile(path.join(project, "assets", "0123456789abcdef.png"), png);
  if (temporary)
    await fs.writeFile(
      path.join(project, "temporary.json"),
      JSON.stringify({ owner: null, touchedAt: new Date().toISOString() }),
    );
  const store = new ProjectStore(new LocalStorage(dir, fs), validateDocument);
  return { dir, project, store };
}

function stepOf(doc: CadDocument) {
  return doc.features.find((f) => f.type === "importStep")!;
}

async function importedBody(store: ProjectStore, doc: CadDocument) {
  dropEngine(doc.id);
  const engine = engineFor(doc.id);
  const sources = await store.sources(doc);
  const result = engine.evaluate(doc, undefined, sources);
  const status = result.featureStatuses.find((s) => s.featureId === "imp1");
  const body = result.bodies.find((b) => b.bodyId === "b:imp1")!;
  const volume = volumeOf(
    engine.stateAt(doc, undefined, sources).bodies.get("b:imp1")!.shape,
  );
  dropEngine(doc.id);
  return { status, volume, positions: body.positions, faces: body.faces };
}

async function exists(file: string) {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

describe("STEP sources in the blob store", () => {
  it("migrates inline STEP to a blob on the next save, keeping the kernel input and geometry", async () => {
    const { project, store } = await seeded();
    const loaded = await store.load(id);
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    const { data: _data, ...rest } = fixture.features.find(
      (f: Feature) => f.type === "importStep",
    );
    expect(stepOf(loaded)).toEqual({ ...rest, blob: hash });
    expect(await exists(path.join(project, "blobs"))).toBe(false);

    const before = await importedBody(store, loaded);
    expect(before.status).toEqual({ featureId: "imp1", status: "ok" });
    expect(before.volume).toBeCloseTo(6000, 6);

    await store.save(loaded);
    const saved = await fs.readFile(
      path.join(project, "document.json"),
      "utf8",
    );
    expect(saved).not.toContain('"data"');
    expect(saved).not.toContain("ISO-10303-21");
    expect(await fs.readFile(path.join(project, "blobs", hash))).toEqual(
      Buffer.from(inline, "utf8"),
    );

    const [backup] = await fs.readdir(
      path.join(project, "..", "..", "backups", "projects", id),
    );
    expect(
      await fs.readFile(
        path.join(
          project,
          "..",
          "..",
          "backups",
          "projects",
          id,
          backup!,
          "files",
          "document.json",
        ),
        "utf8",
      ),
    ).toBe(raw);

    const reopened = await store.load(id);
    const after = await importedBody(store, reopened);
    expect(after.volume).toBe(before.volume);
    expect(after.positions).toEqual(before.positions);
    expect(after.faces).toEqual(before.faces);
  });

  it("writes the blob for a temporary project that skips the backup", async () => {
    const { project, store } = await seeded(raw, true);
    await store.save(await store.load(id));
    expect(await fs.readFile(path.join(project, "blobs", hash))).toEqual(
      Buffer.from(inline, "utf8"),
    );
    expect(
      await exists(path.join(project, "..", "..", "backups", "projects", id)),
    ).toBe(false);
  });

  it("gives a duplicate of an unmigrated project its STEP blob", async () => {
    const { dir, store } = await seeded();
    const copy = await store.duplicate(id);
    expect(
      await fs.readFile(path.join(dir, "projects", copy.id, "blobs", hash)),
    ).toEqual(Buffer.from(inline, "utf8"));
    expect(
      (await importedBody(store, await store.load(copy.id))).volume,
    ).toBeCloseTo(6000, 6);
  });

  it("stores an uploaded STEP file as a blob and keeps it out of document.json", async () => {
    const form = new FormData();
    const text = stepFixture(false);
    form.append("file", new Blob([text]), "Box.step");
    const res = await app.request("/api/projects/import-step", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    const { document, evaluation } = await res.json();
    const blob = crypto.createHash("sha256").update(text).digest("hex");
    expect(document.features[0]).toMatchObject({ type: "importStep", blob });
    expect(document.features[0]).not.toHaveProperty("data");
    expect(evaluation.featureStatuses[0].status).toBe("ok");
    const projectDir = path.join(app.dataDir, "projects", document.id);
    expect(
      await fs.readFile(path.join(projectDir, "document.json"), "utf8"),
    ).not.toContain("ISO-10303-21");
    expect(
      await fs.readFile(path.join(projectDir, "blobs", blob), "utf8"),
    ).toBe(text);
  });

  it("round trips an old project file with inline STEP through upload and download", async () => {
    const legacy = {
      format: "rockett-project",
      version: 1,
      document: fixture,
      assets: { "0123456789abcdef.png": png.toString("base64") },
    };
    const form = new FormData();
    form.append("file", new Blob([JSON.stringify(legacy)]), "old.rockett");
    const up = await app.request("/api/projects/file", {
      method: "POST",
      body: form,
    });
    expect(up.status).toBe(200);
    const { document } = await up.json();
    expect(stepOf(document)).toMatchObject({ blob: hash });
    const down = await app.request(`/api/projects/${document.id}/file`);
    const file = await down.json();
    expect(Buffer.from(file.assets[hash], "base64")).toEqual(
      Buffer.from(inline, "utf8"),
    );
    const again = new FormData();
    again.append("file", new Blob([JSON.stringify(file)]), "new.rockett");
    const reup = await app.request("/api/projects/file", {
      method: "POST",
      body: again,
    });
    expect(reup.status).toBe(200);
    const copy = (await reup.json()).document;
    const res = await app.request(`/api/projects/${copy.id}/evaluate`);
    const evaluation = await res.json();
    expect(
      evaluation.featureStatuses.find(
        (s: { featureId: string }) => s.featureId === "imp1",
      ),
    ).toEqual({ featureId: "imp1", status: "ok" });
  });

  it("keys a 10 MB STEP feature in under 1 ms after migration", async () => {
    const big =
      "ISO-10303-21;\n" +
      "#1=CARTESIAN_POINT('',(0.,0.,0.));\n".repeat(300_000);
    expect(Buffer.byteLength(big)).toBeGreaterThan(10_000_000);
    const doc = createEmptyDocument(id, "Big");
    const legacy = {
      ...doc,
      schemaVersion: 7,
      features: [
        {
          id: "imp1",
          type: "importStep",
          name: "Big",
          suppressed: false,
          filename: "big.step",
          data: big,
        },
      ],
      timelinePosition: 1,
    };
    const { store } = await seeded(JSON.stringify(legacy));
    const loaded = await store.load(id);
    await store.save(loaded);
    const feature = (await store.load(id)).features[0]!;
    const runs = Array.from({ length: 21 }, () => {
      const start = performance.now();
      featureKey(feature);
      return performance.now() - start;
    }).sort((a, b) => a - b);
    expect(runs[10]).toBeLessThan(1);
  });
});
