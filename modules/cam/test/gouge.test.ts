import { serverRegister } from "./helpers/serverRegister.js";
import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  CadDocument,
  ProjectView,
  ServerBody,
  User,
  ViewportLayer,
} from "@rockett/plugin-api";
import cam from "../server.js";
import {
  MAX_CELLS,
  cellSize,
  gridOf,
  simulateJob,
  type SimulationJob,
} from "../src/client/heightmap.js";
import { holdDownDraft } from "../src/client/holdDowns.js";
import { stockLayer } from "../src/client/stockLayer.js";
import { toolpathBarView, toolpathPreview } from "../src/client/toolpaths.js";
import {
  CAM_EXTENSION,
  programRoute,
  surfaceRoute,
  type CamData,
} from "../src/shared/document.js";
import type { Move, Program, Xyz } from "../src/shared/ir.js";
import { GOUGE_TOLERANCE } from "../src/shared/params.js";
import { stockBox, type Box } from "../src/shared/setup.js";
import { box, brep, cut, startKernel } from "./helpers/kernel.js";

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

const BBOX = { min: [0, 0, 0], max: [40, 30, 10] } as ServerBody["bbox"];

const setup: CamData["setups"][number] = {
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  stock: {
    kind: "boxAround",
    margins: { xMin: 5, xMax: 5, yMin: 5, yMax: 5, zMin: 0, zMax: 0 },
  },
  wcs: {
    origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
    axes: { x: "+x", z: "+z" },
    offsetIndex: 1,
    machine: { kind: "unknown" },
  },
};

const STOCK = stockBox(
  { bodies: ["b1"], stock: setup.stock!, wcs: setup.wcs! },
  { b1: BBOX as Box },
);

const tool = {
  id: "t1",
  name: "4 mm flat",
  kind: "flat" as const,
  diameter: 4,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 4,
  flutes: 2,
  centreCutting: true,
  number: 1,
};

let body: ServerBody;
let jobs: string[] = [];
let kernel: {
  moduleJob(
    entry: string,
    id: string,
    input: unknown,
    hooks: object,
  ): Promise<unknown>;
};

beforeAll(async () => {
  await startKernel();
  const { InProcessKernel } = await core("kernel/client.ts");
  kernel = new InProcessKernel({ sources: async () => new Map() });
  body = {
    id: "b1",
    name: "Plate",
    bbox: BBOX,
    brep: brep((own) =>
      cut(
        own,
        box(own, [0, 0, 0], [40, 30, 10]),
        box(own, [10, 10, 6], [20, 10, 5]),
      ),
    ),
    faceNames: [],
    fingerprint: "e".repeat(64),
  };
}, 120_000);

type Read = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

async function surface(
  tolerance: string,
  bodies = () => [body],
  setupId = "s1",
) {
  const reads = new Map<string, Read>();
  jobs = [];
  await cam.activate({
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount({
        projectRoute: (r, read) => reads.set(r.path, read as Read),
        userRoute: () => {},
        projectMutation: () => {},
      });
      return () => {};
    }),
    startKernelJob: (id: string, input: unknown) => {
      jobs.push(id);
      return kernel.moduleJob(ENTRY, id, input, { shouldStop: () => false });
    },
    userData: () => ({ read: async () => null, write: async () => null! }),
    files: {} as never,
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => bodies(),
  });
  const data: CamData = { setups: [setup], tools: [] };
  return reads.get(surfaceRoute.path)!(
    {
      extensions: { [CAM_EXTENSION]: { version: 1, data } },
    } as unknown as CadDocument,
    { params: { id: "p1", setupId, tolerance } },
    { user: mark },
  );
}

const pocket = (floor: number): Move[] => {
  const rows = [17, 18.5, 20, 21.5, 23];
  const raster = rows.flatMap((y, i): Move[] => [
    { kind: "feed", to: [i % 2 ? 33 : 17, y, floor], feed: 800, role: "cut" },
    { kind: "feed", to: [i % 2 ? 17 : 33, y, floor], feed: 800, role: "cut" },
  ]);
  const ring: Xyz[] = [
    [33, 17, floor],
    [33, 23, floor],
    [17, 23, floor],
    [17, 17, floor],
  ];
  return [
    { kind: "rapid", to: [17, 17, 3] },
    { kind: "feed", to: [17, 17, floor], feed: 300, role: "plunge" },
    ...raster,
    ...ring.map((to): Move => ({ kind: "feed", to, feed: 800, role: "cut" })),
    { kind: "rapid", to: [17, 17, 3] },
  ];
};

