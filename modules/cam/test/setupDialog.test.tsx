import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CAM_EXTENSION,
  migrateCam,
  ncRoute,
  type CamData,
} from "../src/shared/document.js";
import type { MachineProfile } from "../src/shared/machine.js";
import {
  client,
  evaluation,
  exports,
  fetchMock,
  flush,
  hints,
  mark,
  mine,
  ok,
  open,
  router,
  routes,
  saved,
  serve,
  useStore,
} from "./helpers/camClient.js";

const MACHINES = "/api/m/rockett/cam/machines";

const mill: MachineProfile = {
  ...router,
  id: "m2",
  name: "Mill",
  post: "grblhal",
};

let userValues: Record<string, unknown>;
let settings: any;

beforeEach(async () => {
  userValues = {};
  fetchMock.mockImplementation(async (url, init = {}) =>
    String(url) === MACHINES
      ? Response.json({
          version: 1,
          data: [router, mill],
          etag: "m0",
          readOnly: false,
        })
      : serve(url, init),
  );
  const [{ settingsApi }, store] = await Promise.all([
    client("settingsApi.ts"),
    client("settings.ts"),
  ]);
  settings = store;
  vi.spyOn(settingsApi, "getAppSettings").mockResolvedValue({
    values: {},
    version: '"a"',
  });
  vi.spyOn(settingsApi, "getUserSettings").mockImplementation(async () => ({
    values: userValues,
    version: '"u"',
  }));
  await settings.loadAppSettings();
});

afterEach(() => {
  settings.clearSettings();
  vi.restoreAllMocks();
  fetchMock.mockImplementation(serve);
});

const withSettings = async (values: Record<string, unknown>) => {
  userValues = values;
  await settings.loadUserSettings();
};

const field = (panel: Element, label: string) =>
  [...panel.querySelectorAll("label.field")].find(
    (l) => l.querySelector("span")?.textContent === label,
  )!;

const select = (panel: Element, label: string) =>
  field(panel, label).querySelector("select")!;

const input = (panel: Element, label: string) =>
  field(panel, label).querySelector("input")!;

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

