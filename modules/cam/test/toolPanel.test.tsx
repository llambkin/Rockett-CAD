import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_SETTINGS_TEXT } from "../src/import/grblSettings.js";
import { POST_KIT_FILE, postKit } from "../src/post/kit.js";
import type { Post } from "../src/post/schema.js";
import type { MachineProfile } from "../src/shared/machine.js";
import type { Tool } from "../src/shared/tools.js";
import { loadPost } from "./goldens.js";

const load = (path: string) => import(path);

const client = (file: string) => load(`../../../client/src/${file}`);

const TOOLS = "/api/m/rockett/cam/tools";
const MACHINES = "/api/m/rockett/cam/machines";
const POSTS = "/api/m/rockett/cam/posts";
const PRESETS = "/api/m/rockett/cam/presets";

let stored: { data: Tool[]; etag: string } | null;
let puts: { data: Tool[]; etag: string | null }[];
let failing: string | null;
let machines: { data: MachineProfile[]; etag: string } | null;
let machinePuts: { data: MachineProfile[]; etag: string | null }[];
let posts: { data: Post[]; etag: string } | null;
let postPosts: { post: string; etag: string | null }[];
let postPuts: { data: Post[]; etag: string | null }[];
let refusal: string | null;
let host: HTMLElement;
let root: Root;
let unload = () => {};
let runCommand: (id: string) => unknown;

function serveMachines(method: string, init: RequestInit) {
  if (method === "GET")
    return Response.json(
      machines && { version: 1, ...machines, readOnly: false },
    );
  const body = JSON.parse(String(init.body));
  machinePuts.push(body);
  machines = { data: body.data, etag: `m${machinePuts.length}` };
  return Response.json({ version: 1, ...machines, readOnly: false });
}

function servePosts(method: string, init: RequestInit) {
  if (method === "GET")
    return Response.json(posts && { version: 1, ...posts, readOnly: false });
  const body = JSON.parse(String(init.body));
  if (method === "PUT") {
    postPuts.push(body);
    posts = { data: body.data, etag: `q${postPuts.length}` };
    return Response.json({ version: 1, ...posts, readOnly: false });
  }
  postPosts.push(body);
  if (refusal) return Response.json({ error: refusal }, { status: 400 });
  posts = { data: [JSON.parse(body.post)], etag: `p${postPosts.length}` };
  return Response.json({ version: 1, ...posts, readOnly: false });
}

function serve(url: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  if (method === "GET" && String(url) === failing)
    return Response.json({ error: "disk unavailable" }, { status: 500 });
  if (String(url) === MACHINES) return serveMachines(method, init);
  if (String(url) === POSTS) return servePosts(method, init);
  if (String(url) === PRESETS && method === "GET") return Response.json(null);
  if (String(url) !== TOOLS) throw new Error(`${method} ${url}`);
  if (method === "GET")
    return Response.json(stored && { version: 1, ...stored, readOnly: false });
  const body = JSON.parse(String(init.body));
  puts.push(body);
  stored = { data: body.data, etag: `e${puts.length}` };
  return Response.json({ version: 1, ...stored, readOnly: false });
}