const outline: Move[] = [
  { kind: "rapid", to: [3, 3, 3] },
  { kind: "feed", to: [3, 3, -10], feed: 300, role: "plunge" },
  { kind: "feed", to: [47, 3, -10], feed: 800, role: "cut" },
  { kind: "rapid", to: [47, 3, 3] },
];

const program = (floor: number): Program => ({
  irVersion: 1,
  units: "mm",
  setupId: "s1",
  offsetIndex: 1,
  tools: [tool],
  sections: [
    {
      operationId: "outline",
      toolId: "t1",
      pass: "rough",
      coolant: "off",
      moves: outline,
    },
    {
      operationId: "pocket",
      toolId: "t1",
      pass: "rough",
      coolant: "off",
      moves: pocket(floor),
    },
  ],
});

const tolerances = { outline: GOUGE_TOLERANCE, pocket: GOUGE_TOLERANCE };

describe("gouge check after the heightmap", () => {
  it("flags a pocket 1 mm too deep as a 1 mm gouge on that operation, and the correct one not at all", async () => {
    const top = await surface(String(GOUGE_TOLERANCE));
    expect(jobs).toEqual(["rockett.cam.surfaceMesh"]);
    expect(top.tops).toHaveLength(top.columns * top.rows);
    const run = (floor: number) =>
      simulateJob({
        program: program(floor),
        stock: STOCK,
        cellMm: cellSize(STOCK),
        top,
        tolerances,
      }).check;

    expect(run(-4)).toMatchObject({ gouges: [] });
    const deep = run(-5);
    if (!("gouges" in deep)) throw new Error(deep.reason);
    expect(deep.gouges.map(({ operationId }) => operationId)).toEqual([
      "pocket",
    ]);
    expect(deep.gouges[0]!.deepest).toBeCloseTo(1, 6);
    expect(deep.gouges[0]!.cells).toBeGreaterThan(0);
    expect(deep.gouged.reduce((n, cell) => n + cell, 0)).toBe(
      deep.gouges[0]!.cells,
    );
  }, 120_000);

  it("refuses before meshing below the minimum tolerance or without a setup body", async () => {
    expect(await surface("0.0005")).toEqual({
      reason: "gouge tolerance must be at least 0.001 mm",
    });
    expect(await surface("x")).toEqual({
      reason: "gouge tolerance must be at least 0.001 mm",
    });
    expect(await surface("Infinity")).toEqual({
      reason: "gouge tolerance must be at least 0.001 mm",
    });
    expect(await surface("0.01", () => [])).toEqual({
      reason: "setup body b1 is not in the model",
    });
    expect(jobs).toEqual([]);
  });

  it("answers a reason for an unknown setup or a setup body with problems", async () => {
    expect(await surface("0.01", undefined, "s9")).toEqual({
      reason: "setup s9 is not in this project",
    });
    const broken = {
      ...body,
      problems: [{ featureId: "Sketch1", status: "error" as const }],
    };
    expect(await surface("0.01", () => [broken])).toEqual({
      reason: "setup body b1 depends on Sketch1, which failed",
    });
    expect(jobs).toEqual([]);
  });

  it("names the later, deeper operation where two cut the same cells", async () => {
    const top = await surface(String(GOUGE_TOLERANCE));
    const [, pocketA] = program(-5).sections;
    const [, pocketB] = program(-6).sections;
    const { check } = simulateJob({
      program: {
        ...program(-4),
        sections: [
          { ...pocketA!, operationId: "rough" },
          { ...pocketB!, operationId: "finish" },
        ],
      },
      stock: STOCK,
      cellMm: cellSize(STOCK),
      top,
      tolerances: { rough: GOUGE_TOLERANCE, finish: GOUGE_TOLERANCE },
    });
    if ("reason" in check) throw new Error(check.reason);
    expect(check.gouges.map(({ operationId }) => operationId)).toEqual([
      "finish",
    ]);
    expect(check.gouges[0]!.deepest).toBeCloseTo(2, 6);
  }, 120_000);

  it("answers no part top where no body lies under a cell", async () => {
    const top = await surface("0.01");
    const at = (x: number, y: number) =>
      top.tops[
        Math.floor(y / top.cellMm) * top.columns + Math.floor(x / top.cellMm)
      ];
    expect(at(1, 1)).toBeNull();
    expect(at(10, 10)).toBeCloseTo(0, 9);
    expect(at(25, 20)).toBeCloseTo(-4, 9);
  }, 120_000);

  it("keeps any stock within the heightmap's cell bound", () => {
    for (const max of [
      [300, 300, 0],
      [3000, 2, 0],
      [10, 10, 0],
    ] as Xyz[]) {
      const { columns, rows } = gridOf(
        { min: [0, 0, -1], max },
        cellSize({ min: [0, 0, -1], max }),
      );
      expect(columns * rows).toBeLessThanOrEqual(MAX_CELLS);
    }
  });

  it("names a grid that does not match the simulated stock", async () => {
    const top = await surface("0.01");
    const { check } = simulateJob({
      program: program(-4),
      stock: STOCK,
      cellMm: 1,
      top,
      tolerances,
    });
    expect(check).toEqual({
      reason: "the part top grid does not match the simulated stock",
    });
  }, 120_000);
});

