import { serverRegister } from "./serverRegister.js";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import type {
  CadDocument,
  FaceRef,
  ModuleFiles,
  RouteModuleApi,
  ServerBody,
  User,
} from "@rockett/plugin-api";
import cam from "../../server.js";
import { newSetup } from "../../src/client/setup.js";
import { CAM_EXTENSION } from "../../src/shared/document.js";
import { newMachine } from "../../src/shared/machine.js";
import type { Preset, Tool } from "../../src/shared/tools.js";
import { loadPost } from "../goldens.js";

export const load = (path: string) => import(path);

export const client = (file: string) => load(`../../../../client/src/${file}`);

export const SIGN =
  "/projects/:id/m/rockett/cam/bodies/:bodyId/faces/:faceName/sig";
export const STATUS = "/projects/:id/m/rockett/cam/setups/:setupId/status";
export const SAVE = "/projects/:id/m/rockett/cam";

export const FACE_NAME = "f:plate/top ?#%&+~1";

export const bbox: ServerBody["bbox"] = { min: [0, 0, 0], max: [40, 20, 5] };

export const sig = { type: "plane", point: [20, 10, 5], direction: [0, 0, 1] };

export const flat: Tool = {
  id: "lib-flat",
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

export const mine = {
  ...loadPost("grbl"),
  id: "user.my-grbl",
  label: "My GRBL",
};

export const router = { ...newMachine(0), id: "m1", name: "Router" };

export const ball: Tool = {
  ...flat,
  id: "lib-ball",
  name: "6 mm ball",
  kind: "ball",
};

export const preset: Preset = {
  id: "lib-preset",
  name: "MDF",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 1,
  stepoverFraction: 0.4,
  coolant: "off",
};

export const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

export type Handler = (
  doc: CadDocument,
  req: unknown,
  ctx: unknown,
) => Promise<any>;

export const routes = new Map<string, Handler>();
export let signed: FaceRef[][] = [];
export let saved: CadDocument;
export let exports: { path: string; revision: number }[] = [];
export let library: {
  tools: Tool[] | null;
  presets: Preset[] | "fail";
  posts: (typeof mine)[];
};
export let host: HTMLElement;
export let root: Root;
export let unload = () => {};
export let runCommand: (id: string) => unknown;
export let useStore: any;
export let initial: unknown;

export const files: ModuleFiles = {
  read: async () => null,
  write: async () => {},
  remove: async () => {},
  list: async () => [],
};

export const serverBody: ServerBody = {
  id: "b1",
  name: "Plate",
  bbox,
  brep: "",
  faceNames: [FACE_NAME],
  fingerprint: "a".repeat(64),
};

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
    files,
    kernelVersion: null,
    bodies: async () => [serverBody],
    dxf: async () => new Uint8Array(),
    signFaces: async (_id, _user, refs) => {
      signed.push([...refs]);
      return refs.map((ref) => ({ ...ref, sig }) as never);
    },
  });
});

export const entry = (data: unknown[] | null) =>
  Response.json(data && { version: 1, data, etag: "e1", readOnly: false });

export const evaluation = {
  bodies: [
    {
      bodyId: "b1",
      name: "Plate",
      meshKey: "b1-mesh",
      mesh: { hash: "b1".padStart(64, "0"), bytes: 1 },
      bbox,
    },
  ],
  featureStatuses: [],
  sketches: [],
  planes: [],
  kernelMs: 0,
};

export const history = { entries: [], position: 0, checkpoints: [] };

