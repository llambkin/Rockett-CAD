import { promises as fs, readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CadDocument,
  OpenProject,
  ProjectView,
} from "@rockett/plugin-api";
import {
  CAM_EXTENSION,
  migrateCam,
  type CamData,
} from "../src/shared/document.js";
import { newSetup, saveSetup } from "../src/client/setup.js";
import { CLEARANCE, SAFE_HEIGHT } from "../src/shared/settings.js";
import type { Fixture } from "../src/shared/setup.js";

const core = (file: string) =>
  import(new URL(`../../../server/src/${file}`, import.meta.url).href);

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`./fixtures/documents/${name}.json`, import.meta.url),
      "utf8",
    ),
  );

const camV2 = fixture("cam-v2");

const camV3 = fixture("cam-v3");

const bodies = [
  { id: "b1", name: "Plate", bbox: { min: [0, 0, 0], max: [40, 20, 5] } },
] satisfies OpenProject["bodies"];

const preSetupData = {
  setups: [{ id: "s1", name: "Setup 1" }],
  tools: [{ id: "t1", diameter: 6 }],
};

let dataDir = "";
let origin = "";
let cookie = "";
let store: any;
let storage: any;
let backupNamespace: any;
let ownerId = "";
let server: http.Server;
let unload = () => {};

