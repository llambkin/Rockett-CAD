import { serverRegister } from "./serverRegister.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
import { parse, type User } from "@rockett/shared";
import type {
  CadDocument,
  Route,
  RouteModuleApi,
  ServerBody,
  ModuleFiles,
  ServerContext,
  UserData,
} from "@rockett/plugin-api";
import cam from "../../server.js";
import {
  CAM_EXTENSION,
  generateRoute,
  ncRoute,
  type CamData,
  type NcExport,
} from "../../src/shared/document.js";
import { newMachine } from "../../src/shared/machine.js";
import { fixture, loadPost } from "../goldens.js";

type Handler = (body: unknown, doc?: CadDocument, params?: object) => any;

export const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

export const grbl = loadPost("grbl");
export const mine = { ...grbl, id: "my-grbl", label: "My GRBL" };
export const userMine = { ...mine, id: "user.my-grbl" };
export const copyOf = <T extends { id: string }>(post: T) => ({
  ...post,
  libraryRef: { id: post.id },
});
const contour = fixture("contour");
const tool = contour.tools[0]!;
const preset = {
  id: "p1",
  name: "MDF contour",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off" as const,
};

const body: ServerBody = {
  id: "b1",
  name: "Body 1",
  bbox: { min: [0, 0, -10], max: [40, 30, 0] } as ServerBody["bbox"],
  brep: "",
  faceNames: [],
  fingerprint: "f".repeat(64),
};

export const setup = {
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  stock: {
    kind: "boxAround" as const,
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
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
  clearance: 2,
  operations: [
    {
      id: "op1",
      type: "rockett.cam.contour",
      name: "Contour 1",
      toolId: "t1",
      presetId: "p1",
      params: {},
    },
  ],
};

export const project = (setups: CamData["setups"]) =>
  ({
    name: "Bracket",
    extensions: {
      [CAM_EXTENSION]: {
        version: 2,
        data: { setups, tools: [{ ...tool, presets: [preset] }] },
      },
    },
  }) as unknown as CadDocument;

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

const routes = new Map<string, Handler>();
let dataDir = "";
export let posts: UserData;

export const call = (
  method: string,
  at: string,
  ...rest: Parameters<Handler>
) => {
  const handle = routes.get(`${method} ${at}`);
  if (!handle) throw new Error(`no route ${method} ${at}`);
  return handle(...rest);
};

export const add = async (post: string) =>
  call("POST", "/m/rockett/cam/posts", {
    post,
    etag: (await posts.read(mark))?.etag ?? null,
  });

export const generate = (doc: CadDocument) =>
  call("POST", generateRoute.path, { setupId: "s1", operationId: "op1" }, doc);

export const nc = (
  doc: CadDocument,
  postId: string,
  toolChange = "perFile",
): Promise<NcExport> =>
  call("GET", ncRoute.path, undefined, doc, {
    machineId: "m1",
    postId,
    toolChange,
    setupIds: "s1",
  });

const core = (file: string) =>
  import(new URL(`../../../../server/src/${file}`, import.meta.url).href);

const value = (route: Route, input: unknown) =>
  route.body ? parse(route.body, JSON.parse(JSON.stringify(input))) : input;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-posts-"));
  const [{ moduleUserData }, { LocalStorage }] = await Promise.all([
    core("store/moduleData.ts"),
    core("store/storage.ts"),
  ]);
  const userData: (name: string, version: number) => UserData = moduleUserData(
    new LocalStorage(dataDir, fs),
    "rockett.cam",
  );
  posts = userData("posts", 1);
  await userData("machines", 1).write(
    mark,
    [{ ...newMachine(0), id: "m1" }],
    null,
  );
  const mount =
    (route: Route, handle: any): Handler =>
    (input, doc, params) =>
      doc
        ? handle(
            doc,
            { params: { id: "p1", ...params }, body: value(route, input) },
            { user: mark },
          )
        : handle({ params: {}, body: value(route, input) }, { user: mark });
  const keep = (route: Route, handle: any) =>
    routes.set(`${route.method} ${route.path}`, mount(route, handle));
  const api: RouteModuleApi = {
    projectRoute: keep,
    projectMutation: keep,
    userRoute: keep,
  };
  const context: ServerContext = {
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount(api);
      return () => {};
    }),
    startKernelJob: async (_id, input) => {
      const { setup: s, operation } = input as {
        setup: { id: string };
        operation: { id: string };
      };
      const program = structuredClone(contour);
      program.setupId = s.id;
      for (const section of program.sections)
        section.operationId = operation.id;
      return program;
    },
    userData,
    files: memory(),
    kernelVersion: { occt: "7.9.1", commit: "abc1234" },
    dxf: async () => new Uint8Array(),
    signFaces: async () => [],
    bodies: async () => [body],
  };
  await cam.activate(context);
});

afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));
