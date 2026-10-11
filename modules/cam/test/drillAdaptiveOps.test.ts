import { serverRegister } from "./helpers/serverRegister.js";
import { beforeAll, expect, it } from "vitest";
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
import type { FeaturesInput } from "../src/kernel/features.js";
import { acceptPlan } from "../src/client/planDialog.js";
import {
  planOperations,
  type PlanFeatures,
  type PlanTool,
} from "../src/plan/plan.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  generateRoute,
  ncRoute,
  type CamData,
  type NcExport,
} from "../src/shared/document.js";
import { validateProgram, type Program } from "../src/shared/ir.js";
import { newMachine } from "../src/shared/machine.js";
import { blockBody, blockSetup } from "./helpers/blocks.js";
import {
  box,
  brep,
  cut,
  cylinder,
  moduleJob,
  startKernel,
} from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-06T00:00:00.000Z",
  modifiedAt: "2026-10-06T00:00:00.000Z",
};

const HOLES: [number, number][] = [
  [55, 20],
  [55, 40],
  [68, 30],
];

const body: { value?: ServerBody } = {};

const at = (x: number) => Number(x.toFixed(6));

beforeAll(async () => {
  await startKernel();
  body.value = blockBody(
    brep((own) => {
      let made = cut(
        own,
        box(own, [0, 0, 0], [80, 60, 20]),
        box(own, [10, 10, 12], [24, 30, 9]),
      );
      for (const [x, y] of HOLES)
        made = cut(own, made, cylinder(own, [x, y, -1], [0, 0, 1], 3, 22));
      return made;
    }),
    [80, 60, 20],
  );
}, 120_000);

const preset = (toolId: string) => ({
  id: `${toolId}-preset`,
  name: "MDF",
  toolId,
  rpm: 16000,
  cutFeed: 1500,
  plungeFeed: 400,
  rampFeed: 600,
  stepdown: 3,
  stepoverFraction: 0.4,
  coolant: "off" as const,
});

const shank = { overallLength: 60, shankDiameter: 6, flutes: 2 };

const flat8: PlanTool = {
  ...shank,
  id: "lib-8",
  name: "8 mm flat",
  kind: "flat",
  diameter: 8,
  fluteLength: 30,
  centreCutting: true,
  presets: [preset("lib-8")],
};

const drill6: PlanTool = {
  ...shank,
  id: "lib-drill",
  name: "6 mm drill",
  kind: "drill",
  diameter: 6,
  fluteLength: 30,
  centreCutting: true,
  tipAngle: 118,
  presets: [preset("lib-drill")],
};

const machine = { ...newMachine(0), id: "m1" };

const setup = {
  id: "s1",
  name: "Setup 1",
  ...blockSetup,
  material: "mdf",
  safeHeight: 15,
  clearance: 3,
  fixtures: [],
  operations: [],
};

type Handler = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

function memory(): ModuleFiles {
  const stored = new Map<string, Uint8Array>();
  return {
    read: async (name) => stored.get(name) ?? null,
    write: async (name, data) => {
      stored.set(
        name,
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    },
    remove: async (name) => {
      stored.delete(name);
    },
    list: async () => [...stored.keys()],
  };
}

async function mounted() {
  const routes = new Map<string, Handler>();
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
    startKernelJob: (id, input) => moduleJob(ENTRY, id, input),
    userData: (name) => ({
      read: async () =>
        name === "machines"
          ? { version: 1, data: [machine], etag: "e1", readOnly: false }
          : null,
      write: async () => null!,
    }),
    files: memory(),
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => [body.value!],
  });
  return routes;
}

function projectView(routes: Map<string, Handler>) {
  const id = "p1";
  const data: CamData = { setups: [setup], tools: [] };
  let open: OpenProject = {
    projectId: id,
    document: {
      id,
      name: "Block",
      extensions: { [CAM_EXTENSION]: { version: CAM_VERSION, data } },
    } as unknown as CadDocument,
    bodies: [],
  };
  const view: ProjectView = {
    get: () => open,
    selection: () => [],
    picks: () => [],
    select() {},
    pick: () => () => {},
    measure: () => Promise.reject(new Error("measure is not used here")),
    subscribe: () => () => {},
    read: () => Promise.reject(new Error("read is not used here")),
    async mutate(route, sent) {
      const doc = structuredClone(open.document!);
      await routes.get(route.path)!(
        doc,
        { params: { id }, body: sent },
        { user: mark },
      );
      open = { ...open, document: doc };
    },
  };
  return view;
}

it("adds a planned drill group and adaptive pocket, generates both and exports checked NC", async () => {
  const { bbox, brep: text, faceNames } = body.value!;
  const features = (await moduleJob(ENTRY, "rockett.cam.features", {
    setup: blockSetup,
    bodies: [{ id: "b1", bbox, brep: text, faceNames }],
  } satisfies FeaturesInput)) as PlanFeatures;
  const tools = [flat8, drill6];
  const plan = planOperations(setup, features, tools, machine);
  const wanted = plan.operations.filter(({ type }) =>
    ["rockett.cam.drill", "rockett.cam.adaptive"].includes(type),
  );
  expect(wanted.map(({ name }) => name)).toEqual([
    "Drill 3 x 6 mm",
    "Adaptive, Pocket 1",
  ]);

  const routes = await mounted();
  const view = projectView(routes);
  await acceptPlan(view, { setupId: "s1", machine, tools }, wanted);
  const doc = view.get().document!;
  const stored = () => doc.extensions[CAM_EXTENSION]!.data as CamData;
  const operations = stored().setups[0]!.operations ?? [];
  expect(operations.map(({ type }) => type)).toEqual([
    "rockett.cam.drill",
    "rockett.cam.adaptive",
  ]);

  const generate = (operationId: string) =>
    routes.get(generateRoute.path)!(
      doc,
      { params: { id: "p1" }, body: { setupId: "s1", operationId } },
      { user: mark },
    ) as Promise<{ program: Program }>;
  const [drilled, cleared] = [
    (await generate(operations[0]!.id)).program,
    (await generate(operations[1]!.id)).program,
  ];
  for (const program of [drilled, cleared])
    expect(validateProgram(program)).toEqual([]);
  const cycles = drilled.sections.flatMap(({ moves }) =>
    moves.flatMap((move) => (move.kind === "cycle" ? [move] : [])),
  );
  expect(
    cycles
      .flatMap(({ points }) => points.map(([x, y]) => [at(x), at(y)]))
      .toSorted(([a, b], [c, d]) => a! - c! || b! - d!),
  ).toEqual(HOLES);
  expect(cycles.every(({ cycle }) => cycle === "drill")).toBe(true);
  expect(cleared.sections[0]!.moves.length).toBeGreaterThan(10);

  const exported = (await routes.get(ncRoute.path)!(
    doc,
    {
      params: {
        id: "p1",
        machineId: "m1",
        postId: "grbl",
        toolChange: "perFile",
        setupIds: "s1",
      },
    },
    { user: mark },
  )) as NcExport;
  expect(exported).not.toHaveProperty("blocked");
  expect(exported).not.toHaveProperty("reason");
  expect(exported).toMatchObject({ fileName: "Block.zip" });
}, 240_000);