const request = (at: string, init: RequestInit = {}) =>
  fetch(`${origin}/api${at}`, {
    ...init,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

const load = async (id: string): Promise<CadDocument> =>
  (await (await request(`/projects/${id}`)).json()).document;

const historyLength = async (id: string): Promise<number> =>
  (await (await request(`/projects/${id}/history`)).json()).entries.length;

async function projectView(id: string): Promise<ProjectView> {
  let open: OpenProject = {
    projectId: id,
    document: await load(id),
    bodies,
  };
  return {
    get: () => open,
    selection: () => [],
    picks: () => [],
    select() {},
    pick: () => () => {},
    measure: () => Promise.reject(new Error("measure is not used here")),
    subscribe: () => () => {},
    read: () => Promise.reject(new Error("read is not used here")),
    async mutate(route, body) {
      const res = await request(route.path.replace(":id", id), {
        method: route.method,
        headers: { "If-Match": `"${open.document!.revision}"` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      open = { ...open, document: (await res.json()).document };
    },
  };
}

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-setup-"));
  const [
    { createApp },
    { ProjectStore },
    { validateDocument },
    { FolderStore },
    { LocalStorage },
    { InProcessKernel },
    { SessionStore },
    { UserStore },
    { cookieConfig },
    { loadModules },
    { serverModules },
    jsonStore,
  ] = await Promise.all([
    core("app.ts"),
    core("store/projectStore.ts"),
    core("api/validate.ts"),
    core("store/folderStore.ts"),
    core("store/storage.ts"),
    core("kernel/client.ts"),
    core("auth/sessions.ts"),
    core("auth/userStore.ts"),
    core("auth/cookie.ts"),
    core("modules/host.ts"),
    import(new URL("../../index.server.ts", import.meta.url).href),
    core("store/jsonStore.ts"),
  ]);
  backupNamespace = jsonStore.backupNamespace;
  storage = new LocalStorage(dataDir, fs);
  store = new ProjectStore(storage, validateDocument);
  const folders = new FolderStore(storage);
  unload = await loadModules(
    serverModules,
    new InProcessKernel({ sources: async () => new Map() }),
    store,
    folders,
  );
  const users = new UserStore(storage);
  const sessions = await SessionStore.open(storage);
  const owner = await users.create({
    username: "mark",
    displayName: "Mark",
    role: "admin",
    passwordHash: "scrypt$test",
  });
  ownerId = owner.id;
  const config = cookieConfig(undefined);
  cookie = `${config.name}=${await sessions.create(owner.id)}`;
  server = http.createServer();
  await new Promise<void>((done) => server.listen(0, "localhost", done));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  const { app } = await createApp({
    store,
    folders,
    kernel: new InProcessKernel(store),
    allowedOrigins: [origin],
    users,
    sessions,
    cookie: config,
  });
  server.on("request", app);
}, 120_000);

afterAll(async () => {
  unload();
  await new Promise((done) => server?.close(done));
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function project(data?: unknown, version = 1): Promise<CadDocument> {
  const doc = await store.create("Plate", ownerId);
  if (data === undefined) return doc;
  doc.extensions = { [CAM_EXTENSION]: { version, data } };
  await store.save(doc, ownerId);
  return doc;
}

const defaults = {
  safeHeight: SAFE_HEIGHT.default as number,
  clearance: CLEARANCE.default as number,
};

describe("setup dialog save", () => {
  it("adds exactly one history entry holding the dialog's setup", async () => {
    const doc = await project();
    const view = await projectView(doc.id);
    const before = await historyLength(doc.id);
    const setup = newSetup(view.get(), defaults);
    await saveSetup(view, setup);
    expect(await historyLength(doc.id)).toBe(before + 1);
    expect(setup).toMatchObject({
      name: "Setup 1",
      bodies: ["b1"],
      stock: { kind: "boxAround" },
      wcs: {
        origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
        offsetIndex: 1,
      },
      safeHeight: 15,
      clearance: 3,
    });
    expect((await load(doc.id)).extensions[CAM_EXTENSION]).toEqual({
      version: 4,
      data: { setups: [setup], tools: [] },
    });
  });

  it("loads a v1 document saved before setup fields unchanged and keeps it as v4 on save", async () => {
    const doc = await project(preSetupData);
    const loaded = await load(doc.id);
    expect(migrateCam(loaded.extensions[CAM_EXTENSION])).toEqual({
      status: "ready",
      data: preSetupData,
    });
    const view = await projectView(doc.id);
    const before = await historyLength(doc.id);
    const setup = newSetup(view.get(), defaults);
    expect(setup.name).toBe("Setup 2");
    await saveSetup(view, setup);
    expect(await historyLength(doc.id)).toBe(before + 1);
    expect((await load(doc.id)).extensions[CAM_EXTENSION]).toEqual({
      version: 4,
      data: { ...preSetupData, setups: [...preSetupData.setups, setup] },
    });
  });

  it("loads a v2 document unchanged, backs it up before its first v4 save and stores no machine, post or tolerance on its setups", async () => {
    const doc = await project(structuredClone(camV2.data), camV2.version);
    const loaded = await load(doc.id);
    expect(loaded.extensions[CAM_EXTENSION]).toEqual(camV2);
    expect(migrateCam(loaded.extensions[CAM_EXTENSION])).toEqual({
      status: "ready",
      data: camV2.data,
    });
    const view = await projectView(doc.id);
    const setup = newSetup(view.get(), defaults);
    await saveSetup(view, setup);
    const backups = backupNamespace(storage, store.documents.dir(doc.id));
    const names = await backups.names();
    expect(names).toEqual([
      expect.stringMatching(/^rockett\.cam\.v2\.v4-[0-9a-f]{16}$/),
    ]);
    const file = (await backups.verify(names[0]!)).find(
      ([name]: [string]) => name === `documents/${doc.id}.json`,
    );
    const backed = JSON.parse(
      (await backups.verified(names[0]!, ...file!)).toString("utf8"),
    );
    expect(backed.extensions[CAM_EXTENSION]).toEqual(camV2);
    const after = (await load(doc.id)).extensions[CAM_EXTENSION]!;
    expect(after).toEqual({
      version: 4,
      data: { ...camV2.data, setups: [...camV2.data.setups, setup] },
    });
    for (const key of ["machine", "postId", "tolerance"])
      expect((after.data as CamData).setups[0]).not.toHaveProperty(key);
  });

  it("loads a v3 document unchanged, backs it up before its first v4 save and keeps its setups without hold-downs", async () => {
    const doc = await project(structuredClone(camV3.data), camV3.version);
    const loaded = await load(doc.id);
    expect(loaded.extensions[CAM_EXTENSION]).toEqual(camV3);
    expect(migrateCam(loaded.extensions[CAM_EXTENSION])).toEqual({
      status: "ready",
      data: camV3.data,
    });
    const view = await projectView(doc.id);
    const fixtures: Fixture[] = [
      { name: "toe clamp 1", min: [0, 0, 0], max: [4, 4, 9] },
    ];
    const setup = { ...newSetup(view.get(), defaults), fixtures };
    await saveSetup(view, setup);
    const backups = backupNamespace(storage, store.documents.dir(doc.id));
    const names = await backups.names();
    expect(names).toEqual([
      expect.stringMatching(/^rockett\.cam\.v3\.v4-[0-9a-f]{16}$/),
    ]);
    const file = (await backups.verify(names[0]!)).find(
      ([name]: [string]) => name === `documents/${doc.id}.json`,
    );
    const backed = JSON.parse(
      (await backups.verified(names[0]!, ...file!)).toString("utf8"),
    );
    expect(backed.extensions[CAM_EXTENSION]).toEqual(camV3);
    const after = (await load(doc.id)).extensions[CAM_EXTENSION]!;
    expect(after).toEqual({
      version: 4,
      data: { ...camV3.data, setups: [...camV3.data.setups, setup] },
    });
    expect((after.data as CamData).setups[0]).not.toHaveProperty("fixtures");
  });
});
