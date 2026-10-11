import { serverRegister } from "./helpers/serverRegister.js";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  CadDocument,
  Feature,
  KernelJobRun,
  RouteModuleApi,
  User,
} from "@rockett/plugin-api";
import cam from "../server.js";
import {
  CAM_EXTENSION,
  generateRoute,
  statusRoute,
  type CamData,
} from "../src/shared/document.js";
import { OPERATION_VERSIONS } from "../src/shared/operations.js";
import { startKernel } from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;

const core = (file: string) =>
  import(new URL(`../../../server/${file}`, import.meta.url).href);

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

const camData: CamData = {
  setups: [
    {
      id: "s1",
      name: "Setup 1",
      bodies: ["b:cube"],
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
  tools: [
    {
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
      presets: [
        {
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
      ],
    },
  ],
};

type Handler = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

let store: {
  create(name: string, actor: string): Promise<CadDocument>;
  load(id: string): Promise<CadDocument>;
  save(doc: CadDocument, actor: string): Promise<void>;
};
let box: (
  id: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
  d: number,
) => Feature[];
const routes = new Map<string, Handler>();
const jobs: string[] = [];

beforeAll(async () => {
  await startKernel();
  const [
    { InProcessKernel },
    { moduleBodies },
    { moduleFiles },
    { ProjectStore },
    { FolderStore },
    { validateDocument },
    { MemoryStorage },
    names,
  ] = await Promise.all([
    core("src/kernel/client.ts"),
    core("src/modules/bodies.ts"),
    core("src/modules/files.ts"),
    core("src/store/projectStore.ts"),
    core("src/store/folderStore.ts"),
    core("src/api/validate.ts"),
    core("test/helpers/memoryStorage.ts"),
    core("test/helpers/dumpNames.ts"),
  ]);
  box = names.box;
  const storage = new MemoryStorage();
  store = new ProjectStore(storage, validateDocument);
  const kernel = new InProcessKernel(store);
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
    startKernelJob: (id: string, input: unknown, run: KernelJobRun = {}) => {
      jobs.push(id);
      return kernel.moduleJob(ENTRY, id, input, {
        onProgress: (...args: [number, number, string]) =>
          run.onProgress?.(...args),
        shouldStop: () => run.signal?.aborted === true,
      });
    },
    userData: () => ({ read: async () => null, write: async () => null! }),
    files: moduleFiles(storage, "rockett.cam"),
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: moduleBodies(kernel, store, new FolderStore(storage)),
  });
}, 120_000);

const at = { setupId: "s1", operationId: "op1" };

async function project(features: Feature[], data = camData) {
  const doc = await store.create("Part", mark.id);
  doc.features = features;
  doc.timelinePosition = features.length;
  doc.extensions = {
    [CAM_EXTENSION]: { version: 1, data: structuredClone(data) },
  };
  await store.save(doc, mark.id);
  return doc.id;
}

async function edit(id: string, change: (doc: CadDocument) => void) {
  const doc = await store.load(id);
  change(doc);
  await store.save(doc, mark.id);
}

const status = async (id: string) =>
  (
    await routes.get(statusRoute.path)!(
      await store.load(id),
      { params: { id, setupId: at.setupId }, body: undefined },
      { user: mark },
    )
  )[at.operationId];

async function generate(id: string) {
  const doc = await store.load(id);
  const made = await routes.get(generateRoute.path)!(
    doc,
    { params: { id }, body: at },
    { user: mark },
  );
  await store.save(doc, mark.id);
  return made;
}

const parts = () => [
  ...box("cube", 0, 0, 100, 50, 17.5),
  ...box("other", 50, 0, 100, 50, 10),
];

const distance = (id: string, value: number) => (doc: CadDocument) => {
  const feature = doc.features.find((f) => f.id === id);
  Object.assign(feature!, { distance: value });
};

const stepover = (value: number) => (doc: CadDocument) => {
  const { tools } = doc.extensions[CAM_EXTENSION]!.data as CamData;
  tools[0]!.presets![0]!.stepoverFraction = value;
};

const data = (doc: CadDocument) =>
  (doc.extensions[CAM_EXTENSION]!.data as CamData).setups[0]!;

describe("GET .../setups/:setupId/status", () => {
  it("leaves the operation fresh after an edit to another body", async () => {
    const id = await project(parts());
    await generate(id);
    expect(await status(id)).toEqual({ status: "fresh" });
    await edit(id, distance("other", 12));
    expect(await status(id)).toEqual({ status: "fresh" });
  });

  it("reads missingReference once the setup body is consumed", async () => {
    const id = await project(parts());
    await generate(id);
    await edit(id, (doc) => {
      doc.features.push({
        id: "merge",
        name: "merge",
        suppressed: false,
        type: "combine",
        operation: "join",
        targetBody: "b:other",
        toolBodies: ["b:cube"],
        keepTools: false,
      } as Feature);
      doc.timelinePosition = doc.features.length;
    });
    expect(await status(id)).toEqual({
      status: "missingReference",
      reason: "setup body b:cube is not in the model",
    });
    await expect(generate(id)).rejects.toThrow(
      "setup body b:cube is not in the model",
    );
  });

  it("reads never before the first generate and stale after a setup body edit", async () => {
    const id = await project(parts());
    expect(await status(id)).toEqual({ status: "never" });
    await generate(id);
    await edit(id, distance("cube", 20));
    expect(await status(id)).toEqual({ status: "stale" });
    await generate(id);
    expect(await status(id)).toEqual({ status: "fresh" });
  });

  it("reads error with the reason when the last generate failed", async () => {
    const id = await project(parts());
    await generate(id);
    await edit(id, stepover(2));
    expect(await status(id)).toEqual({ status: "stale" });
    const before = jobs.length;
    await expect(generate(id)).rejects.toThrow(/stepover fraction/);
    expect(jobs.length).toBe(before + 1);
    expect(await status(id)).toEqual({
      status: "error",
      reason: expect.stringMatching(/stepover fraction/),
    });
    await edit(id, stepover(0.5));
    expect(await status(id)).toEqual({ status: "fresh" });
  });

  it("refuses generate while a feature the setup body depends on has problems", async () => {
    const id = await project([
      ...parts(),
      {
        id: "gear",
        name: "gear",
        suppressed: false,
        type: "acme.gear",
        version: 1,
        params: { teeth: 12 },
      } as Feature,
    ]);
    const blocked = {
      status: "error",
      reason:
        "setup body b:cube depends on gear, which failed: Requires module acme",
    };
    expect(await status(id)).toEqual(blocked);
    const before = jobs.length;
    await expect(generate(id)).rejects.toThrow(blocked.reason);
    expect(jobs.length).toBe(before);
    const doc = await store.load(id);
    expect(data(doc).operations![0]!.lastGenerated).toBeUndefined();
  });

  it("reads the end of the timeline while Design is rolled back", async () => {
    const id = await project(parts());
    await generate(id);
    await edit(id, (doc) => {
      doc.timelinePosition = 0;
    });
    expect(await status(id)).toEqual({ status: "fresh" });
    await edit(id, (doc) => {
      doc.features.push({
        id: "round",
        name: "round",
        suppressed: false,
        type: "fillet",
        filletType: "equalDistance",
        edges: [{ kind: "edge", bodyId: "b:cube", edgeName: "missing" }],
        radius: 1,
      } as Feature);
    });
    const read = await status(id);
    expect(read).toMatchObject({
      status: "error",
      reason: expect.stringMatching(
        /^setup body b:cube depends on round, which failed/,
      ),
    });
    await expect(generate(id)).rejects.toThrow(read.reason);
  });

  it("reads stale after a CAM operation version bump", async () => {
    const id = await project(parts());
    await generate(id);
    const versions: Record<string, number> = OPERATION_VERSIONS;
    const was = versions["rockett.cam.facing"]!;
    versions["rockett.cam.facing"] = was + 1;
    try {
      expect(await status(id)).toEqual({ status: "stale" });
    } finally {
      versions["rockett.cam.facing"] = was;
    }
    expect(await status(id)).toEqual({ status: "fresh" });
  });
});
