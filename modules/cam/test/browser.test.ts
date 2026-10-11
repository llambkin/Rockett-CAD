import { serverRegister } from "./helpers/serverRegister.js";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  CadDocument,
  ModuleFiles,
  OpenProject,
  ProjectView,
  RouteModuleApi,
  ServerBody,
  User,
} from "@rockett/plugin-api";
import cam from "../server.js";
import {
  clock,
  generateOperation,
  generateStale,
  moveOperation,
  moveSetup,
  setupTimes,
  toggleSuppressed,
} from "../src/client/browser.js";
import {
  CAM_EXTENSION,
  isCamData,
  migrateCam,
  programRoute,
  statusRoute,
  type CamData,
} from "../src/shared/document.js";
import type { Program } from "../src/shared/ir.js";
import { newMachine } from "../src/shared/machine.js";
import { estimateTime } from "../src/shared/time.js";

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

const program: Program = JSON.parse(
  readFileSync(new URL("./fixtures/ir/facing.json", import.meta.url), "utf8"),
);

const limits = {
  ...newMachine(0),
  accelX: 500,
  accelY: 500,
  accelZ: 200,
  junctionDeviation: 0.01,
  spinUpSeconds: 3,
};

const operation = (id: string, name: string) => ({
  id,
  type: "rockett.cam.facing",
  name,
  toolId: "t1",
  presetId: "p1",
  params: {},
});

type Operations = NonNullable<CamData["setups"][number]["operations"]>;

const setup = (id: string, body: string, operations: Operations) => ({
  id,
  name: id,
  bodies: [body],
  stock: {
    kind: "boxAround" as const,
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 2.5 },
  },
  wcs: {
    origin: {
      kind: "stockCorner" as const,
      x: "min" as const,
      y: "min" as const,
      z: "max" as const,
    },
    axes: { x: "+x" as const, z: "+z" as const },
    offsetIndex: 1,
    machine: { kind: "unknown" as const },
  },
  safeHeight: 15,
  clearance: 3,
  operations,
});

const camData = {
  setups: [
    setup("s1", "b1", [
      operation("a", "Face A"),
      operation("b", "Face B"),
      operation("n", "Face N"),
    ]),
    setup("s2", "b2", [
      operation("c", "Face C"),
      { ...operation("x", "Face X"), suppressed: true },
    ]),
  ],
  tools: [
    {
      id: "t1",
      name: "6 mm flat",
      kind: "flat" as const,
      diameter: 6,
      fluteLength: 20,
      overallLength: 50,
      shankDiameter: 6,
      flutes: 2,
      centreCutting: true,
      number: 1,
      presets: [
        {
          id: "p1",
          name: "Face",
          rpm: 18000,
          cutFeed: 1000,
          plungeFeed: 300,
          rampFeed: 500,
          stepdown: 1,
          stepoverFraction: 0.5,
          coolant: "mist" as const,
        },
      ],
    },
  ],
} satisfies CamData;

type Handler = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

const routes = new Map<string, Handler>();
const fingerprints: Record<string, string> = {};
let jobs: string[] = [];
let failing = new Set<string>();
let modelReads = 0;

const body = (id: string): ServerBody => ({
  id,
  name: id,
  bbox: { min: [0, 0, 0], max: [100, 50, 17.5] },
  brep: "",
  faceNames: [],
  fingerprint: fingerprints[id]!,
});

function memoryFiles(): ModuleFiles {
  const files = new Map<string, Uint8Array>();
  return {
    read: async (name) => files.get(name) ?? null,
    write: async (name, data) => {
      files.set(
        name,
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    },
    remove: async (name) => {
      files.delete(name);
    },
    list: async () => [...files.keys()],
  };
}

const files = memoryFiles();

const cached = async () =>
  Object.fromEntries(
    await Promise.all(
      (await files.list()).map(async (name) => [name, await files.read(name)]),
    ),
  );

beforeAll(async () => {
  const keep = (route: { path: string }, handler: unknown) =>
    routes.set(route.path, handler as Handler);
  const api: RouteModuleApi = {
    projectRoute: keep,
    projectMutation: keep,
    userRoute: () => {},
  };
  await cam.activate({
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount(api);
      return () => {};
    }),
    startKernelJob: async (_id: string, input: unknown) => {
      const { id } = (input as { operation: { id: string } }).operation;
      jobs.push(id);
      if (failing.has(id)) throw new Error(`job ${id} failed`);
      return program;
    },
    userData: () => ({ read: async () => null, write: async () => null! }),
    files,
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => {
      modelReads++;
      return [body("b1"), body("b2")];
    },
  });
});