async function type(panel: Element, label: string, text: string) {
  const box = input(panel, label);
  await act(async () => {
    box.dispatchEvent(new FocusEvent("focus"));
    setValue.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(panel: Element, label: string, value: string) {
  const box = select(panel, label);
  await act(async () => {
    box.value = value;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function press(panel: Element, text: string) {
  const button = [...panel.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
  await act(async () => button.click());
  await flush();
}

const stored = () => saved.extensions[CAM_EXTENSION]!;
const setups = () => (stored().data as CamData).setups;

it("saves each new row and reads it back after the project reloads", async () => {
  await withSettings({});
  const panel = await open("Setup 2", "rockett.cam.setup");
  expect(
    [...panel.querySelectorAll("label.field > span:first-child")]
      .map((s) => s.textContent)
      .slice(0, 5),
  ).toEqual(["Name", "Bodies", "Material", "Machine", "Post"]);
  expect(hints(panel)).toContain(
    "Default tolerance for new operations in this setup.",
  );
  await type(panel, "Name", "Roughing");
  await choose(panel, "Material", "mdf");
  await choose(panel, "Machine", "m2");
  await choose(panel, "Post", mine.id);
  await type(panel, "Tolerance (mm)", "0.05");
  await press(panel, "OK");

  const setup = {
    name: "Roughing",
    material: "mdf",
    machine: { ...mill, libraryRef: { id: "m2" } },
    postId: mine.id,
    post: { ...mine, libraryRef: { id: mine.id } },
    tolerance: 0.05,
  };
  expect(stored().version).toBe(4);
  expect(setups()[1]).toMatchObject(setup);

  await act(async () => useStore.getState().openProject("p1"));
  await flush();
  const read = migrateCam(
    useStore.getState().document.extensions[CAM_EXTENSION],
  );
  expect(read.status).toBe("ready");
  expect((read as { data: CamData }).data.setups[1]).toMatchObject(setup);
});

it("a new setup leaves a reference body out of its bodies until the Bodies field picks it", async () => {
  await withSettings({});
  const [plate] = evaluation.bodies;
  const pin = {
    ...plate!,
    bodyId: "rockett.kicad:l1:r1",
    name: "R1",
    reference: true,
  };
  evaluation.bodies.push(pin);
  try {
    await act(async () => useStore.getState().openProject("p1"));
    await flush();
    const panel = await open("Setup 2", "rockett.cam.setup");
    const options = [...select(panel, "Bodies").options].map((o) => o.text);
    expect(options).toEqual(["All bodies", "Plate", "R1"]);
    expect(select(panel, "Bodies").value).toBe("b1");
    await choose(panel, "Bodies", pin.bodyId);
    await choose(panel, "Bodies", "");
    expect(select(panel, "Bodies").value).toBe("b1");
    await choose(panel, "Bodies", pin.bodyId);
    await press(panel, "OK");
    expect(setups()[1]!.bodies).toEqual([pin.bodyId]);
  } finally {
    evaluation.bodies.pop();
  }
});

it("places hold-downs by numbers, saves the keep-out ones as fixtures and drops tape", async () => {
  await withSettings({});
  const panel = await open("Setup 2", "rockett.cam.setup");
  const empty = "No hold-downs. The stock must be held another way.";
  expect(hints(panel)).toContain(empty);
  await press(panel, "Add hold-down");
  expect(hints(panel)).not.toContain(empty);
  await type(panel, "X (mm)", "10");
  await type(panel, "Y (mm)", "50");
  await press(panel, "Add hold-down");
  await press(panel, "Add hold-down");
  const second = panel.querySelector('[aria-label="Hold-down 2"]')!;
  await choose(second, "Hold-down", "tape");
  expect(hints(second)).toEqual(["holds the whole stock, no keep-out"]);
  await act(async () =>
    panel
      .querySelector<HTMLButtonElement>('[aria-label="Remove hold-down 3"]')!
      .click(),
  );
  expect(panel.querySelectorAll('[role="group"]')).toHaveLength(2);
  await press(panel, "OK");

  expect(stored().version).toBe(4);
  expect(setups()[1]!.fixtures).toEqual([
    { name: "toe clamp 1", min: [10, 50, 0], max: [50, 70, 25] },
  ]);
});

it("a new setup takes the default machine, its post and the default tolerance from the CAM settings", async () => {
  await withSettings({
    "plugin.rockett.cam.defaultMachine": "m2",
    "plugin.rockett.cam.tolerance": 0.02,
  });
  const panel = await open("Setup 2", "rockett.cam.setup");
  expect(select(panel, "Machine").value).toBe("m2");
  expect(select(panel, "Post").value).toBe("grblhal");
  expect(input(panel, "Tolerance (mm)").value).toBe("0.02");
  await press(panel, "OK");

  const [, setup] = setups();
  expect(setup).toMatchObject({
    machine: { ...mill, libraryRef: { id: "m2" } },
    postId: "grblhal",
    tolerance: 0.02,
  });
  expect(setup).not.toHaveProperty("post");
});

it("NC export starts on the setup's machine and post, and a machine deleted from the library exports from the setup's copy", async () => {
  await withSettings({ "plugin.rockett.cam.defaultMachine": "m1" });
  const gone = { ...mill, id: "m9", name: "Old mill" };
  const data = stored().data as CamData;
  const [first] = data.setups;
  saved.extensions[CAM_EXTENSION] = {
    version: 3,
    data: {
      ...data,
      setups: [
        {
          ...first!,
          machine: { ...mill, libraryRef: { id: "m2" } },
          postId: "linuxcnc",
        },
      ],
    },
  };
  await act(async () => useStore.getState().openProject("p1"));
  await flush();
  let panel = await open("NC Program", "rockett.cam.nc");
  expect(select(panel, "Machine").value).toBe("m2");
  expect(select(panel, "Post").value).toBe("linuxcnc");
  await press(panel, "Export");
  expect(exports.at(-1)!.path).toBe(
    `/projects/p1/m/rockett/cam/nc/m2/linuxcnc/perFile/${first!.id}`,
  );
  await press(panel, "Cancel");

  saved.extensions[CAM_EXTENSION] = {
    version: 3,
    data: {
      ...data,
      setups: [{ ...first!, machine: { ...gone, libraryRef: { id: "m9" } } }],
    },
  };
  await act(async () => useStore.getState().openProject("p1"));
  await flush();
  panel = await open("NC Program", "rockett.cam.nc");
  const machine = select(panel, "Machine");
  expect(machine.value).toBe("m9");
  expect([...machine.options].map((o) => o.textContent)).toEqual([
    "Router",
    "Mill",
    "Old mill",
  ]);

  const nc = routes.get(ncRoute.path)!;
  const params = {
    id: "p1",
    machineId: "m9",
    postId: "grblhal",
    toolChange: "perFile",
    setupIds: first!.id,
  };
  expect(await nc(saved, { params }, { user: mark })).toEqual({
    reason: "Nothing to export: the chosen setups have no operations",
  });
  saved.extensions[CAM_EXTENSION] = { version: 3, data };
  expect(await nc(saved, { params }, { user: mark })).toEqual({
    reason: `${first!.name}: machine m9 is not in your library`,
  });
});

it("NC export resets Post to the default of a machine the user picks", async () => {
  const data = stored().data as CamData;
  const [first] = data.setups;
  saved.extensions[CAM_EXTENSION] = {
    version: 3,
    data: {
      ...data,
      setups: [
        {
          ...first!,
          machine: { ...mill, libraryRef: { id: "m2" } },
          postId: "linuxcnc",
        },
      ],
    },
  };
  await act(async () => useStore.getState().openProject("p1"));
  await flush();
  const panel = await open("NC Program", "rockett.cam.nc");
  expect(select(panel, "Post").value).toBe("linuxcnc");
  await choose(panel, "Machine", "m1");
  expect(select(panel, "Post").value).toBe("grbl");
  await choose(panel, "Post", "linuxcnc");
  await choose(panel, "Machine", "m2");
  expect(select(panel, "Post").value).toBe("grblhal");
});

it("a setup whose machine's default post is gone cannot save until a post is picked", async () => {
  const lathe = { ...mill, id: "m3", name: "Lathe", post: "user.gone" };
  fetchMock.mockImplementation(async (url, init = {}) =>
    String(url) === MACHINES
      ? Response.json({
          version: 1,
          data: [router, lathe],
          etag: "m0",
          readOnly: false,
        })
      : serve(url, init),
  );
  await withSettings({ "plugin.rockett.cam.defaultMachine": "m3" });
  const panel = await open("Setup 2", "rockett.cam.setup");
  expect(hints(panel)).toContain("Lathe's default post is gone. Pick a post.");
  expect(ok(panel).disabled).toBe(true);
  await choose(panel, "Post", "grbl");
  expect(ok(panel).disabled).toBe(false);
  await press(panel, "OK");
  expect(setups()[1]).toMatchObject({ postId: "grbl" });
});