export async function serve(url: RequestInfo | URL, init: RequestInit = {}) {
  const [path] = String(url)
    .replace(/^\/api/, "")
    .split("?");
  const method = init.method ?? "GET";
  const sign =
    /^\/projects\/p1\/m\/rockett\/cam\/bodies\/([^/]+)\/faces\/([^/]+)\/sig$/.exec(
      path!,
    );
  if (method === "GET" && sign)
    return Response.json(
      await routes.get(SIGN)!(
        saved,
        {
          params: {
            id: "p1",
            bodyId: decodeURIComponent(sign[1]!),
            faceName: decodeURIComponent(sign[2]!),
          },
        },
        { user: mark },
      ),
    );
  if (method === "GET" && path === "/m/rockett/cam/tools")
    return entry(library.tools);
  if (method === "GET" && path === "/m/rockett/cam/presets")
    return library.presets === "fail"
      ? Response.json({ error: "disk unavailable" }, { status: 500 })
      : entry(library.presets);
  if (method === "GET" && path === "/m/rockett/cam/machines")
    return entry([router]);
  if (method === "GET" && path === "/m/rockett/cam/posts")
    return entry(library.posts);
  if (method === "GET" && path!.startsWith("/projects/p1/m/rockett/cam/nc/")) {
    exports.push({ path: path!, revision: saved.revision });
    return Response.json({ blocked: [] });
  }
  if (method === "GET" && path === "/projects/p1")
    return Response.json({ document: saved, access: "edit" });
  if (method === "GET" && path === "/projects/p1/view")
    return Response.json(
      (await load("../../../../shared/src/api.ts")).emptyView(),
    );
  if (method === "POST" && path === "/projects/p1/evaluate")
    return Response.json(evaluation);
  if (method === "GET" && path === "/projects/p1/history")
    return Response.json(history);
  if (method === "PUT" && path === "/projects/p1/m/rockett/cam") {
    const body = JSON.parse(String(init.body));
    const doc = structuredClone(saved);
    await routes.get(SAVE)!(
      doc,
      { params: { id: "p1" }, body },
      { user: mark },
    );
    saved = { ...doc, revision: saved.revision + 1 };
    return Response.json({
      document: saved,
      evaluation,
      history: {
        canUndo: true,
        canRedo: false,
        undoLabel: "Edit CAM data",
        redoLabel: null,
      },
    });
  }
  throw new Error(`${method} ${path}`);
}

export const fetchMock = vi.fn(serve);

export async function flush() {
  for (let i = 0; i < 10; i++)
    await act(async () => new Promise((r) => setTimeout(r, 0)));
}

export const project = {
  projectId: "p1",
  document: null,
  bodies: [{ id: "b1", name: "Plate", bbox }],
};

beforeEach(async () => {
  const { createEmptyDocument } = await load(
    "../../../../shared/src/documents.ts",
  );
  const setup = newSetup(project as never, { safeHeight: 15, clearance: 3 });
  saved = {
    ...createEmptyDocument("p1", "Plate"),
    revision: 4,
    extensions: {
      [CAM_EXTENSION]: { version: 1, data: { setups: [setup], tools: [] } },
    },
  };
  signed = [];
  exports = [];
  library = { tools: [flat, ball], presets: [preset], posts: [mine] };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  const [
    { loadClientModules },
    { clientModules },
    { Panels },
    registry,
    store,
  ] = await Promise.all([
    client("modules/host.ts"),
    load("../../../index.client.ts"),
    client("shell/panels.tsx"),
    client("commands/registry.ts"),
    client("store.ts"),
  ]);
  runCommand = registry.runCommand;
  useStore = store.useStore;
  initial = useStore.getState();
  unload = await loadClientModules(clientModules, async () => [
    {
      id: "rockett.cam",
      name: "CAM",
      version: "0.1.0",
      licence: "UNLICENSED",
      author: "Rockett",
      status: "loaded",
      error: null,
    },
  ]);
  await useStore.getState().openProject("p1");
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(h(Panels)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  unload();
  useStore.setState(initial, true);
  vi.unstubAllGlobals();
});

export const panelTitled = (title: string) =>
  [...host.querySelectorAll(".dialog-panel")].find(
    (p) => p.querySelector(".dialog-title span")?.textContent === title,
  );

export const fieldLabels = (panel: Element) =>
  [...panel.querySelectorAll("label.field > span:first-child")].map(
    (s) => s.textContent,
  );

export const field = (panel: Element, label: string) =>
  [...panel.querySelectorAll("label.field")]
    .find((l) => l.textContent?.startsWith(label))!
    .querySelector("input")!;

export const toolSelect = (panel: Element) =>
  [...panel.querySelectorAll("label.field")]
    .find((l) => l.textContent?.startsWith("Tool"))!
    .querySelector("select")!;

export const hints = (panel: Element) =>
  [...panel.querySelectorAll(".field-hint")].map((s) => s.textContent);

export const ok = (panel: Element) =>
  [...panel.querySelectorAll("button")].find((b) => b.textContent === "OK")!;

export const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

export async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focus"));
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export const selectFace = (faceName: string) =>
  act(async () =>
    useStore.setState({
      selection: [{ kind: "face", bodyId: "b1", faceName }],
    }),
  );

export async function open(label: string, command: string) {
  await act(async () => void runCommand(command));
  await flush();
  return panelTitled(label)!;
}