beforeEach(() => {
  fingerprints.b1 = "1".repeat(64);
  fingerprints.b2 = "2".repeat(64);
  jobs = [];
  failing = new Set();
  modelReads = 0;
});

function projectView(data: unknown = camData) {
  const id = crypto.randomUUID();
  const edits: string[] = [];
  let open: OpenProject = {
    projectId: id,
    document: {
      id,
      extensions: {
        [CAM_EXTENSION]: { version: 1, data: structuredClone(data) },
      },
    } as unknown as CadDocument,
    bodies: [],
  };
  const run = (path: string, doc: CadDocument, req: object) =>
    routes.get(path)!(doc, { params: { id }, ...req }, { user: mark });
  const view: ProjectView = {
    get: () => open,
    selection: () => [],
    picks: () => [],
    select() {},
    pick: () => () => {},
    measure: () => Promise.reject(new Error("measure is not used here")),
    subscribe: () => () => {},
    read: (route, params) =>
      routes.get(route.path)!(
        structuredClone(open.document!),
        { params: { id, ...params }, body: undefined },
        { user: mark },
      ),
    async mutate(route, sent) {
      const doc = structuredClone(open.document!);
      edits.push((await run(route.path, doc, { body: sent })).label);
      open = { ...open, document: doc };
    },
  };
  const stored = () =>
    open.document!.extensions[CAM_EXTENSION]!.data as typeof camData;
  const ops = () =>
    Object.fromEntries(
      stored().setups.flatMap((s) =>
        s.operations.map((op) => [op.id, op] as const),
      ),
    );
  const status = (setupId: string) => view.read(statusRoute, { setupId });
  return { view, edits, stored, ops, status };
}

