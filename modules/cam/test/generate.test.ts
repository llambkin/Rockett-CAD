import { serverRegister } from "./helpers/serverRegister.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CadDocument,
  KernelJobRun,
  ModuleFiles,
  ServerBody,
  User,
} from "@rockett/plugin-api";
import {
  CACHE_BYTES,
  MAX_CACHE_BYTES,
  programCache,
} from "../src/server/cache.js";
import cam from "../server.js";
import {
  generateRoute,
  generator,
  type GenerateRequest,
} from "../src/server/generate.js";
import {
  CAM_EXTENSION,
  migrateCam,
  programRoute,
  saveCam,
  type CamData,
} from "../src/shared/document.js";
import { stockBox } from "../src/shared/setup.js";
import { facing } from "../src/toolpath/facing.js";
import { box, brep, startKernel } from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;

const core = (file: string) =>
  import(new URL(`../../../server/src/${file}`, import.meta.url).href);

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

const request: GenerateRequest = {
  projectId: "p1",
  user: mark,
  setup: {
    id: "s1",
    bodies: ["b1"],
    stock: {
      kind: "boxAround",
      margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 2.5 },
    },
    wcs: {
      origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
      axes: { x: "+x", z: "+z" },
      offsetIndex: 1,
      machine: { kind: "unknown" },
    },
    safeHeight: 15,
    clearance: 3,
  },
  operation: { id: "op1", type: "rockett.cam.facing", params: {} },
  tool: {
    id: "t1",
    name: "6 mm flat",
    kind: "flat",
    diameter: 6,
    fluteLength: 20,
    overallLength: 50,
    shankDiameter: 6,
    flutes: 2,
    centreCutting: true,
    number: 1,
  },
  preset: {
    id: "p1",
    name: "Aluminium face",
    rpm: 18000,
    cutFeed: 1000,
    plungeFeed: 300,
    rampFeed: 500,
    stepdown: 1,
    stepoverFraction: 0.5,
    coolant: "mist",
  },
};

const bbox = { min: [0, 0, 0], max: [100, 50, 17.5] } as ServerBody["bbox"];
let body: ServerBody;
let kernel: {
  moduleJob(
    entry: string,
    id: string,
    input: unknown,
    hooks: { onProgress?: KernelJobRun["onProgress"]; shouldStop(): boolean },
  ): Promise<unknown>;
};
let storage: (dir: string) => ModuleFiles;
const dirs: string[] = [];

beforeAll(async () => {
  await startKernel();
  const [{ InProcessKernel }, { moduleFiles }, { LocalStorage }] =
    await Promise.all([
      core("kernel/client.ts"),
      core("modules/files.ts"),
      core("store/storage.ts"),
    ]);
  kernel = new InProcessKernel({ sources: async () => new Map() });
  storage = (dir) => moduleFiles(new LocalStorage(dir, fs), "rockett.cam");
  body = {
    id: "b1",
    name: "Body 1",
    bbox,
    brep: brep((own) => box(own, [0, 0, 0], [100, 50, 17.5])),
    faceNames: [],
    fingerprint: "f".repeat(64),
  };
}, 120_000);

afterAll(() =>
  Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true }))),
);

