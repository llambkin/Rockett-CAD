import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  createEmptyDocument,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  SCHEMA_VERSION,
} from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { scheduleSweep } from "../src/app.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";
import { trackRevisions } from "./helpers/revisions.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let clock = Date.parse("2026-09-23T00:00:00.000Z");
let app: TestApp;
const send = trackRevisions((url, init) => app.request(url, init));

beforeAll(async () => {
  await initKernel();
  app = await startTestApp({ now: () => clock });
}, 120_000);

afterAll(() => app?.close());

async function call(method: string, url: string, body?: unknown) {
  const res = await send(`/api${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

async function upload(fields: Record<string, string> = {}) {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  const file = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    document: createEmptyDocument("source", "Motor mount"),
    assets: {},
  };
  body.append("file", new Blob([JSON.stringify(file)]), "p.rockett");
  const res = await send("/api/projects/file", { method: "POST", body });
  return { status: res.status, body: await res.json() };
}

async function temporary(): Promise<string> {
  const { status, body } = await upload({ temporary: "true" });
  expect(status).toBe(200);
  return body.document.id;
}

const dir = (id: string) => path.join(app.dataDir, "projects", id);

const exists = (target: string) =>
  fs.access(target).then(
    () => true,
    () => false,
  );

async function marker(id: string) {
  return JSON.parse(
    await fs.readFile(path.join(dir(id), "temporary.json"), "utf8"),
  );
}

const listed = async (): Promise<string[]> =>
  (await call("GET", "/projects")).body.map((p: { id: string }) => p.id);

describe("temporary projects", () => {
  it("evaluates and takes a feature, stays off the list and cannot move to a folder", async () => {
    const id = await temporary();
    expect(await marker(id)).toEqual({
      owner: null,
      touchedAt: new Date(clock).toISOString(),
    });
    const added = await call("POST", `/projects/${id}/features`, {
      feature: {
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
      },
    });
    expect(added.status).toBe(200);
    expect(added.body.evaluation.sketches[0].profiles).toHaveLength(1);
    const evaluated = await call("GET", `/projects/${id}/evaluate`);
    expect(evaluated.status).toBe(200);
    expect(await listed()).not.toContain(id);
    const folder = (await call("POST", "/folders", { name: "Parts" })).body
      .folder.id;
    for (const folderId of [folder, null]) {
      const moved = await call("PUT", `/projects/${id}/folder`, { folderId });
      expect(moved.status).toBe(400);
    }
    expect((await call("GET", "/folders")).body.placement[id]).toBeUndefined();
  });

  it("moves touchedAt on a request, at most once a minute", async () => {
    const id = await temporary();
    const created = new Date(clock).toISOString();
    clock += 30_000;
    expect((await call("GET", `/projects/${id}`)).status).toBe(200);
    expect((await marker(id)).touchedAt).toBe(created);
    clock += MINUTE;
    expect((await call("GET", `/projects/${id}/evaluate`)).status).toBe(200);
    expect((await marker(id)).touchedAt).toBe(new Date(clock).toISOString());
  });

  it("is swept 24 hours and one minute after touchedAt, and kept at 23 hours", async () => {
    const id = await temporary();
    const kept = (await call("POST", "/projects", { name: "Kept" })).body
      .document.id;
    const start = clock;
    clock = start + 23 * HOUR;
    await app.sweep();
    expect(await exists(dir(id))).toBe(true);
    clock = start + 24 * HOUR + MINUTE;
    await app.sweep();
    expect(await exists(dir(id))).toBe(false);
    expect((await call("GET", `/projects/${id}`)).status).toBe(404);
    expect(await exists(dir(kept))).toBe(true);
  });

  it("is removed by DELETE", async () => {
    const id = await temporary();
    expect((await call("DELETE", `/projects/${id}`)).status).toBe(200);
    expect(await exists(dir(id))).toBe(false);
  });

  it("is never backed up before migration", async () => {
    const id = "schema-v4";
    const fixture = await fs.readFile(
      path.join(import.meta.dirname, "fixtures", "schema", "v4.json"),
    );
    await fs.mkdir(dir(id), { recursive: true });
    await fs.writeFile(path.join(dir(id), "document.json"), fixture);
    await fs.writeFile(
      path.join(dir(id), "temporary.json"),
      JSON.stringify({ owner: null, touchedAt: new Date(clock).toISOString() }),
    );
    expect((await call("GET", `/projects/${id}`)).status).toBe(200);
    const renamed = await call("POST", `/projects/${id}/rename`, {
      name: "Renamed",
    });
    expect(renamed.status).toBe(200);
    const saved = JSON.parse(
      await fs.readFile(path.join(dir(id), "document.json"), "utf8"),
    );
    expect(saved).toMatchObject({
      name: "Renamed",
      schemaVersion: SCHEMA_VERSION,
    });
    expect(
      await exists(path.join(app.dataDir, "backups", "projects", id)),
    ).toBe(false);
  });
});

describe("project file upload fields", () => {
  let uploads = "";

  beforeAll(async () => {
    uploads = (await call("POST", "/folders", { name: "Uploads" })).body.folder
      .id;
  });

  it("places the new project in folderId", async () => {
    const { status, body } = await upload({ folderId: uploads });
    expect(status).toBe(200);
    const id = body.document.id;
    expect((await call("GET", "/folders")).body.placement[id]).toBe(uploads);
    expect(await listed()).toContain(id);
    expect(await exists(path.join(dir(id), "temporary.json"))).toBe(false);
  });

  it.each<[string, Record<string, string>]>([
    ["a missing folderId", { folderId: "missing" }],
    ["temporary with folderId", { temporary: "true", folderId: "uploads" }],
    ["temporary other than true", { temporary: "yes" }],
  ])("rejects %s and creates nothing", async (_, fields) => {
    const before = await listed();
    const dirs = await fs.readdir(path.join(app.dataDir, "projects"));
    const { status, body } = await upload({
      ...fields,
      ...(fields.folderId === "uploads" && { folderId: uploads }),
    });
    expect(status).toBe(400);
    expect(body.code).toBe("validation");
    expect(await listed()).toEqual(before);
    expect(await fs.readdir(path.join(app.dataDir, "projects"))).toEqual(dirs);
  });
});

describe("temporary sweep timer", () => {
  it("sweeps at start and every hour until the server closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let runs = 0;
      const server = http.createServer();
      scheduleSweep(server, async () => {
        runs++;
      });
      expect(runs).toBe(1);
      vi.advanceTimersByTime(HOUR);
      expect(runs).toBe(2);
      server.emit("close");
      vi.advanceTimersByTime(3 * HOUR);
      expect(runs).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