describe("Manufacture browser", () => {
  it("generate all stale regenerates only the stale operations", async () => {
    const { view, edits, ops, status } = projectView();
    for (const [setupId, operationId] of [
      ["s1", "a"],
      ["s1", "b"],
      ["s2", "c"],
    ] as const)
      await generateOperation(view, setupId, operationId);
    await toggleSuppressed(view, "s2", "x");
    await generateOperation(view, "s2", "x");
    await toggleSuppressed(view, "s2", "x");
    const before = structuredClone(ops());
    fingerprints.b2 = "3".repeat(64);
    expect(await status("s1")).toEqual({
      a: { status: "fresh" },
      b: { status: "fresh" },
      n: { status: "never" },
    });
    expect(await status("s2")).toEqual({
      c: { status: "stale" },
      x: { status: "suppressed" },
    });
    jobs = [];
    edits.length = 0;

    await generateStale(view);

    expect(jobs).toEqual(["c"]);
    expect(edits).toEqual(["Generate all stale"]);
    const after = ops();
    expect(after.c!.lastGenerated).not.toEqual(before.c!.lastGenerated);
    expect(after.c!.lastGenerated!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    for (const id of ["a", "b", "n", "x"])
      expect(after[id]).toEqual(before[id]);
    expect(await status("s2")).toEqual({
      c: { status: "fresh" },
      x: { status: "suppressed" },
    });
  });

  it("refuses generate all stale with nothing stale and writes nothing", async () => {
    const { view, edits, stored } = projectView();
    const before = structuredClone(stored());
    await expect(generateStale(view)).rejects.toThrow("No operation is stale");
    expect(edits).toEqual([]);
    expect(stored()).toEqual(before);
  });

  it("writes nothing when one stale operation fails to generate", async () => {
    const { view, edits, stored, status } = projectView();
    for (const [setupId, operationId] of [
      ["s1", "a"],
      ["s1", "b"],
      ["s2", "c"],
    ] as const)
      await generateOperation(view, setupId, operationId);
    fingerprints.b1 = "4".repeat(64);
    fingerprints.b2 = "5".repeat(64);
    failing = new Set(["c"]);
    const before = structuredClone(stored());
    const toolpaths = await cached();
    jobs = [];
    edits.length = 0;

    await expect(generateStale(view)).rejects.toThrow("job c failed");

    expect(jobs).toEqual(["a", "b", "c"]);
    expect(edits).toEqual([]);
    expect(stored()).toEqual(before);
    expect(await cached()).toMatchObject(toolpaths);
    expect(await status("s2")).toMatchObject({
      c: { status: "error", reason: "job c failed" },
    });
  });

  it("refuses to generate a suppressed operation", async () => {
    const { view, edits, stored } = projectView();
    const before = structuredClone(stored());
    await expect(generateOperation(view, "s2", "x")).rejects.toThrow(
      "operation x is suppressed; unsuppress it first",
    );
    expect(jobs).toEqual([]);
    expect(edits).toEqual([]);
    expect(stored()).toEqual(before);
  });

  it("reads every operation status of a setup from one model read", async () => {
    const { status } = projectView();
    expect(await status("s1")).toEqual({
      a: { status: "never" },
      b: { status: "never" },
      n: { status: "never" },
    });
    expect(modelReads).toBe(1);
  });

  it("times fresh operations, and the setup once every one is fresh", async () => {
    const { view, status } = projectView();
    await generateOperation(view, "s1", "a");
    await generateOperation(view, "s1", "b");
    let reads = 0;
    const counted: ProjectView = {
      ...view,
      read: (route, params) => {
        if (route.path === programRoute.path) reads++;
        return view.read(route, params);
      },
    };
    const request = async <T>() =>
      ({ version: 1, data: [limits], etag: "e", readOnly: false }) as T;
    const settings = {
      get: () => null as never,
      set: async () => {},
      subscribe: () => () => {},
    };
    const readTimes = setupTimes(counted, { request, settings });
    const s1 = () =>
      (view.get().document!.extensions[CAM_EXTENSION]!.data as CamData)
        .setups[0]!;
    const times = async () => readTimes([s1()], { s1: await status("s1") });
    const run = (n: number) =>
      estimateTime(
        { sections: Array.from({ length: n }, () => program.sections).flat() },
        limits,
      );

    const two = (await times()).s1!;
    expect(two.seconds).toBeUndefined();
    const { a, b } = two.operations;
    expect(a!.seconds + b!.seconds).toBeCloseTo(run(2).seconds, 9);
    expect(reads).toBe(2);
    await times();
    expect(reads).toBe(2);

    await generateOperation(view, "s1", "n");
    const all = (await times()).s1!;
    expect(all.seconds).toBeCloseTo(run(3).seconds, 9);
    expect(reads).toBe(5);
  });

  it("formats a time as m:ss", () => {
    expect([42, 365, 59.6, 3725].map(clock)).toEqual([
      "0:42",
      "6:05",
      "1:00",
      "62:05",
    ]);
  });

  it("moves setups and operations up and down, one edit each", async () => {
    const { view, edits, stored } = projectView();
    await moveOperation(view, "s1", "n", -1);
    expect(stored().setups[0]!.operations.map((op) => op.id)).toEqual([
      "a",
      "n",
      "b",
    ]);
    await moveOperation(view, "s1", "a", 1);
    expect(stored().setups[0]!.operations.map((op) => op.id)).toEqual([
      "n",
      "a",
      "b",
    ]);
    await moveSetup(view, "s2", -1);
    expect(stored().setups.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(edits).toEqual(["Edit CAM data", "Edit CAM data", "Edit CAM data"]);
    await expect(moveSetup(view, "s2", -1)).rejects.toThrow(
      "setup s2 cannot move up",
    );
    expect(edits).toHaveLength(3);
  });

  it("suppresses and unsuppresses an operation as one edit each", async () => {
    const { view, edits, ops, status } = projectView();
    await toggleSuppressed(view, "s1", "a");
    expect(ops().a).toMatchObject({ suppressed: true });
    expect(await status("s1")).toMatchObject({ a: { status: "suppressed" } });
    await toggleSuppressed(view, "s1", "a");
    expect(ops().a).toEqual(camData.setups[0]!.operations[0]);
    expect(edits).toEqual(["Edit CAM data", "Edit CAM data"]);
  });

  it("loads a v1 document saved before suppressed unchanged", () => {
    const old = structuredClone(camData);
    old.setups[1]!.operations.pop();
    expect(migrateCam({ version: 1, data: old })).toEqual({
      status: "ready",
      data: old,
    });
    const flagged = structuredClone(camData);
    Object.assign(flagged.setups[1]!.operations[1]!, { suppressed: "yes" });
    expect(isCamData(flagged)).toBe(false);
  });
});