class JobWorker {
  listeners = new Set<(event: { data: unknown }) => void>();
  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === "message") this.listeners.add(listener);
  }
  postMessage(job: SimulationJob) {
    const data = simulateJob(job);
    queueMicrotask(() => this.listeners.forEach((l) => l({ data })));
  }
  terminate() {}
}

function project(floor: number, top: unknown, tolerance?: number): ProjectView {
  const { sections, ...rest } = program(floor);
  const programs = Object.fromEntries(
    sections.map((section) => [
      section.operationId,
      { ...rest, sections: [section] },
    ]),
  );
  const operations = [
    { id: "outline", name: "Outline", type: "rockett.cam.contour" },
    { id: "pocket", name: "Pocket A", type: "rockett.cam.pocket" },
  ];
  const data = {
    setups: [{ ...setup, operations, ...(tolerance && { tolerance }) }],
    tools: [],
  };
  const open = {
    projectId: "p1",
    document: {
      extensions: { [CAM_EXTENSION]: { version: 1, data } },
    } as unknown as CadDocument,
    bodies: [{ id: "b1", name: "Plate", bbox: BBOX }],
  };
  return {
    get: () => open,
    subscribe: () => () => {},
    selection: () => [],
    picks: () => [],
    select() {},
    pick: () => () => {},
    measure: () => Promise.reject(new Error("measure is not used here")),
    read: (async (
      route: { path: string },
      params: { operationId?: string; tolerance?: string },
    ) => {
      if (route.path === surfaceRoute.path) {
        expect(params.tolerance).toBe(String(GOUGE_TOLERANCE));
        return top;
      }
      expect(route.path).toBe(programRoute.path);
      return { program: programs[params.operationId!] };
    }) as ProjectView["read"],
    mutate: async () => {},
  };
}

function layer(view: ProjectView, preview: ReturnType<typeof toolpathPreview>) {
  const group = new THREE.Group();
  stockLayer(view, preview, holdDownDraft()).mount({
    group,
    requestRender: () => {},
    disposeObject: () => {},
    disposeGroup: () => {},
    clearGroup: (g) => g.clear(),
  } satisfies ViewportLayer);
  return () => {
    const tokens: string[] = [];
    group.traverse(
      (o) =>
        o instanceof THREE.Mesh &&
        tokens.push((o.material as THREE.Material).userData.themeToken),
    );
    return tokens;
  };
}

const texts = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const { role, children } = node.props as {
    role?: string;
    children?: unknown;
  };
  return role === "status" ? [String(children)] : texts(children);
};

describe("gouges in the toolpath bar and the stock layer", () => {
  beforeAll(() => {
    vi.stubGlobal("Worker", JobWorker);
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: () => "#000000",
    }));
  });
  afterAll(() => vi.unstubAllGlobals());

  it("lists the deepest gouge per operation at 0.01 mm whatever the setup tolerance, and draws its cells in err", async () => {
    const top = await surface(String(GOUGE_TOLERANCE));
    const shown = async (floor: number, tolerance?: number) => {
      const view = project(floor, top, tolerance);
      const preview = toolpathPreview(view);
      const meshes = layer(view, preview);
      await preview.select({ setupId: "s1" });
      await preview.simulate();
      return {
        status: texts(toolpathBarView(preview.get(), preview)),
        meshes: meshes(),
      };
    };

    const deep = await shown(-5);
    expect(deep.status).toHaveLength(1);
    expect(deep.status[0]).toMatch(
      /^Gouges: Pocket A 1\.000 mm deep in [\d,]+ cells$/,
    );
    expect(deep.meshes).toEqual(["border", "err"]);
    expect(await shown(-4)).toEqual({
      status: ["No gouges"],
      meshes: ["border"],
    });
    const loose = await shown(-4.3, 0.5);
    expect(loose.status[0]).toMatch(
      /^Gouges: Pocket A 0\.300 mm deep in [\d,]+ cells$/,
    );
    expect(loose.meshes).toEqual(["border", "err"]);
  }, 120_000);
});
