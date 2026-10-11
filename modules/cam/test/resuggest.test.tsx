import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CAM_EXTENSION, type CamData } from "../src/shared/document.js";
import type { MachineProfile } from "../src/shared/machine.js";
import type { Preset } from "../src/shared/tools.js";
import {
  client,
  FACE_NAME,
  fetchMock,
  flat,
  flush,
  hints,
  library,
  ok,
  open,
  router,
  saved,
  selectFace,
  serve,
  type,
  useStore,
} from "./helpers/camClient.js";

const MACHINES = "/api/m/rockett/cam/machines";

const fast: MachineProfile = {
  ...router,
  name: "Router",
  rpmMax: 24000,
  maxFeedX: 10000,
  maxFeedY: 10000,
};

const slow: MachineProfile = {
  ...fast,
  id: "m2",
  name: "Mill",
  rpmMax: 10000,
};

const onRouter: Preset = {
  id: "lib-mdf",
  name: "MDF",
  toolId: flat.id,
  rpm: 18000,
  cutFeed: 5029,
  plungeFeed: 1000,
  rampFeed: 1000,
  stepdown: 6,
  stepoverFraction: 0.4,
  coolant: "off",
};

const LABEL = "Re-suggest for this machine";

let settings: any;

beforeEach(async () => {
  fetchMock.mockImplementation(async (url, init = {}) =>
    String(url) === MACHINES
      ? Response.json({
          version: 1,
          data: [fast, slow],
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
  vi.spyOn(settingsApi, "getUserSettings").mockResolvedValue({
    values: { "plugin.rockett.cam.defaultMachine": fast.id },
    version: '"u"',
  });
  await settings.loadAppSettings();
  await settings.loadUserSettings();
  library.presets = [onRouter];
});

afterEach(() => {
  settings.clearSettings();
  vi.restoreAllMocks();
  fetchMock.mockImplementation(serve);
});

const camData = () => saved.extensions[CAM_EXTENSION]!.data as CamData;

async function onMachine(machine: MachineProfile) {
  const data = camData();
  const [first] = data.setups;
  saved.extensions[CAM_EXTENSION] = {
    version: 3,
    data: {
      ...data,
      setups: [
        {
          ...first!,
          material: "mdf",
          machine: { ...machine, libraryRef: { id: machine.id } },
        },
      ],
    },
  };
  await act(async () => useStore.getState().openProject("p1"));
  await flush();
}

const buttonNamed = (panel: Element, text: string) =>
  [...panel.querySelectorAll("button")].find((b) => b.textContent === text);

const press = async (panel: Element, text: string) => {
  await act(async () => buttonNamed(panel, text)!.click());
  await flush();
};

const writes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PUT")
    .map(([url]) => String(url));

const pocketField = (panel: Element) =>
  [...panel.querySelectorAll("label.field")]
    .find((l) => l.textContent?.startsWith("Ramp angle"))!
    .querySelector("input")!;

async function pocket() {
  await selectFace(FACE_NAME);
  const panel = await open("Pocket", "rockett.cam.pocket");
  await type(pocketField(panel), "3");
  return panel;
}

it("a setup on a 10000 rpm mill re-suggests a router preset, keeping its stepover and lowering rpm and feed in proportion; Cancel stores nothing", async () => {
  await onMachine(slow);
  const panel = await pocket();
  const revision = saved.revision;
  await press(panel, LABEL);
  const hint = hints(panel).find((text) => text?.startsWith("Suggested"));
  expect(hint).toContain("Suggested for MDF on Mill");
  expect(hint).toContain("the spindle tops out at 10000 rpm");
  expect(hint).toContain("the preset sets stepoverFraction");
  await press(panel, "Cancel");
  expect(saved.revision).toBe(revision);
  expect(writes()).toEqual([]);
  expect(library.presets).toEqual([onRouter]);
});

it("OK stores a re-suggested project copy under a new id and leaves the library preset and other operations unchanged", async () => {
  await onMachine(slow);
  let panel = await pocket();
  await act(async () => ok(panel).click());
  await flush();
  panel = await pocket();
  await press(panel, LABEL);
  await act(async () => ok(panel).click());
  await flush();

  const [tool] = camData().tools;
  const [plain, copy] = tool!.presets!;
  const { toolId: _link, ...stored } = onRouter;
  expect(plain).toEqual(stored);
  expect(copy!.id).not.toBe(onRouter.id);
  expect(copy).toEqual({
    ...stored,
    id: copy!.id,
    name: "MDF on Mill",
    rpm: 10000,
    cutFeed: 2794,
    stepoverFraction: 0.4,
  });
  expect(copy!.cutFeed / copy!.rpm).toBeCloseTo(
    onRouter.cutFeed / onRouter.rpm,
    4,
  );
  const [first, second] = camData().setups[0]!.operations!;
  expect(first!.presetId).toBe(onRouter.id);
  expect(second!.presetId).toBe(copy!.id);
  expect(library.presets).toEqual([onRouter]);
  expect(writes()).toEqual([
    "/api/projects/p1/m/rockett/cam",
    "/api/projects/p1/m/rockett/cam",
  ]);
});

it("a setup on the default machine offers no Re-suggest", async () => {
  await onMachine(fast);
  const panel = await pocket();
  expect(buttonNamed(panel, LABEL)).toBeUndefined();
});