async function rig(limit?: number, during = () => {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-generate-"));
  dirs.push(dir);
  const files = storage(dir);
  const jobs: string[] = [];
  const context = {
    bodies: async (projectId: string, user: User) => {
      expect([projectId, user.id]).toEqual(["p1", "u1"]);
      return [body];
    },
    startKernelJob: async (
      id: string,
      input: unknown,
      run: KernelJobRun = {},
    ) => {
      jobs.push(id);
      during();
      return kernel.moduleJob(ENTRY, id, input, {
        onProgress: (...args) => run.onProgress?.(...args),
        shouldStop: () => run.signal?.aborted === true,
      });
    },
  };
  const cached = programCache(files, limit);
  return {
    files,
    jobs,
    context,
    generate: generator(context, cached),
    entries: async () =>
      (await files.list()).filter((n) => n.startsWith("cache/")),
  };
}

const withOperation = (id: string): GenerateRequest => ({
  ...request,
  operation: { ...request.operation, id },
});

describe("rockett.cam.generate", () => {
  it("runs the kernel once for the same inputs twice", async () => {
    const { jobs, generate, entries, files, context } = await rig();
    const progress: unknown[] = [];
    const first = await generate(request, {
      onProgress: (...args) => progress.push(args),
    });
    const second = await generate(request);
    expect(jobs).toEqual(["rockett.cam.generate"]);
    expect(second).toEqual(first);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await entries()).toEqual([`cache/${first.fingerprint}.json`]);
    expect(progress).toEqual([
      [0, 1, "rockett.cam.facing"],
      [1, 1, "rockett.cam.facing"],
    ]);
    const stock = stockBox(request.setup, { b1: bbox });
    expect(first.program).toEqual({
      irVersion: 1,
      units: "mm",
      setupId: "s1",
      offsetIndex: 1,
      tools: [request.tool],
      sections: [
        facing({
          operationId: "op1",
          setup: request.setup,
          stock,
          modelTop: -2.5,
          tool: request.tool,
          preset: request.preset,
        }),
      ],
    });
    const reopened = generator(context, programCache(files));
    expect(await reopened(request)).toEqual(first);
    expect(jobs).toHaveLength(1);
  });

  it("runs the kernel again when an input changes", async () => {
    const { jobs, generate } = await rig();
    const first = await generate(request);
    const deeper = await generate({
      ...request,
      setup: {
        ...request.setup,
        stock: {
          kind: "boxAround",
          margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 3 },
        },
      },
    });
    const other = await generate({
      ...request,
      preset: { ...request.preset, stepdown: 2 },
    });
    expect(jobs).toHaveLength(3);
    expect(new Set([first, deeper, other].map((r) => r.fingerprint)).size).toBe(
      3,
    );
  });

  it("runs the kernel once for two generates at the same time", async () => {
    const { jobs, generate } = await rig();
    const [a, b] = await Promise.all([generate(request), generate(request)]);
    expect(jobs).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it("writes no cache entry for a cancelled job, and a waiter runs its own", async () => {
    const { jobs, generate, entries } = await rig();
    const stop = new AbortController();
    const cancelled = generate(request, {
      signal: stop.signal,
      onProgress: () => stop.abort(),
    });
    const waiter = generate(request);
    await expect(cancelled).rejects.toThrow(/cancelled/);
    const { fingerprint } = await waiter;
    expect(jobs).toHaveLength(2);
    expect(await entries()).toEqual([`cache/${fingerprint}.json`]);
    const alone = await rig();
    await expect(
      alone.generate(request, { signal: AbortSignal.abort() }),
    ).rejects.toThrow(/cancelled/);
    expect(await alone.entries()).toEqual([]);
  });

  it("evicts the least recently used program past its cap", async () => {
    const sizing = await rig();
    const { fingerprint } = await sizing.generate(request);
    const bytes = (await sizing.files.read(`cache/${fingerprint}.json`))!;
    const { jobs, generate, entries } = await rig(
      Math.floor(bytes.byteLength * 2.5),
    );
    const one = await generate(withOperation("op1"));
    await generate(withOperation("op2"));
    await generate(withOperation("op1"));
    const three = await generate(withOperation("op3"));
    expect(jobs).toHaveLength(3);
    expect(new Set(await entries())).toEqual(
      new Set([one, three].map((r) => `cache/${r.fingerprint}.json`)),
    );
    await generate(withOperation("op2"));
    expect(jobs).toHaveLength(4);
    expect(await entries()).not.toContain(`cache/${one.fingerprint}.json`);
  });

  it("deletes an unreadable entry and generates again", async () => {
    const { jobs, generate, files } = await rig();
    const first = await generate(request);
    await files.write(`cache/${first.fingerprint}.json`, "{");
    const again = await generate(request);
    expect(jobs).toHaveLength(2);
    expect(again).toEqual(first);
  });

  it("refuses a cap above 384 MiB", async () => {
    const { files } = await rig();
    expect(CACHE_BYTES).toBe(256 * 2 ** 20);
    expect(MAX_CACHE_BYTES).toBe(384 * 2 ** 20);
    expect(() => programCache(files, MAX_CACHE_BYTES + 1)).toThrow(/384 MiB/);
    expect(() => programCache(files, 0)).toThrow(/384 MiB/);
    expect(() => programCache(files, MAX_CACHE_BYTES)).not.toThrow();
  });

  it("refuses an unknown operation or a missing body before the kernel", async () => {
    const { jobs, generate } = await rig();
    await expect(
      generate({
        ...request,
        operation: { ...request.operation, type: "rockett.cam.nothing" },
      }),
    ).rejects.toThrow("operation rockett.cam.nothing is unknown");
    await expect(
      generate({ ...request, setup: { ...request.setup, bodies: ["b2"] } }),
    ).rejects.toThrow("setup body b2 is not in the model");
    expect(jobs).toEqual([]);
  });
});

type Edit = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

async function mounted(r: Awaited<ReturnType<typeof rig>>) {
  const edits = new Map<string, Edit>();
  await cam.activate({
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount({
        projectRoute: (route, read) => edits.set(route.path, read as Edit),
        userRoute: () => {},
        projectMutation: (route, edit) => edits.set(route.path, edit as Edit),
      });
      return () => {};
    }),
    startKernelJob: r.context.startKernelJob,
    userData: () => ({ read: async () => null, write: async () => null! }),
    files: r.files,
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: r.context.bodies,
  });
  const run = (at: string, doc: CadDocument, sent: unknown) =>
    edits.get(at)!(doc, { params: { id: "p1" }, body: sent }, { user: mark });
  return {
    program: (doc: CadDocument) =>
      edits.get(programRoute.path)!(
        doc,
        { params: { id: "p1", setupId: "s1", operationId: "op1" } },
        { user: mark },
      ),
    generate: (doc: CadDocument) =>
      run(generateRoute.path, doc, { setupId: "s1", operationId: "op1" }),
    save: (doc: CadDocument, data: CamData) => run(saveCam.path, doc, data),
  };
}

