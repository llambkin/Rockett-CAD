import { serverRegister } from "./helpers/serverRegister.js";
import { beforeAll, expect, it } from "vitest";
import type {
  CadDocument,
  OpenProject,
  ProjectView,
  RouteModuleApi,
  User,
} from "@rockett/plugin-api";
import cam from "../server.js";
import { acceptPlan } from "../src/client/planDialog.js";
import {
  planOperations,
  type PlanFeatures,
  type PlanTool,
} from "../src/plan/plan.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  type CamData,
} from "../src/shared/document.js";
import { newMachine } from "../src/shared/machine.js";
import type { FaceRef } from "../src/shared/params.js";

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-06T00:00:00.000Z",
  modifiedAt: "2026-10-06T00:00:00.000Z",
};

const face = (faceName: string, z: number): FaceRef => ({
  kind: "face",
  bodyId: "b1",
  faceName,
  sig: { type: "plane", point: [0, 0, z], direction: [0, 0, 1] },
});

const body = {
  overallLength: 60,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const flat12: PlanTool = {
  ...body,
  id: "lib-12",
  name: "12 mm flat",
  kind: "flat",
  diameter: 12,
  fluteLength: 30,
  presets: [
    {
      id: "lib-rough",
      name: "MDF rough",
      toolId: "lib-12",
      rpm: 16000,
      cutFeed: 2000,
      plungeFeed: 500,
      rampFeed: 600,
      stepdown: 3,
      stepoverFraction: 0.4,
      coolant: "off",
    },
  ],
};

const flat4: PlanTool = {
  ...body,
  id: "lib-4",
  name: "4 mm flat",
  kind: "flat",
  diameter: 4,
  fluteLength: 15,
  presets: [],
};

const drill3: PlanTool = {
  ...body,
  id: "lib-drill",
  name: "3 mm drill",
  kind: "drill",
  diameter: 3,
  fluteLength: 30,
  tipAngle: 118,
  presets: [flat12.presets[0]!],
};

const machine = newMachine(0);

const setup = {
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  material: "mdf",
  stock: {
    kind: "boxAround" as const,
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 2 },
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
  fixtures: [],
  operations: [],
};

const features = (width: number): PlanFeatures => ({
  stockTop: 20,
  stockOutline: { min: [0, 0], max: [100, 60] },
  modelTop: 18,
  holes: [],
  pockets: [
    {
      id: "slot",
      name: "Slot",
      floor: face("f:slot", 10),
      z: 10,
      width,
      cornerRadius: 2,
      footprint: { min: [20, 20], max: [60, 40] },
    },
  ],
  profiles: [
    {
      id: "outer",
      name: "Outer",
      face: face("f:bottom", 0),
      z: 0,
      footprint: { min: [0, 0], max: [100, 60] },
      side: "outside",
    },
  ],
});

type Handler = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

const routes = new Map<string, Handler>();

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
    startKernelJob: async () => {
      throw new Error("no job runs here");
    },
    userData: () => ({ read: async () => null, write: async () => null! }),
    files: {
      read: async () => null,
      write: async () => {},
      remove: async () => {},
      list: async () => [],
    },
    kernelVersion: null,
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => [],
  });
});

function projectView() {
  const id = crypto.randomUUID();
  const edits: string[] = [];
  const data: CamData = { setups: [setup], tools: [] };
  let open: OpenProject = {
    projectId: id,
    document: {
      id,
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
      const done = await routes.get(route.path)!(
        doc,
        { params: { id }, body: sent },
        { user: mark },
      );
      edits.push(done.label);
      open = { ...open, document: doc };
    },
  };
  const stored = () =>
    open.document!.extensions[CAM_EXTENSION]!.data as CamData;
  return { view, edits, stored };
}

const planning = {
  setupId: "s1",
  material: "mdf",
  machine,
  tools: [flat12, flat4],
};

it("accepting with one unchecked adds the rest in order as one history entry", async () => {
  const plan = planOperations(setup, features(20), planning.tools, machine);
  expect(plan.operations.map(({ name }) => name)).toEqual([
    "Face stock top",
    "Pocket, Slot",
    "Rest, Slot corners",
    "Contour, outer, 4 tabs",
  ]);
  const { view, edits, stored } = projectView();

  await acceptPlan(
    view,
    planning,
    plan.operations.filter(({ name }) => name !== "Face stock top"),
  );

  expect(edits).toHaveLength(1);
  const [{ operations = [] }] = stored().setups as [CamData["setups"][number]];
  const tools = stored().tools;
  expect(operations.map(({ type, name }) => [type, name])).toEqual([
    ["rockett.cam.pocket", "Pocket, Slot"],
    ["rockett.cam.pocket", "Rest, Slot corners"],
    ["rockett.cam.contour", "Contour, outer, 4 tabs"],
  ]);
  const [pocket, rest, contour] = operations as [
    (typeof operations)[number],
    (typeof operations)[number] & { prior?: string },
    (typeof operations)[number],
  ];
  expect(rest.prior).toBe(pocket.id);
  expect(
    tools.map(({ libraryRef, number }) => [libraryRef?.id, number]),
  ).toEqual([
    ["lib-12", 1],
    ["lib-4", 2],
  ]);
  const [big, small] = tools as [
    (typeof tools)[number],
    (typeof tools)[number],
  ];
  expect(pocket.toolId).toBe(big.id);
  expect(contour.toolId).toBe(big.id);
  const { toolId: _owner, ...rough } = flat12.presets[0]!;
  expect(big.presets).toEqual([rough]);
  expect(pocket.presetId).toBe("lib-rough");
  expect(rest.toolId).toBe(small.id);
  expect(small.presets?.map(({ id }) => id)).toEqual([rest.presetId]);
  expect(pocket.params).toEqual({ floor: face("f:slot", 10), rampAngle: 5 });
});

it("adds the drill and adaptive the planner proposes, and the rest after the adaptive", async () => {
  const tools = [flat12, flat4, drill3];
  const plan = planOperations(
    setup,
    {
      ...features(30),
      holes: [
        { centre: [5, 5], diameter: 3, top: 18, bottom: 10, blocked: false },
      ],
    },
    tools,
    machine,
  );
  expect(plan.unplanned).toEqual([]);
  const { view, stored } = projectView();

  await acceptPlan(view, { ...planning, tools }, plan.operations);

  const [{ operations = [] }] = stored().setups as [CamData["setups"][number]];
  expect(operations.map(({ type, name }) => [type, name])).toEqual([
    ["rockett.cam.facing", "Face stock top"],
    ["rockett.cam.drill", "Drill 1 x 3 mm"],
    ["rockett.cam.adaptive", "Adaptive, Slot"],
    ["rockett.cam.pocket", "Rest, Slot corners"],
    ["rockett.cam.contour", "Contour, outer, 4 tabs"],
  ]);
  const [, drill, adaptive, rest] = operations as [
    (typeof operations)[number],
    (typeof operations)[number],
    (typeof operations)[number],
    (typeof operations)[number] & { prior?: string },
  ];
  expect(drill.params).toEqual({ diameter: 3, points: [[5, 5]] });
  expect(adaptive.params).toEqual({
    floor: face("f:slot", 10),
    rampAngle: 5,
    engagement: 60,
  });
  expect(rest.prior).toBe(adaptive.id);
});
