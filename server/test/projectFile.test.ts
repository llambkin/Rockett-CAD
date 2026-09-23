import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SCHEMA_VERSION, type CadDocument } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let app: TestApp;
let project: CadDocument;
let assetId = "";

async function json(url: string, init: RequestInit = {}): Promise<any> {
  const res = await app.request(`/api${url}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status).toBe(200);
  return res.json();
}

function form(field: string, bytes: Buffer | string, name: string) {
  const body = new FormData();
  body.append(
    field,
    new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)]),
    name,
  );
  return body;
}

async function upload(file: unknown): Promise<Response> {
  const bytes = typeof file === "string" ? file : JSON.stringify(file);
  return app.request("/api/projects/file", {
    method: "POST",
    body: form("file", bytes, "project.rockett"),
  });
}

async function download(id: string): Promise<any> {
  const res = await app.request(`/api/projects/${id}/file`);
  expect(res.status).toBe(200);
  return res.json();
}

async function projectDirs(): Promise<Set<string>> {
  return new Set(await fs.readdir(path.join(app.dataDir, "projects")));
}

function referenceImage(id: string, asset: string) {
  return {
    id,
    type: "referenceImage",
    name: id,
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    assetId: asset,
    fileName: "photo.png",
    transform: { u: 0, v: 0, rotation: 0, scale: 1 },
    opacity: 0.5,
    visible: true,
    width: 1,
    height: 1,
  };
}

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
  const { document } = await json("/projects", {
    method: "POST",
    body: JSON.stringify({ name: 'Bracket ö "v2"' }),
  });
  const prefix = `/projects/${document.id}`;
  const post = (url: string, body: FormData) =>
    app.request(`/api${prefix}${url}`, { method: "POST", body });
  assetId = (await (await post("/assets", form("image", png, "a.png"))).json())
    .assetId;
  await post("/assets", form("image", png, "unused.png"));
  const add = (feature: object) =>
    json(`${prefix}/features`, {
      method: "POST",
      body: JSON.stringify({ feature }),
    });
  const sketch = await add({
    id: "sk",
    type: "sketch",
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [
      { id: "p", kind: "point", x: 0, y: 0 },
      { id: "c", kind: "circle", center: "p", radius: 10 },
    ],
    constraints: [],
  });
  await add({
    id: "ext",
    type: "extrude",
    name: "Extrude",
    suppressed: false,
    profiles: [
      {
        sketchId: "sk",
        profileId: sketch.evaluation.sketches[0].profiles[0].id,
      },
    ],
    distance: 5,
    direction: "normal",
    operation: "newBody",
  });
  project = (await add(referenceImage("img", assetId))).document;
}, 120_000);

afterAll(() => app?.close());

describe("project file", () => {
  it("downloads a project with only its referenced assets and imports it under a new id", async () => {
    const res = await app.request(`/api/projects/${project.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename=\"Bracket_v2_.rockett\"; filename*=UTF-8''Bracket%20%C3%B6%20%22v2%22.rockett",
    );
    const file = await res.json();
    expect(file).toEqual({
      format: "rockett-project",
      version: 1,
      document: project,
      assets: { [assetId]: png.toString("base64") },
    });
    const before = await projectDirs();
    const imported = await upload(file);
    expect(imported.status).toBe(200);
    const { document } = await imported.json();
    expect(document.id).not.toBe(project.id);
    expect(document.revision).toBe(1);
    expect({
      ...document,
      id: project.id,
      modifiedAt: project.modifiedAt,
      revision: project.revision,
    }).toEqual(project);
    expect(await projectDirs()).toEqual(new Set([...before, document.id]));
    expect((await json(`/projects/${document.id}`)).document).toEqual(document);
    const asset = await app.request(
      `/api/projects/${document.id}/assets/${assetId}`,
    );
    expect(Buffer.from(await asset.arrayBuffer())).toEqual(png);
  });

  it("names the download for a project name with a lone surrogate", async () => {
    const { document } = await json("/projects", {
      method: "POST",
      body: JSON.stringify({ name: "a\ud800b" }),
    });
    const res = await app.request(`/api/projects/${document.id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename=\"a_b.rockett\"; filename*=UTF-8''a%EF%BF%BDb.rockett",
    );
  });

  it("imports a schema 4 file at the current schema", async () => {
    const file = await download(project.id);
    file.document.schemaVersion = 4;
    const res = await upload(file);
    expect(res.status).toBe(200);
    const { document } = await res.json();
    expect(document.schemaVersion).toBe(SCHEMA_VERSION);
    expect(
      (await json(`/projects/${document.id}`)).document.schemaVersion,
    ).toBe(SCHEMA_VERSION);
  });

  it.each<[string, (file: any) => unknown, RegExp]>([
    ["a newer file version", (f) => ({ ...f, version: 2 }), /version 2.*1/],
    [
      "a newer document schema",
      (f) => ({
        ...f,
        document: { ...f.document, schemaVersion: SCHEMA_VERSION + 1 },
      }),
      new RegExp(`schema ${SCHEMA_VERSION + 1}.*${SCHEMA_VERSION}`),
    ],
    ["a missing asset", (f) => ({ ...f, assets: {} }), /missing asset/],
    [
      "an unreferenced asset",
      (f) => ({
        ...f,
        assets: { ...f.assets, "0123456789abcdef.png": f.assets[assetId] },
      }),
      /not referenced/,
    ],
    [
      "a bad image",
      (f) => ({
        ...f,
        assets: { [assetId]: Buffer.from("not an image").toString("base64") },
      }),
      /unsupported image type/,
    ],
    [
      "an image under the wrong extension",
      (f) => ({
        ...f,
        assets: {
          [assetId]: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"),
        },
      }),
      /extension/,
    ],
    [
      "asset bytes that are not base64",
      (f) => ({ ...f, assets: { [assetId]: "!!not base64!!" } }),
      /base64/,
    ],
    [
      "a malformed document",
      (f) => ({ ...f, document: { ...f.document, timelinePosition: -1 } }),
      /timelinePosition/,
    ],
    [
      "an asset name that escapes the project",
      (f) => {
        const trick = "../../escape.png";
        return {
          ...f,
          document: {
            ...f.document,
            features: [...f.document.features, referenceImage("trick", trick)],
          },
          assets: { ...f.assets, [trick]: f.assets[assetId] },
        };
      },
      /invalid asset id/,
    ],
    ["another format", (f) => ({ ...f, format: "other" }), /format/],
    ["text that is not JSON", () => "{ broken", /not a Rockett project file/],
  ])(
    "rejects %s with 400 and creates nothing",
    async (_name, change, error) => {
      const file = change(await download(project.id));
      const before = await projectDirs();
      const res = await upload(file);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: "validation",
        error: expect.stringMatching(error),
      });
      expect(await projectDirs()).toEqual(before);
    },
  );

  it("rejects a request without a file and one over 64 MB", async () => {
    const before = await projectDirs();
    const empty = await app.request("/api/projects/file", {
      method: "POST",
      body: new FormData(),
    });
    expect(empty.status).toBe(400);
    const big = await app.request("/api/projects/file", {
      method: "POST",
      body: form(
        "file",
        Buffer.alloc(64 * 1024 * 1024 + 1, " "),
        "big.rockett",
      ),
    });
    expect(big.status).toBe(413);
    expect((await big.json()).error).toMatch(/64 MB/);
    expect(await projectDirs()).toEqual(before);
  });
});
