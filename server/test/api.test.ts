/**
 * API integration test: drives the MVP workflow through the real HTTP API —
 * create project → sketch → extrude → sketch on face → cut → fillet →
 * rollback → edit → measure → export → reload.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import { SCHEMA_VERSION, type EvaluateResult } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { createApiRouter } from "../src/api/routes.js";
import { stepFixture } from "./helpers/stepFixture.js";

let base = "";
let server: any;
let store: ProjectStore;
let storeDir = "";

beforeAll(async () => {
  await initKernel();
  storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-api-"));
  store = new ProjectStore(storeDir);
  await store.init();
  const app = express();
  app.use("/api", createApiRouter(store));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 120_000);

afterAll(() => {
  server?.close();
});

async function api(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  }
  if (type.includes("json")) return res.json();
  return Buffer.from(await res.arrayBuffer());
}

describe("REST API MVP workflow", () => {
  it("evaluates and edits at a temporary sketch position without changing the timeline marker", async () => {
    const { document } = await api("POST", "/projects", {
      name: "Temporary rollback",
    });
    const prefix = `/projects/${document.id}`;
    await api("POST", `${prefix}/features`, {
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
    const before = await api("GET", `${prefix}/evaluate`);
    await api("POST", `${prefix}/features`, {
      feature: {
        id: "ext",
        type: "extrude",
        name: "Extrude",
        suppressed: false,
        profiles: [
          { sketchId: "sk", profileId: before.sketches[0].profiles[0].id },
        ],
        distance: 5,
        direction: "normal",
        operation: "newBody",
      },
    });
    const preview = await api("GET", `${prefix}/evaluate?position=1`);
    expect(preview.bodies).toHaveLength(0);
    expect(preview.featureStatuses[1].status).toBe("rolledBack");
    expect((await api("GET", prefix)).document.timelinePosition).toBe(2);
    const edited = await api("PUT", `${prefix}/features/sk?position=1`, {
      feature: { name: "Edited sketch" },
    });
    expect(edited.document.timelinePosition).toBe(2);
    expect(edited.evaluation.bodies).toHaveLength(0);
    expect((await api("GET", `${prefix}/evaluate`)).bodies).toHaveLength(1);
    await expect(api("GET", `${prefix}/evaluate?position=100`)).rejects.toThrow(
      /400/,
    );
  });

  it("starts a project from STEP and imports into an existing project with undoable history", async () => {
    const upload = async (url: string, contents: string) => {
      const form = new FormData();
      form.append("file", new Blob([contents]), "Fixture.stp");
      return fetch(base + url, { method: "POST", body: form });
    };
    const source = stepFixture();
    const response = await upload("/projects/import-step", source);
    expect(response.status).toBe(200);
    const imported = await response.json();
    expect(imported.document.name).toBe("Fixture");
    expect(imported.evaluation.bodies).toHaveLength(1);
    expect(imported.document.features[0].data).toBe(source);
    const url = `/projects/${imported.document.id}`;
    const copy = await api("POST", url + "/duplicate");
    expect(
      (await api("GET", `/projects/${copy.document.id}/evaluate`)).bodies,
    ).toHaveLength(1);
    const added = await upload(url + "/import-step", source);
    expect(added.status).toBe(200);
    expect((await added.json()).evaluation.bodies).toHaveLength(2);
    const undone = await api("PUT", url + "/document", {
      document: imported.document,
    });
    expect(undone.evaluation.bodies).toHaveLength(1);
    const before = await api("GET", "/projects");
    expect(
      (await upload("/projects/import-step", "ISO-10303-21; broken")).status,
    ).toBe(400);
    expect(await api("GET", "/projects")).toEqual(before);
  });
  it("evaluates a body without display meta without writing the document", async () => {
    const form = new FormData();
    form.append("file", new Blob([stepFixture()]), "Fixture.stp");
    const response = await fetch(`${base}/projects/import-step`, {
      method: "POST",
      body: form,
    });
    const { document } = await response.json();
    const file = path.join(storeDir, "projects", document.id, "document.json");
    const stored = JSON.parse(await fs.readFile(file, "utf8"));
    stored.bodyMeta = {};
    await fs.writeFile(file, JSON.stringify(stored, null, 1), "utf8");
    const bytes = await fs.readFile(file);
    const evaluation = await api(
      "GET",
      `/projects/${document.id}/evaluate?position=1`,
    );
    expect(await fs.readFile(file)).toEqual(bytes);
    expect((await api("GET", `/projects/${document.id}`)).document).toEqual(
      stored,
    );
    expect(evaluation.bodies[0].name).toBe(evaluation.bodies[0].bodyId);
  });
  it("prepares projections from earlier geometry only, without changing the document", async () => {
    const { document } = await api("POST", "/projects", {
      name: "Projection test",
    });
    const url = `/projects/${document.id}`;
    const baseSketch = {
      id: "base",
      name: "Base",
      type: "sketch",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      constraints: [],
      entities: [
        { id: "a", kind: "point", x: 0, y: 0 },
        { id: "b", kind: "point", x: 20, y: 0 },
        { id: "c", kind: "point", x: 20, y: 10 },
        { id: "d", kind: "point", x: 0, y: 10 },
        { id: "ab", kind: "line", p1: "a", p2: "b" },
        { id: "bc", kind: "line", p1: "b", p2: "c" },
        { id: "cd", kind: "line", p1: "c", p2: "d" },
        { id: "da", kind: "line", p1: "d", p2: "a" },
      ],
    };
    let m = await api("POST", url + "/features", { feature: baseSketch });
    m = await api("POST", url + "/features", {
      feature: {
        id: "solid",
        name: "Solid",
        type: "extrude",
        suppressed: false,
        profiles: [
          {
            sketchId: "base",
            profileId: m.evaluation.sketches[0].profiles[0].id,
          },
        ],
        direction: "normal",
        distance: 10,
        operation: "newBody",
      },
    });
    const sourceEdge = m.evaluation.bodies[0].edges.find(
      (e: any) =>
        e.curve.type === "line" && Math.abs(e.curve.a[0] - e.curve.b[0]) > 1,
    );
    const edge = { kind: "edge", bodyId: "b:solid", edgeName: sourceEdge.name };
    await api("POST", url + "/features", {
      feature: { ...baseSketch, id: "target", name: "Target", entities: [] },
    });
    const before = await api("GET", url);
    const prepared = await api("POST", url + "/features/target/project", {
      edge,
      entityId: "reference",
    });
    expect(prepared.entities.at(-1)).toMatchObject({
      id: "reference",
      projection: edge,
      external: true,
    });
    expect(await api("GET", url)).toEqual(before);
    await expect(
      api("POST", url + "/features/base/project", { edge, entityId: "cyclic" }),
    ).rejects.toThrow(/earlier feature/);
    await expect(
      api("PUT", url + "/features/target", {
        feature: { entities: [baseSketch.entities[0], baseSketch.entities[0]] },
      }),
    ).rejects.toThrow(/duplicate sketch entity/);
    expect(await api("GET", url)).toEqual(before);
  });
  it("preserves overlapping feature additions and recovers after invalid requests", async () => {
    const { document } = await api("POST", "/projects", { name: "Concurrent" });
    const load = store.load.bind(store);
    // Widen the read/write window to reproduce stale simultaneous reads.
    const spy = vi.spyOn(store, "load").mockImplementation(async (id) => {
      const doc = await load(id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return doc;
    });
    try {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          api("POST", `/projects/${document.id}/features`, {
            feature: {
              id: `concurrent${i}`,
              type: "sketch",
              name: "",
              suppressed: false,
              plane: { kind: "origin", plane: "XY" },
              entities: [],
              constraints: [],
            },
          }),
        ),
      );
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const { document: saved } = await api("GET", `/projects/${document.id}`);
      expect(saved.features).toHaveLength(6);
      expect(new Set(saved.features.map((f: any) => f.name)).size).toBe(6);
      expect(saved.timelinePosition).toBe(6);
      await expect(
        api("POST", `/projects/${document.id}/timeline`, { position: -1 }),
      ).rejects.toThrow(/400/);
      const renamed = await api("POST", `/projects/${document.id}/rename`, {
        name: "Recovered",
      });
      expect(renamed.document.name).toBe("Recovered");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not recreate a deleted project when an old document is restored", async () => {
    const { document } = await api("POST", "/projects", { name: "Deleted" });
    await api("DELETE", `/projects/${document.id}`);
    await expect(
      api("PUT", `/projects/${document.id}/document`, { document }),
    ).rejects.toThrow(/404/);
    await expect(api("GET", `/projects/${document.id}`)).rejects.toThrow(/404/);
  });

  it("runs the full parametric workflow over HTTP", async () => {
    // create project
    const { document: created } = await api("POST", "/projects", {
      name: "MVP Part",
    });
    const id = created.id;

    // add base sketch (100x50 rect, constrained)
    await api("POST", `/projects/${id}/features`, {
      feature: {
        id: "sk1",
        type: "sketch",
        name: "",
        suppressed: false,
        plane: { kind: "origin", plane: "XY" },
        entities: [
          { id: "pa", kind: "point", x: 0, y: 0 },
          { id: "pb", kind: "point", x: 100, y: 0 },
          { id: "pc", kind: "point", x: 100, y: 50 },
          { id: "pd", kind: "point", x: 0, y: 50 },
          { id: "l1", kind: "line", p1: "pa", p2: "pb" },
          { id: "l2", kind: "line", p1: "pb", p2: "pc" },
          { id: "l3", kind: "line", p1: "pc", p2: "pd" },
          { id: "l4", kind: "line", p1: "pd", p2: "pa" },
        ],
        constraints: [
          { id: "cf", type: "fix", point: "pa" },
          { id: "ch1", type: "horizontal", line: "l1" },
          { id: "ch2", type: "horizontal", line: "l3" },
          { id: "cv1", type: "vertical", line: "l2" },
          { id: "cv2", type: "vertical", line: "l4" },
          { id: "cd1", type: "length", line: "l1", value: 100 },
          { id: "cd2", type: "length", line: "l2", value: 50 },
        ],
      },
    });

    // find profile id
    let evaluation: EvaluateResult = await api(
      "GET",
      `/projects/${id}/evaluate`,
    );
    const profileId = evaluation.sketches[0].profiles[0].id;

    // extrude 20mm
    let r = await api("POST", `/projects/${id}/features`, {
      feature: {
        id: "ext1",
        type: "extrude",
        name: "",
        suppressed: false,
        profiles: [{ sketchId: "sk1", profileId }],
        distance: 20,
        direction: "normal",
        operation: "newBody",
      },
    });
    expect(r.evaluation.bodies).toHaveLength(1);
    expect(r.evaluation.bodies[0].name).toBe("Body1");
    const topFace = r.evaluation.bodies[0].faces.find(
      (f: any) => f.name === "f:ext1:cap:end",
    );
    expect(topFace).toBeTruthy();

    // sketch a Ø10 circle on the top face
    r = await api("POST", `/projects/${id}/features`, {
      feature: {
        id: "sk2",
        type: "sketch",
        name: "",
        suppressed: false,
        plane: {
          kind: "face",
          face: { kind: "face", bodyId: "b:ext1", faceName: "f:ext1:cap:end" },
        },
        entities: [
          { id: "cc", kind: "point", x: 30, y: 25 },
          { id: "circ", kind: "circle", center: "cc", radius: 5 },
        ],
        constraints: [
          { id: "cf", type: "fix", point: "cc" },
          { id: "cd", type: "diameter", entity: "circ", value: 10 },
        ],
      },
    });
    const sk2 = r.evaluation.sketches.find((s: any) => s.featureId === "sk2");
    const circleProfile = sk2.profiles[0].id;

    // cut through
    r = await api("POST", `/projects/${id}/features`, {
      feature: {
        id: "cut1",
        type: "extrude",
        name: "",
        suppressed: false,
        profiles: [{ sketchId: "sk2", profileId: circleProfile }],
        distance: 25,
        direction: "reverse",
        operation: "cut",
      },
    });
    expect(
      r.evaluation.featureStatuses.every((s: any) => s.status === "ok"),
    ).toBe(true);

    // fillet a corner edge
    const edge = r.evaluation.bodies[0].edges.find((e: any) => {
      if (e.curve.type !== "line") return false;
      const { a, b } = e.curve;
      return (
        Math.abs(a[0]) < 1e-6 &&
        Math.abs(a[1]) < 1e-6 &&
        Math.abs(b[0]) < 1e-6 &&
        Math.abs(b[1]) < 1e-6
      );
    });
    expect(edge).toBeTruthy();
    r = await api("POST", `/projects/${id}/features`, {
      feature: {
        id: "fil1",
        type: "fillet",
        name: "",
        suppressed: false,
        edges: [{ kind: "edge", bodyId: "b:ext1", edgeName: edge.name }],
        radius: 3,
      },
    });
    expect(r.evaluation.featureStatuses[4].status).toBe("ok");

    // roll back before the hole (position 2 = after ext1)
    r = await api("POST", `/projects/${id}/timeline`, { position: 2 });
    expect(r.evaluation.featureStatuses[2].status).toBe("rolledBack");
    expect(r.evaluation.featureStatuses[4].status).toBe("rolledBack");

    // edit the base rectangle to 120 wide while rolled back
    const doc = r.document;
    const sk1 = doc.features.find((f: any) => f.id === "sk1");
    sk1.constraints.find((c: any) => c.id === "cd1").value = 120;
    r = await api("PUT", `/projects/${id}/features/sk1`, { feature: sk1 });

    // return to end of timeline
    r = await api("POST", `/projects/${id}/timeline`, { position: 5 });
    expect(
      r.evaluation.featureStatuses.every((s: any) => s.status === "ok"),
    ).toBe(true);
    expect(Math.round(r.evaluation.bodies[0].bbox.max[0])).toBe(120);

    // measure two vertices (diagonal of the base face)
    const verts = r.evaluation.bodies[0].vertices;
    // (0,0) corner was filleted away — measure across the other diagonal
    const v0 = verts.find(
      (v: any) =>
        Math.abs(v.position[0]) < 1e-6 &&
        Math.abs(v.position[1] - 50) < 1e-6 &&
        Math.abs(v.position[2] - 20) < 1e-6,
    );
    const v1 = verts.find(
      (v: any) =>
        Math.abs(v.position[0] - 120) < 1e-6 &&
        Math.abs(v.position[1]) < 1e-6 &&
        Math.abs(v.position[2] - 20) < 1e-6,
    );
    expect(v0 && v1).toBeTruthy();
    const m = await api("POST", `/projects/${id}/measure`, {
      refs: [
        { kind: "vertex", bodyId: "b:ext1", vertexName: v0.name },
        { kind: "vertex", bodyId: "b:ext1", vertexName: v1.name },
      ],
    });
    expect(m.distance).toBeCloseTo(Math.hypot(120, 50), 4);

    // export STL + 3MF
    const stl = await api("POST", `/projects/${id}/export`, {
      format: "stl",
      bodyIds: [],
    });
    expect(stl.readUInt32LE(80)).toBeGreaterThan(10);
    const mf = await api("POST", `/projects/${id}/export`, {
      format: "3mf",
      bodyIds: [],
    });
    expect(mf.length).toBeGreaterThan(100);
    // zip magic
    expect(mf[0]).toBe(0x50);
    expect(mf[1]).toBe(0x4b);

    // reload the project — parametric history intact
    const { document: reloaded } = await api("GET", `/projects/${id}`);
    expect(reloaded.features).toHaveLength(5);
    expect(reloaded.features.map((f: any) => f.type)).toEqual([
      "sketch",
      "extrude",
      "sketch",
      "extrude",
      "fillet",
    ]);
    expect(
      reloaded.features[0].constraints.find((c: any) => c.id === "cd1").value,
    ).toBe(120);
    expect(reloaded.bodyMeta["b:ext1"].name).toBe("Body1");
  }, 120_000);

  it("rejects invalid input", async () => {
    const { document } = await api("POST", "/projects", { name: "Val" });
    await expect(
      api("POST", `/projects/${document.id}/features`, {
        feature: {
          id: "bad1",
          type: "extrude",
          name: "x",
          suppressed: false,
          profiles: [{ sketchId: "s", profileId: "p" }],
          distance: Number.NaN,
          direction: "normal",
          operation: "newBody",
        },
      }),
    ).rejects.toThrow(/400/);
    await expect(api("GET", "/projects/../../etc")).rejects.toThrow();
    const url = `/projects/${document.id}`;
    await expect(
      api("POST", `${url}/features`, {
        feature: { id: "cam1", type: "cam", name: "x", suppressed: false },
      }),
    ).rejects.toThrow(/400.*unknown feature type cam/);
    await expect(
      api("POST", `${url}/features`, {
        feature: { id: "cp1", type: "constructionPlane" },
      }),
    ).rejects.toThrow(/400/);
    await api("POST", `${url}/features`, {
      feature: {
        id: "sk",
        type: "sketch",
        name: "Sketch",
        suppressed: false,
        plane: { kind: "origin", plane: "XY" },
        entities: [],
        constraints: [],
      },
    });
    await expect(
      api("PUT", `${url}/features/sk`, { feature: { type: "extrude" } }),
    ).rejects.toThrow(/400.*type cannot change/);
    const { document: saved } = await api("GET", url);
    expect(saved.features.map((f: any) => f.type)).toEqual(["sketch"]);
    await expect(
      api("POST", `${url}/export`, { format: "step", bodyIds: [] }),
    ).rejects.toThrow(/400.*supported: stl, 3mf/);
  });

  it("accepts a PNG and rejects malformed or oversized uploads", async () => {
    const { document } = await api("POST", "/projects", { name: "Uploads" });
    const post = async (url: string, field: string, bytes: Buffer) => {
      const form = new FormData();
      form.append(field, new Blob([new Uint8Array(bytes)]), "upload");
      return fetch(base + url, { method: "POST", body: form });
    };
    const assets = `/projects/${document.id}/assets`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const accepted = await post(assets, "image", png);
    expect(accepted.status).toBe(200);
    const { assetId } = await accepted.json();
    const stored = await fetch(`${base}${assets}/${assetId}`);
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(png);
    const malformed = Buffer.concat([
      png.subarray(0, 8),
      Buffer.from("not a PNG chunk stream at all"),
    ]);
    expect((await post(assets, "image", malformed)).status).toBe(400);
    const image = Buffer.alloc(25 * 1024 * 1024 + 1);
    png.copy(image);
    const tooLarge = await post(assets, "image", image);
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).error).toMatch(/25 MB/);
    const before = await api("GET", "/projects");
    const step = Buffer.alloc(10 * 1024 * 1024 + 1, " ");
    const stepTooLarge = await post("/projects/import-step", "file", step);
    expect(stepTooLarge.status).toBe(413);
    expect((await stepTooLarge.json()).error).toMatch(/10 MB/);
    expect(await api("GET", "/projects")).toEqual(before);
  });

  it("accepts only known feature keys", async () => {
    const { document } = await api("POST", "/projects", { name: "Keys" });
    const url = `/projects/${document.id}`;
    const sketch = {
      id: "sk",
      type: "sketch",
      name: "Sketch",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: [],
      constraints: [],
    };
    await api("POST", `${url}/features`, { feature: sketch });
    const file = path.join(storeDir, "projects", document.id, "document.json");
    const before = await fs.readFile(file);
    await expect(
      api("PUT", `${url}/features/sk`, { feature: "abc" }),
    ).rejects.toThrow(/400.*feature must be an object/);
    await expect(
      api("PUT", `${url}/features/sk`, { feature: { bogus: 1 } }),
    ).rejects.toThrow(/400.*unknown sketch key bogus/);
    await expect(
      api("POST", `${url}/features`, { feature: "abc" }),
    ).rejects.toThrow(/400.*feature must be an object/);
    await expect(
      api("POST", `${url}/features`, {
        feature: { ...sketch, id: "sk2", bogus: 1 },
      }),
    ).rejects.toThrow(/400.*unknown sketch key bogus/);
    expect((await fs.readFile(file)).equals(before)).toBe(true);
  });

  it("reports version, schema version, commit and describe on health", async () => {
    const root = JSON.parse(
      await fs.readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    vi.stubEnv("ROCKETT_COMMIT", "");
    vi.stubEnv("ROCKETT_DESCRIBE", "");
    expect(await api("GET", "/health")).toEqual({
      ok: true,
      version: root.version,
      schemaVersion: SCHEMA_VERSION,
      commit: null,
      describe: null,
    });
    vi.stubEnv("ROCKETT_COMMIT", "2267c0d5a1b2c3d4e5f60718293a4b5c6d7e8f90");
    vi.stubEnv("ROCKETT_DESCRIBE", "v0.1.0-12-g2267c0d");
    expect(await api("GET", "/health")).toMatchObject({
      commit: "2267c0d5a1b2c3d4e5f60718293a4b5c6d7e8f90",
      describe: "v0.1.0-12-g2267c0d",
    });
  });
});

describe("built app", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  let child: ChildProcess | undefined;
  let origin = "";
  let dataDir = "";

  beforeAll(async () => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore" });
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-built-"));
    const proc = spawn(process.execPath, ["server/dist/server.js"], {
      cwd: root,
      env: { ...process.env, ROCKETT_PORT: "0", DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "inherit"],
    });
    child = proc;
    origin = await new Promise<string>((resolve, reject) => {
      let out = "";
      proc.stdout.on("data", (chunk) => {
        out += chunk;
        const port = /listening on http:\/\/0\.0\.0\.0:(\d+)/.exec(out)?.[1];
        if (port) resolve(`http://127.0.0.1:${port}`);
      });
      proc.once("exit", (code) =>
        reject(new Error(`built server exited with ${code}`)),
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child!.once("exit", resolve));
      child.kill();
      await exited;
    }
    if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("serves the built client for an SPA deep link", async () => {
    const res = await fetch(`${origin}/projects/x`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toMatch(/src="\/assets\/index-[\w-]+\.js"/);
  });

  it("answers an unknown API path with a JSON 404", async () => {
    const res = await fetch(`${origin}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