const project = (data: CamData, version = 1) =>
  ({
    extensions: {
      [CAM_EXTENSION]: { version, data: structuredClone(data) },
    },
  }) as unknown as CadDocument;

const saved: CamData = {
  setups: [
    {
      ...request.setup,
      name: "Setup 1",
      operations: [
        {
          id: "op1",
          type: "rockett.cam.facing",
          name: "Face top",
          toolId: "t1",
          presetId: "p1",
          params: {},
        },
      ],
    },
  ],
  tools: [{ ...request.tool, presets: [request.preset] }],
};

const data = (doc: CadDocument) => {
  const read = migrateCam(doc.extensions[CAM_EXTENSION]);
  if (read.status === "kept") throw new Error(read.reason);
  return read.data;
};

const generated = (doc: CadDocument) =>
  data(doc).setups[0]!.operations![0]!.lastGenerated!;

describe("POST /projects/:id/m/rockett/cam/generate", () => {
  it("writes lastGenerated from the stored inputs as one history entry", async () => {
    const r = await rig();
    const doc = project(saved);
    const result = await (await mounted(r)).generate(doc);
    const direct = await r.generate(request);
    expect(r.jobs).toHaveLength(1);
    expect(result.label).toBe("Generate Face top");
    expect(result.program).toEqual(direct.program);
    expect(generated(doc)).toMatchObject({
      fingerprint: direct.fingerprint,
      programSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(migrateCam(doc.extensions[CAM_EXTENSION]).status).toBe("ready");
  });

  it("leaves the result stale when an input changes during generation", async () => {
    const doc = project(saved);
    const r = await rig(undefined, () => {
      const setup = data(doc).setups[0]!;
      if (setup.stock?.kind === "boxAround") setup.stock.margins.zMax = 3;
    });
    const route = await mounted(r);
    await route.generate(doc);
    const first = generated(doc).fingerprint;
    expect(first).toBe((await r.generate(request)).fingerprint);
    await route.generate(doc);
    expect(r.jobs).toHaveLength(2);
    expect(generated(doc).fingerprint).not.toBe(first);
  });

  it("regenerates an evicted program to the sha lastGenerated holds", async () => {
    const r = await rig();
    const route = await mounted(r);
    const doc = project(saved);
    await route.generate(doc);
    const proof = generated(doc);
    for (const name of await r.entries()) await r.files.remove(name);
    await route.generate(doc);
    expect(r.jobs).toHaveLength(2);
    expect(generated(doc).fingerprint).toBe(proof.fingerprint);
    expect(generated(doc).programSha256).toBe(proof.programSha256);
  });

  it("reads a v1 project from before operations and saves it as v4", async () => {
    const r = await rig();
    const route = await mounted(r);
    const { safeHeight: _s, clearance: _c, ...setup } = request.setup;
    const { number: _n, ...tool } = request.tool;
    const before: CamData = {
      setups: [{ ...setup, name: "Setup 1" }],
      tools: [tool],
    };
    const doc = project(before);
    expect(data(doc)).toEqual(before);
    await expect(route.generate(doc)).rejects.toThrow(
      "operation op1 is not in s1",
    );
    expect(data(doc)).toEqual(before);
    await route.save(doc, data(doc));
    expect(doc.extensions).toEqual(project(before, 4).extensions);
    expect(r.jobs).toEqual([]);
  });
});

const stored = async (r: Awaited<ReturnType<typeof rig>>) =>
  Promise.all(
    (await r.files.list()).map(async (name) => [
      name,
      await r.files.read(name),
    ]),
  );

describe("GET /projects/:id/m/rockett/cam/setups/:setupId/operations/:operationId/program", () => {
  it("is a read, never a document edit", () => {
    expect(programRoute.method).toBe("GET");
    expect(programRoute.effect).toBeUndefined();
  });

  it("returns the cached program and changes nothing", async () => {
    const r = await rig();
    const route = await mounted(r);
    const doc = project(saved);
    const { program } = await route.generate(doc);
    const [before, cache] = [structuredClone(doc), await stored(r)];
    expect(await route.program(doc)).toEqual({ program });
    expect(r.jobs).toHaveLength(1);
    expect(doc).toEqual(before);
    expect(await stored(r)).toEqual(cache);
  });

  it("returns a reason for an operation never generated", async () => {
    const r = await rig();
    const route = await mounted(r);
    const doc = project(saved);
    const [before, cache] = [structuredClone(doc), await stored(r)];
    expect(await route.program(doc)).toEqual({
      reason: "Face top has not been generated",
    });
    expect(r.jobs).toEqual([]);
    expect(doc).toEqual(before);
    expect(await stored(r)).toEqual(cache);
  });

  it("returns a reason when the program left the cache, and generates nothing", async () => {
    const r = await rig();
    const route = await mounted(r);
    const doc = project(saved);
    await route.generate(doc);
    for (const name of await r.entries()) await r.files.remove(name);
    const before = structuredClone(doc);
    expect(await route.program(doc)).toEqual({
      reason: "Face top is not cached; generate it again",
    });
    expect(r.jobs).toHaveLength(1);
    expect(doc).toEqual(before);
    expect(await r.entries()).toEqual([]);
  });

  it("leaves a corrupt cache entry in place and returns a reason", async () => {
    const r = await rig();
    const route = await mounted(r);
    const doc = project(saved);
    await route.generate(doc);
    await r.files.write(
      `cache/${generated(doc).fingerprint}.json`,
      "{ not json",
    );
    const cache = await stored(r);
    expect(await route.program(doc)).toEqual({
      reason: "Face top is not cached; generate it again",
    });
    expect(await stored(r)).toEqual(cache);
  });

  it("removes nothing when it reads a cache over its limit", async () => {
    const r = await rig();
    const made = [];
    for (const id of ["op1", "op2", "op3"])
      made.push(await r.generate(withOperation(id)));
    const cache = await stored(r);
    const { byteLength } = (await r.files.read(
      `cache/${made[0]!.fingerprint}.json`,
    ))!;
    const reader = programCache(r.files, Math.floor(byteLength * 1.5));
    expect(await reader.cached(made[0]!.fingerprint)).toEqual(made[0]!.program);
    expect(await reader.cached(made[2]!.fingerprint)).toEqual(made[2]!.program);
    expect(await stored(r)).toEqual(cache);
  });
});
