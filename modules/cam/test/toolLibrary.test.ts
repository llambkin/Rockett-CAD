import { serverRegister } from "./helpers/serverRegister.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, type User } from "@rockett/shared";
import type {
  CadDocument,
  Route,
  RouteModuleApi,
  ServerContext,
  UserData,
} from "@rockett/plugin-api";
import cam from "../server.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  migrateCam,
} from "../src/shared/document.js";
import type { Preset, Tool } from "../src/shared/tools.js";

type Handler = (body: unknown, doc?: CadDocument) => Promise<unknown>;

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

const tool: Tool = {
  id: "t1",
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const preset: Preset = {
  id: "p1",
  name: "MDF rough",
  rpm: 18000,
  cutFeed: 1800,
  plungeFeed: 600,
  rampFeed: 900,
  stepdown: 3,
  stepoverFraction: 0.4,
  coolant: "off",
};

const routes = new Map<string, Handler>();
let dataDir = "";
let presetStore: UserData;

const call = async (
  method: string,
  at: string,
  body: unknown,
  doc?: CadDocument,
) => {
  const handle = routes.get(`${method} ${at}`);
  if (!handle) throw new Error(`no route ${method} ${at}`);
  return handle(body, doc);
};

const body = (route: Route, value: unknown) =>
  route.body ? parse(route.body, JSON.parse(JSON.stringify(value))) : value;

const project = (data?: unknown): CadDocument =>
  ({
    extensions:
      data === undefined ? {} : { [CAM_EXTENSION]: { version: 1, data } },
  }) as CadDocument;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-library-"));
  const [{ moduleUserData }, { LocalStorage }] = await Promise.all([
    core("store/moduleData.ts"),
    core("store/storage.ts"),
  ]);
  const userData: (name: string, version: number) => UserData = moduleUserData(
    new LocalStorage(dataDir, fs),
    "rockett.cam",
  );
  presetStore = userData("presets", 1);
  const add =
    (wrap: (route: Route, handle: any) => Handler) =>
    (route: Route, handle: any) =>
      routes.set(`${route.method} ${route.path}`, wrap(route, handle));
  const api: RouteModuleApi = {
    projectRoute: add(
      (route, handle) => (value, doc) =>
        handle(
          doc,
          { params: { id: "p1" }, body: body(route, value) },
          { user: mark },
        ),
    ),
    projectMutation: add(
      (route, handle) => (value, doc) =>
        handle(
          doc,
          { params: { id: "p1" }, body: body(route, value) },
          { user: mark },
        ),
    ),
    userRoute: add(
      (route, handle) => (value) =>
        handle({ params: {}, body: body(route, value) }, { user: mark }),
    ),
  };
  const context: ServerContext = {
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount(api);
      return () => {};
    }),
    startKernelJob: async () => null,
    userData,
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
  };
  await cam.activate(context);
});

afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe("CAM tool library", () => {
  it("keeps the document copy when the library tool is deleted", async () => {
    const saved: any = await call("PUT", "/m/rockett/cam/tools", {
      data: [tool],
      etag: null,
    });
    expect(await call("GET", "/m/rockett/cam/tools", undefined)).toEqual(saved);
    const doc = project({ setups: [{ id: "s1" }], tools: [] });
    await call("POST", "/projects/:id/m/rockett/cam/tools", { id: "t1" }, doc);
    const read = migrateCam(doc.extensions[CAM_EXTENSION]);
    if (read.status !== "ready") throw new Error(read.reason);
    const [copy] = read.data.tools;
    expect(copy).toEqual({ ...tool, id: copy?.id, libraryRef: { id: "t1" } });
    expect(copy?.id).not.toBe("t1");
    const before = structuredClone(doc.extensions);
    await call("PUT", "/m/rockett/cam/tools", { data: [], etag: saved.etag });
    expect(await call("GET", "/m/rockett/cam/tools", undefined)).toMatchObject({
      data: [],
    });
    expect(doc.extensions).toEqual(before);
    await call("PUT", "/projects/:id/m/rockett/cam", read.data, doc);
    expect(doc.extensions).toEqual(before);
  });

  it("refuses to use a tool the library does not have", async () => {
    const doc = project();
    await expect(
      call("POST", "/projects/:id/m/rockett/cam/tools", { id: "gone" }, doc),
    ).rejects.toThrow("tool gone is not in your library");
    expect(doc.extensions).toEqual({});
  });

  it("saves presets with the etag checked", async () => {
    const saved: any = await call("PUT", "/m/rockett/cam/presets", {
      data: [preset],
      etag: null,
    });
    expect(saved).toMatchObject({
      version: 1,
      data: [preset],
      readOnly: false,
    });
    await expect(
      call("PUT", "/m/rockett/cam/presets", { data: [], etag: null }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await call("GET", "/m/rockett/cam/presets", undefined)).toEqual(
      saved,
    );
  });

  it.each([
    ["a tool without a diameter", "tools", { ...tool, diameter: undefined }],
    ["a tool of an unknown kind", "tools", { ...tool, kind: "saw" }],
    [
      "a preset with an unknown coolant",
      "presets",
      { ...preset, coolant: "oil" },
    ],
  ])("refuses %s by schema", async (_name, list, item) => {
    await expect(
      call("PUT", `/m/rockett/cam/${list}`, { data: [item], etag: null }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it.each([
    [
      "tools",
      "tool t1: corner radius must be between 0 and half the diameter",
      [{ ...tool, kind: "bull", cornerRadius: 4 }],
    ],
    [
      "presets",
      "preset p1: cutFeed must be greater than 0",
      [{ ...preset, cutFeed: 0 }],
    ],
    ["tools", "tools has t1 twice", [tool, tool]],
  ])("refuses %s with: %s", async (list, reason, data) => {
    await expect(
      call("PUT", `/m/rockett/cam/${list}`, { data, etag: null }),
    ).rejects.toThrow(reason);
  });
});

describe("CAM preset library written before CAM-075", () => {
  it("saves and deletes beside a stored preset with an odd toolId", async () => {
    const odd = { ...preset, id: "odd", name: "Odd link", toolId: 5 };
    const current: any = await call("GET", "/m/rockett/cam/presets", undefined);
    const stored = await presetStore.write(mark, [odd], current?.etag ?? null);
    const made = { ...preset, id: "new", name: "New", toolId: tool.id };
    const added: any = await call("PUT", "/m/rockett/cam/presets", {
      data: [odd, made],
      etag: stored.etag,
    });
    expect(added.data).toEqual([odd, made]);
    const removed: any = await call("PUT", "/m/rockett/cam/presets", {
      data: [odd],
      etag: added.etag,
    });
    expect(removed.data).toEqual([odd]);
  });
});

describe("CAM document tool copies", () => {
  it("reads a v1 document saved before tool fields unchanged", () => {
    const data = {
      setups: [{ id: "s1", name: "Setup 1" }],
      tools: [{ id: "t1" }, { id: "t2", diameter: 6, number: 2 }],
    };
    const stored = { version: 1, data: structuredClone(data) };
    expect(migrateCam(stored)).toEqual({ status: "ready", data });
    expect(stored).toEqual({ version: 1, data });
  });

  it.each([
    ["an empty", ""],
    ["a numeric", 5],
  ])("reads a preset copy holding %s toolId as base did", (_name, toolId) => {
    const data = {
      setups: [{ id: "s1", name: "Setup 1" }],
      tools: [{ id: "t1", presets: [{ ...preset, toolId }] }],
    };
    expect(migrateCam({ version: CAM_VERSION, data })).toEqual({
      status: "ready",
      data,
    });
  });

  it("keeps a copy with a mistyped tool field read only", () => {
    expect(
      migrateCam({
        version: 1,
        data: { setups: [], tools: [{ id: "t1", libraryRef: { id: "" } }] },
      }),
    ).toEqual({ status: "kept", reason: "CAM data version 1 is not valid" });
  });
});
