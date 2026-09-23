import { afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import { createEmptyDocument } from "@rockett/shared";
import { initKernel, volumeOf, getKernel } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { readImport } from "../src/geometry/importers.js";
import { createApiRouter } from "../src/api/routes.js";
import type { ImportLimits } from "../src/api/uploads.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { FolderStore } from "../src/store/folderStore.js";
import { ProjectQueue } from "../src/store/projectQueue.js";
import { LocalStorage } from "../src/store/storage.js";
import { sha256 } from "../src/store/jsonStore.js";
import { validateDocument } from "../src/api/validate.js";
import {
  largeStepFixture,
  stepBlob,
  stepFixture,
  stepSources,
} from "./helpers/stepFixture.js";
beforeAll(initKernel, 120000);

const stepFile = (data: string) => ({
  id: "step",
  type: "importStep" as const,
  name: "Imported",
  filename: "fixture.step",
  blob: stepBlob(data),
  suppressed: false,
});

it("imports multiple B-Rep bodies, persists them, and supports downstream fillets", () => {
  const doc = createEmptyDocument("step-test", "Imported");
  doc.features = [stepFile(stepFixture(true))];
  doc.timelinePosition = 1;
  let engine = engineFor(doc.id),
    result = engine.evaluate(doc, undefined, stepSources);
  expect(result.featureStatuses[0]).toEqual({
    featureId: "step",
    status: "ok",
  });
  expect(result.bodies).toHaveLength(2);
  expect(result.bodies[0]!.bbox.max).toEqual(
    [20, 30, 10].map((x) => expect.closeTo(x, 4)),
  );
  const state = engine.stateAt(doc, undefined, stepSources);
  expect(volumeOf(state.bodies.get("b:step")!.shape)).toBeCloseTo(6000, 3);
  const names = result.bodies[0]!.faces.map((f) => f.name);
  dropEngine(doc.id);
  engine = engineFor(doc.id);
  result = engine.evaluate(
    JSON.parse(JSON.stringify(doc)),
    undefined,
    stepSources,
  );
  expect(result.bodies[0]!.faces.map((f) => f.name)).toEqual(names);
  doc.features.push({
    id: "fillet",
    type: "fillet",
    name: "Fillet",
    suppressed: false,
    edges: [
      {
        kind: "edge",
        bodyId: "b:step",
        edgeName: result.bodies[0]!.edges[0]!.name,
      },
    ],
    radius: 1,
  });
  doc.timelinePosition = 2;
  expect(
    engine.evaluate(doc, undefined, stepSources).featureStatuses.at(-1)!.status,
  ).toBe("ok");
  expect(
    volumeOf(
      engine.stateAt(doc, undefined, stepSources).bodies.get("b:step")!.shape,
    ),
  ).toBeLessThan(6000);
  dropEngine(doc.id);
});

it("rejects invalid STEP and cleans its temporary kernel file", () => {
  expect(() =>
    readImport(stepFile("ISO-10303-21;\nnot a STEP model"), stepSources),
  ).toThrow("No solid found in the STEP file.");
  expect(
    getKernel()
      .FS.readdir("/")
      .filter((f: string) => f.endsWith(".step")),
  ).toEqual([]);
});

it("a file already at `/rockett-import.step` survives `readImport`", () => {
  const fs = getKernel().FS,
    file = "/rockett-import.step";
  fs.writeFile(file, "keep");
  readImport(stepFile(stepFixture(false)), stepSources).delete();
  expect(fs.analyzePath(file).exists).toBe(true);
  expect(fs.readFile(file, { encoding: "utf8" })).toBe("keep");
  fs.unlink(file);
  expect(fs.readdir("/").filter((f: string) => f.endsWith(".step"))).toEqual(
    [],
  );
});

describe("STEP upload", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()!();
  });

  async function server(limits?: Partial<ImportLimits>) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-upload-"));
    const storage = new LocalStorage(dir, fs);
    const store = new ProjectStore(storage, validateDocument);
    const app = express().use(
      "/api",
      createApiRouter(
        store,
        new FolderStore(storage),
        new ProjectQueue(),
        limits,
      ),
    );
    const listener = http.createServer(app);
    await new Promise<void>((resolve) => listener.listen(0, resolve));
    const port = (listener.address() as AddressInfo).port;
    closers.push(async () => {
      listener.closeAllConnections();
      await new Promise((resolve) => listener.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
    });
    const files = async (sub: string) =>
      (await fs
        .readdir(path.join(dir, sub), { recursive: true })
        .catch(() => [])) as string[];
    return {
      dir,
      port,
      store,
      leftovers: async () => ({
        uploads: await files("uploads"),
        projects: await files("projects"),
      }),
      upload(data: string | Uint8Array, name = "part.step") {
        const form = new FormData();
        form.append(
          "file",
          new Blob([typeof data === "string" ? data : new Uint8Array(data)]),
          name,
        );
        return fetch(`http://127.0.0.1:${port}/api/projects/import-step`, {
          method: "POST",
          body: form,
        });
      },
    };
  }

  async function until(test: () => Promise<boolean>) {
    for (let i = 0; i < 500; i++) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("condition not reached");
  }

  const clean = { uploads: [], projects: [] };

  it("imports a qualified 8 MB STEP within the default limits and records peak memory", async () => {
    const app = await server();
    const data = largeStepFixture(120),
      bytes = Buffer.from(data, "utf8");
    expect(bytes.length).toBeGreaterThan(8_000_000);
    expect(bytes.length).toBeLessThan(10 * 1024 * 1024);
    const peak = () => process.resourceUsage().maxRSS * 1024,
      before = peak();
    const res = await app.upload(bytes);
    expect(res.status).toBe(200);
    const { document } = await res.json();
    const hash = sha256(bytes);
    expect(document.features[0].blob).toBe(hash);
    const stored = await fs.readFile(
      path.join(app.dir, "projects", document.id, "blobs", hash),
    );
    expect(stored.equals(bytes)).toBe(true);
    expect((await app.leftovers()).uploads).toEqual([]);
    const wasm = getKernel().HEAP8.byteLength;
    console.log(
      `qualified STEP ${bytes.length} bytes: peak RSS ${before} bytes before the upload, ${peak()} after; WASM heap ${wasm} bytes`,
    );
    expect(wasm).toBeGreaterThan(0);
    dropEngine(document.id);
  }, 300_000);

  it("answers 413 above a low configured upload limit and keeps no file", async () => {
    const app = await server({ uploadBytes: 64 * 1024 });
    const res = await app.upload(Buffer.alloc(256 * 1024, "x"));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_large");
    expect(await app.leftovers()).toEqual(clean);
  });

  it("answers 413 above the import budget before the kernel parses the file", async () => {
    const app = await server({ importBytes: 1024 });
    const res = await app.upload(Buffer.alloc(4096, "x"));
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_large");
    expect(await app.leftovers()).toEqual(clean);
  });

  it("removes a cancelled upload and creates no project", async () => {
    const app = await server();
    const boundary = "rockett-cancel";
    const req = http.request({
      port: app.port,
      method: "POST",
      path: "/api/projects/import-step",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": 5 * 1024 * 1024,
      },
    });
    req.on("error", () => {});
    req.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="part.step"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    req.write(Buffer.alloc(1024 * 1024, "x"));
    await until(async () => (await app.leftovers()).uploads.length > 0);
    req.destroy();
    await until(async () => (await app.leftovers()).uploads.length === 0);
    expect(await app.leftovers()).toEqual(clean);
  });

  it("removes the upload of a file that fails to parse and keeps no project", async () => {
    const app = await server();
    const res = await app.upload("ISO-10303-21;\nnot a STEP model");
    expect(res.status).toBe(400);
    expect(await app.leftovers()).toEqual(clean);
  });

  it("keeps an existing blob when the same STEP is imported twice", async () => {
    const app = await server();
    const data = stepFixture();
    const first = await (await app.upload(data)).json();
    const again = await app.upload(data);
    expect(again.status).toBe(200);
    expect((await app.leftovers()).uploads).toEqual([]);
    dropEngine(first.document.id);
    dropEngine((await again.json()).document.id);
  });
});