async function flush() {
  for (let i = 0; i < 10; i++)
    await act(async () => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(async () => {
  stored = null;
  puts = [];
  failing = null;
  machines = null;
  machinePuts = [];
  posts = null;
  postPosts = [];
  postPuts = [];
  refusal = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      serve(url, init),
    ),
  );
  const [
    { loadClientModules },
    { clientModules },
    { Panels },
    { ConfirmPanel },
    { SettingsButton },
    { useSettings },
    registry,
  ] = await Promise.all([
    client("modules/host.ts"),
    load("../../index.client.ts"),
    client("shell/panels.tsx"),
    client("components/ConfirmPanel.tsx"),
    client("components/SettingsPanel.tsx"),
    client("settings.ts"),
    client("commands/registry.ts"),
  ]);
  runCommand = registry.runCommand;
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
  useSettings.setState((s: { resolved: object }) => ({
    resolved: {
      ...s.resolved,
      "units.length": { value: "in", source: "user" },
    },
  }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root.render(
      h(Fragment, null, h(Panels), h(SettingsButton), h(ConfirmPanel)),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  unload();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const panelTitled = (title: string) =>
  [...host.querySelectorAll(".dialog-panel")].find(
    (p) => p.querySelector(".dialog-title span")?.textContent === title,
  );

const button = (panel: Element, label: string) =>
  [...panel.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  ) as HTMLButtonElement;

const field = (panel: Element, label: string) =>
  [...panel.querySelectorAll("label.field")].find(
    (l) => l.querySelector("span")?.textContent === label,
  )!;

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

async function type(panel: Element, label: string, text: string) {
  const input = field(panel, label).querySelector("input")!;
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focus"));
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(panel: Element, label: string, value: string) {
  const select = field(panel, label).querySelector("select")!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(panel: Element, label: string) {
  await act(async () => button(panel, label).click());
  await flush();
}

const page = () => host.querySelector(".settings-panel")!;

const rows = () =>
  [...page().querySelectorAll(".tree-item > span:first-child")].map(
    (s) => s.textContent,
  );

const cards = () =>
  [...page().querySelectorAll(".tree-header")].map(
    (header) => header.firstChild!.textContent,
  );

async function openLibrary(title = "Tools") {
  await act(async () => void runCommand("rockett.cam.library"));
  await flush();
  if (title !== "Machines") await click(page(), title);
  return page();
}

const flat: Tool = {
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

it("a diameter entered in inch is stored in mm", async () => {
  const library = await openLibrary();
  expect(library.querySelector(".tree-header")?.textContent).toBe("Your tools");
  expect(library.textContent).toContain("No tools yet.");
  expect(library.querySelector('[role="alert"]')).toBeNull();

  await click(library, "Add tool");
  const form = page();
  expect(
    [...form.querySelectorAll(".field span")].map((s) => s.textContent),
  ).toEqual([
    "Name",
    "Kind",
    "Diameter (in)",
    "Flute length (in)",
    "Overall length (in)",
    "Shank diameter (in)",
    "Flutes",
    "Centre cutting",
  ]);
  await type(form, "Diameter (in)", "0.25");
  await click(form, "OK");

  expect(puts).toHaveLength(1);
  expect(puts[0]!.etag).toBeNull();
  expect(puts[0]!.data).toHaveLength(1);
  expect(puts[0]!.data[0]!.diameter).toBeCloseTo(6.35, 9);
  expect(puts[0]!.data[0]).toMatchObject({ name: "Tool 1", kind: "flat" });
  expect(button(page(), "OK")).toBeUndefined();
  expect(rows()).toEqual(["Tool 1"]);
});

it("edits a library tool with the etag of the last read", async () => {
  stored = { data: [flat], etag: "e0" };
  const library = await openLibrary();
  expect(rows()).toEqual(["6 mm flat"]);

  await click(library, "Edit 6 mm flat");
  const form = page();
  await choose(form, "Kind", "vbit");
  expect(field(form, "Tip angle (°)")).toBeDefined();
  await type(form, "Tip angle (°)", "60");
  await click(form, "OK");

  expect(puts).toEqual([
    { data: [{ ...flat, kind: "vbit", tipAngle: 60 }], etag: "e0" },
  ]);
  await click(page(), "Edit 6 mm flat");
  await choose(page(), "Kind", "flat");
  await click(page(), "OK");
  expect(puts[1]).toEqual({ data: [flat], etag: "e1" });
});

it("deletes a tool only after ui.confirm says OK", async () => {
  stored = { data: [flat], etag: "e0" };
  const library = await openLibrary();

  await click(library, "Delete 6 mm flat");
  const confirm = panelTitled("Confirm")!;
  expect(confirm.textContent).toContain("Delete 6 mm flat from your library?");
  await click(confirm, "Cancel");
  expect(puts).toEqual([]);
  expect(rows()).toEqual(["6 mm flat"]);

  await click(page(), "Delete 6 mm flat");
  await click(panelTitled("Confirm")!, "OK");
  expect(puts).toEqual([{ data: [], etag: "e0" }]);
  expect(page().textContent).toContain("No tools yet.");
});

it("says why the tools did not load", async () => {
  failing = TOOLS;
  const library = await openLibrary();
  expect(library.querySelector('[role="alert"]')?.textContent).toMatch(
    /^Tools did not load: .+\.$/,
  );
  expect(button(library, "Add tool")).toBeUndefined();
});

it("adds and saves a machine through the page", async () => {
  const library = await openLibrary("Machines");
  expect(library.textContent).toContain("No machines yet.");

  await click(library, "Add machine");
  const form = page();
  await choose(form, "Firmware", "grblhal");
  await type(form, "X max (in)", "10");
  await click(form, "OK");

  expect(puts).toEqual([]);
  expect(machinePuts).toHaveLength(1);
  expect(machinePuts[0]!.etag).toBeNull();
  expect(machinePuts[0]!.data).toHaveLength(1);
  expect(machinePuts[0]!.data[0]!.xMax).toBeCloseTo(254, 9);
  expect(machinePuts[0]!.data[0]).toMatchObject({
    name: "Machine 1",
    firmware: "grblhal",
    post: "grblhal",
    toolChange: "perFile",
  });
  expect(button(page(), "OK")).toBeUndefined();
  expect(rows()).toEqual(["Machine 1"]);
});

const router: MachineProfile = {
  id: "m1",
  name: "Router",
  firmware: "grbl",
  post: "grbl",
  xMin: 0,
  xMax: 300,
  yMin: 0,
  yMax: 300,
  zMin: -80,
  zMax: 0,
  maxFeedX: 3000,
  maxFeedY: 3000,
  maxFeedZ: 1000,
  rpmMin: 0,
  rpmMax: 24000,
  toolChange: "perFile",
  units: "mm",
};

const dump = [
  "$11=0.010",
  "$30=24000.",
  "$31=0.",
  "$32=0",
  "$110=5000.000",
  "$111=5000.000",
  "$112=1500.000",
  "$120=400.000",
  "$121=400.000",
  "ok",
].join("\r\n");

const setText = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
)!.set!;

async function paste(panel: Element, text: string) {
  await click(panel, "Import $$");
  const area = field(panel, "$$ output").querySelector("textarea")!;
  await act(async () => {
    setText.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return area;
}

const shown = (panel: Element, label: string) =>
  field(panel, label).querySelector("input")!.value;

const listed = (panel: Element) =>
  [...panel.querySelectorAll(".tree-item > span")].map((s) => s.textContent);

async function editRouter(machine: MachineProfile) {
  machines = { data: [machine], etag: "m0" };
  await click(await openLibrary("Machines"), "Edit Router");
  return page();
}

it("a pasted $$ missing $122 fills $110 and lists $122", async () => {
  const form = await editRouter(router);
  expect(shown(form, "Acceleration Z (mm/s^2)")).toBe("");
  await paste(form, dump);
  await click(form, "Fill from $$");

  expect(form.querySelector('[role="alert"]')).toBeNull();
  expect(listed(form)).toEqual(["$122"]);
  expect(shown(form, "Max feed X (mm/min)")).toBe("5000");
  await click(form, "OK");
  const saved = machinePuts[0]!.data[0]!;
  expect(saved).toMatchObject({
    maxFeedX: 5000,
    accelX: 400,
    laserMode: false,
  });
  expect(saved).not.toHaveProperty("accelZ");
});

it("a mill's Rigidity reads Rigid when unset and saves the pick", async () => {
  const form = await editRouter(router);
  const select = field(form, "Rigidity").querySelector("select")!;
  expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
    ["light", "Light"],
    ["medium", "Medium"],
    ["rigid", "Rigid"],
  ]);
  expect(select.value).toBe("rigid");
  await choose(form, "Rigidity", "light");
  expect(form.textContent).toContain(
    "Suggest takes 70% of the chart chip load and a stepdown of 0.5 x D.",
  );
  await click(form, "OK");
  expect(machinePuts[0]!.data[0]).toEqual({ ...router, rigidity: "light" });
});

it("a laser has no Rigidity", async () => {
  const form = await editRouter({
    ...router,
    kind: "laser",
    laserPowerMax: 1000,
  });
  expect(field(form, "Rigidity")).toBeUndefined();
});

it("refuses a $$ with $30 below the stored minimum", async () => {
  const form = await editRouter({ ...router, rpmMin: 10000 });
  await paste(form, "$30=5000.\n$110=5000.000\n");
  await click(form, "Fill from $$");

  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    "$$ import refused: max spindle speed must be at least the min.",
  );
  expect(shown(form, "Max feed X (mm/min)")).toBe("3000");
  await click(form, "OK");
  expect(machinePuts[0]!.data[0]).toEqual({ ...router, rpmMin: 10000 });
});

it("saves a cleared optional limit as unset", async () => {
  const form = await editRouter({ ...router, accelX: 400 });
  expect(shown(form, "Acceleration X (mm/s^2)")).toBe("400");
  await type(form, "Acceleration X (mm/s^2)", "");
  await click(form, "OK");
  expect(machinePuts[0]!.data[0]).toEqual(router);
});

it("cuts a paste over the $$ cap and says so", async () => {
  const form = await editRouter(router);
  const area = await paste(form, "x".repeat(MAX_SETTINGS_TEXT + 10));
  expect(area.value).toHaveLength(MAX_SETTINGS_TEXT);
  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    `Cut to the ${MAX_SETTINGS_TEXT} character limit`,
  );
});

const mine = { ...loadPost("grbl"), id: "my-grbl", label: "My GRBL" };

const pickPost = (text: string) =>
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    Object.defineProperty(this, "files", {
      value: [new File([text], "my-grbl.json")],
    });
    this.dispatchEvent(new Event("change"));
  });

it("imports a post file with the etag of the last read and lists it unqualified", async () => {
  posts = { data: [], etag: "p0" };
  const library = await openLibrary("Posts");
  expect(library.textContent).toContain("No posts of your own yet.");
  const text = JSON.stringify(mine);
  const picker = pickPost(text);
  await click(library, "Import post");

  expect((picker.mock.contexts[0] as HTMLInputElement).accept).toBe(
    ".json,application/json",
  );
  expect(postPosts).toEqual([{ post: text, etag: "p0" }]);
  expect(cards()).toContain("My GRBL (unqualified)");
  expect(library.querySelector('[role="alert"]')).toBeNull();
});

it("says why a post did not import", async () => {
  refusal = "post templates.linear: needs {feed}";
  const library = await openLibrary("Posts");
  pickPost(JSON.stringify(loadPost("grbl")));
  await click(library, "Import post");

  expect(postPosts).toHaveLength(1);
  expect(postPosts[0]!.etag).toBeNull();
  expect(library.querySelector('[role="alert"]')?.textContent).toBe(
    "Post did not import: post templates.linear: needs {feed}.",
  );
  expect(library.textContent).toContain("No posts of your own yet.");
});

it("deletes a user post after ui.confirm", async () => {
  const other = { ...mine, id: "user.other", label: "Other" };
  posts = { data: [{ ...mine, id: "user.my-grbl" }, other], etag: "p0" };
  const library = await openLibrary("Posts");

  await click(library, "Delete My GRBL");
  expect(panelTitled("Confirm")!.textContent).toContain(
    "Delete My GRBL from your library? Projects that use it keep their copy.",
  );
  await click(panelTitled("Confirm")!, "OK");
  expect(postPuts).toEqual([{ data: [other], etag: "p0" }]);
  expect(cards().filter((c) => c!.endsWith("(unqualified)"))).toEqual([
    "Other (unqualified)",
  ]);
});

it("names each machine that uses a user post as its default before deleting it", async () => {
  posts = { data: [{ ...mine, id: "user.my-grbl" }], etag: "p0" };
  machines = {
    data: [
      { ...router, post: "user.my-grbl" },
      { ...router, id: "m2", name: "Mill" },
    ],
    etag: "m0",
  };
  const library = await openLibrary("Posts");

  await click(library, "Delete My GRBL");
  expect(panelTitled("Confirm")!.textContent).toContain(
    "Delete My GRBL from your library? Projects that use it keep their copy. Router uses it as its default post.",
  );
  await click(panelTitled("Confirm")!, "Cancel");
  machines.data[1]!.post = "user.my-grbl";
  await click(page(), "Machines");
  await click(page(), "Posts");
  await click(page(), "Delete My GRBL");
  expect(panelTitled("Confirm")!.textContent).toContain(
    "Router and Mill use it as their default post.",
  );
});

it("says why the posts did not load beside a machine's default post", async () => {
  failing = POSTS;
  machines = { data: [router], etag: "m0" };
  const library = await openLibrary("Machines");

  await click(library, "Edit Router");
  const alert = page().querySelector('[role="alert"]')!;
  expect(alert.textContent).toBe("Posts did not load: HTTP 500.");
  expect(alert.nextElementSibling!.querySelector("span")!.textContent).toBe(
    "Default post",
  );
});

it("downloads the generated post kit beside Import post", async () => {
  posts = { data: [], etag: "p0" };
  const blobs: Blob[] = [];
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => `blob:${blobs.push(blob)}`,
    revokeObjectURL: () => {},
  });
  const save = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const library = await openLibrary("Posts");
  const labels = [...library.querySelectorAll("button")].map(
    (b) => b.textContent,
  );
  expect(labels.indexOf("Download post kit")).toBe(
    labels.indexOf("Import post") + 1,
  );

  await click(library, "Download post kit");
  expect((save.mock.contexts[0] as HTMLAnchorElement).download).toBe(
    POST_KIT_FILE,
  );
  expect(blobs[0]!.type).toBe("text/markdown");
  expect(await blobs[0]!.text()).toBe(postKit());
});
