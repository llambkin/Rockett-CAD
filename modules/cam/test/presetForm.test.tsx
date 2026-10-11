import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { suggestFeeds } from "../src/feeds/suggest.js";
import { TOOLS_FILE } from "../src/import/rockett.js";
import { CAM_EXTENSION, type CamData } from "../src/shared/document.js";
import type { MachineProfile } from "../src/shared/machine.js";
import type { Preset, Tool } from "../src/shared/tools.js";
import {
  FACE_NAME,
  fetchMock,
  flat,
  flush,
  ok,
  open,
  router,
  saved,
  selectFace,
  serve,
} from "./helpers/camClient.js";
import {
  button,
  choose,
  click,
  field,
  mountSettings,
  openMachines,
  type,
} from "./helpers/settingsPage.js";

const TOOLS = "/api/m/rockett/cam/tools";
const PRESETS = "/api/m/rockett/cam/presets";
const MACHINES = "/api/m/rockett/cam/machines";

const shop: MachineProfile = {
  ...router,
  name: "Shop",
  rpmMin: 12000,
  rpmMax: 24000,
  maxFeedX: 1500,
  maxFeedY: 1500,
  maxFeedZ: 500,
};

const legacy: Preset = {
  id: "old",
  name: "Any tool rough",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 1,
  stepoverFraction: 0.4,
  coolant: "off",
};

type Stored<T> = { data: T[]; etag: string };

let machines: MachineProfile[];
let tools: Stored<Tool>;
let presets: Stored<Preset>;
let presetPuts: { data: Preset[]; etag: string | null }[];

function library<T>(
  stored: () => Stored<T>,
  keep: (next: Stored<T>) => void,
  puts: unknown[],
  method: string,
  init: RequestInit,
) {
  if (method !== "GET") {
    const body = JSON.parse(String(init.body));
    puts.push(body);
    keep({ data: body.data, etag: `${body.etag ?? "n"}+` });
  }
  return Response.json({ version: 1, ...stored(), readOnly: false });
}

beforeEach(async () => {
  machines = [shop];
  tools = { data: [flat], etag: "t0" };
  presets = { data: [legacy], etag: "p0" };
  presetPuts = [];
  fetchMock.mockImplementation(async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (String(url) === MACHINES && method === "GET")
      return Response.json({ version: 1, data: machines, etag: "m0" });
    if (String(url) === TOOLS)
      return library(
        () => tools,
        (t) => (tools = t),
        [],
        method,
        init,
      );
    if (String(url) === PRESETS)
      return library(
        () => presets,
        (p) => (presets = p),
        presetPuts,
        method,
        init,
      );
    return serve(url, init);
  });
  await mountSettings({
    values: { "plugin.rockett.cam.defaultMachine": shop.id },
    patches: [],
  });
});

async function openTools() {
  const panel = await openMachines();
  await click(panel, "Tools");
  return panel;
}

const toolGroup = (panel: Element, name: string) =>
  panel.querySelector(`[aria-label="${name} presets"]`)!;

const names = (list: Element) =>
  [...list.querySelectorAll(".tree-item > span:first-child")].map(
    (s) => s.textContent,
  );

const value = (panel: Element, label: string) =>
  field(panel, label).querySelector("input")!.value;

const hintText = (panel: Element) =>
  [...panel.querySelectorAll(".field-hint")].map((s) => s.textContent);

it("creates a preset for a tool with no presets, and the operation dialog then accepts it", async () => {
  const panel = await openTools();
  const group = toolGroup(panel, "6 mm flat");
  expect(group.className).toBe("tree-children");
  expect(group.textContent).toBe("No presets yet.");
  expect(names(panel.querySelector('[aria-label="Other presets"]')!)).toEqual([
    "Any tool rough",
  ]);

  await click(panel, "New preset for 6 mm flat");
  expect(
    [...panel.querySelectorAll(".field > span:first-child")].map(
      (s) => s.textContent,
    ),
  ).toEqual([
    "Name",
    "Tool",
    "Material",
    "Spindle speed (rpm)",
    "Cut feed (mm/min)",
    "Plunge feed (mm/min)",
    "Ramp feed (mm/min)",
    "Stepdown (mm)",
    "Stepover (fraction of diameter)",
    "Coolant",
    "Finishing profile",
  ]);
  expect(field(panel, "Tool").querySelector("select")!.value).toBe(flat.id);
  await type(panel, "Name", "Aluminium rough");
  await choose(panel, "Coolant", "mist");
  await click(panel, "OK");

  expect(presetPuts).toHaveLength(1);
  expect(presetPuts[0]!.etag).toBe("p0");
  const [, made] = presetPuts[0]!.data;
  expect(presetPuts[0]!.data[0]).toEqual(legacy);
  expect(made).toMatchObject({
    name: "Aluminium rough",
    toolId: flat.id,
    coolant: "mist",
  });
  expect(names(toolGroup(panel, "6 mm flat"))).toEqual(["Aluminium rough"]);
  await click(panel, "Close settings");

  await selectFace(FACE_NAME);
  const dialog = await open("Contour", "rockett.cam.contour");
  const select = field(dialog, "Preset").querySelector("select")!;
  expect([...select.options].map((o) => o.textContent)).toEqual([
    "Any tool rough",
    "Aluminium rough",
  ]);
  await choose(dialog, "Preset", made!.id);
  await type(dialog, "Bottom offset (mm)", "0");
  await act(async () => ok(dialog).click());
  await flush();

  const data = saved.extensions[CAM_EXTENSION]!.data as CamData;
  const [copy] = data.tools;
  const { toolId, ...unlinked } = made!;
  expect(toolId).toBe(flat.id);
  expect(copy!.presets).toEqual([unlinked]);
  expect(data.setups[0]!.operations!.at(-1)).toMatchObject({
    type: "rockett.cam.contour",
    toolId: copy!.id,
    presetId: made!.id,
  });
});

const CHIPLOAD = 0.0762;
const CUTTING_SPEED = 182.88;

function aluminium(machine: MachineProfile) {
  const wanted = (CUTTING_SPEED * 1000) / (Math.PI * flat.diameter);
  const rpm = Math.min(Math.max(wanted, machine.rpmMin), machine.rpmMax);
  const cutFeed = Math.min(
    rpm * flat.flutes * CHIPLOAD,
    machine.maxFeedX,
    machine.maxFeedY,
  );
  const plungeFeed = Math.min(cutFeed / flat.flutes, machine.maxFeedZ);
  const expected = {
    rpm,
    cutFeed,
    plungeFeed,
    stepdown: flat.diameter,
    stepoverFraction: 1,
  };
  const { limits, ...suggested } = suggestFeeds(flat, "aluminium6061", machine);
  expect(suggested).toEqual(expected);
  const rounded = {
    rpm: Math.round(rpm),
    cutFeed: Math.round(cutFeed),
    plungeFeed: Math.round(plungeFeed),
    rampFeed: Math.round(plungeFeed),
    stepdown: flat.diameter,
    stepoverFraction: 1,
  };
  const applied = limits.map((l) => l.reason).join("; ");
  const hint = `Suggested for Aluminium 6061 on ${machine.name}${applied && `: ${applied}`}.`;
  return { expected, rounded, hint };
}

async function suggestAluminium(panel: Element) {
  await click(panel, "New preset for 6 mm flat");
  await choose(panel, "Material", "aluminium6061");
  await click(panel, "Suggest");
}

const shown = (panel: Element) => ({
  rpm: value(panel, "Spindle speed (rpm)"),
  cutFeed: value(panel, "Cut feed (mm/min)"),
  plungeFeed: value(panel, "Plunge feed (mm/min)"),
  rampFeed: value(panel, "Ramp feed (mm/min)"),
  stepdown: value(panel, "Stepdown (mm)"),
  stepoverFraction: value(panel, "Stepover (fraction of diameter)"),
});

const asText = (values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));

it("Suggest for 6061 aluminium with a 6 mm flat end mill fills suggestFeeds clamped to the machine", async () => {
  const { expected, rounded, hint } = aluminium(shop);
  expect(expected).toEqual({
    rpm: 12000,
    cutFeed: 1500,
    plungeFeed: 500,
    stepdown: 6,
    stepoverFraction: 1,
  });

  const panel = await openTools();
  await suggestAluminium(panel);
  expect(shown(panel)).toEqual(asText(rounded));
  expect(hintText(panel)).toContain(hint);
  await click(panel, "OK");
  expect(presetPuts[0]!.data[1]).toMatchObject({
    ...rounded,
    toolId: flat.id,
  });
});

it("Suggest on the default router fills whole rpm and feeds", async () => {
  machines = [router];
  const { expected, rounded } = aluminium(router);
  expect(expected.rpm).toBeCloseTo(9702.085, 3);
  expect(rounded).toMatchObject({ rpm: 9702, cutFeed: 1479, plungeFeed: 739 });

  const panel = await openTools();
  await suggestAluminium(panel);
  expect(shown(panel)).toEqual(asText(rounded));
  await click(panel, "OK");
  expect(presetPuts[0]!.data[1]).toMatchObject(rounded);
});

it("the Suggested hint clears once the material or a suggested value changes", async () => {
  const { hint } = aluminium(shop);
  const panel = await openTools();
  await suggestAluminium(panel);
  expect(hintText(panel)).toContain(hint);
  await type(panel, "Cut feed (mm/min)", "1400");
  expect(hintText(panel)).not.toContain(hint);

  await click(panel, "Suggest");
  expect(hintText(panel)).toContain(hint);
  await choose(panel, "Material", "mdf");
  expect(hintText(panel)).not.toContain(hint);
});

it("an out-of-range rpm refuses with the machine limit", async () => {
  presets = {
    data: [{ ...legacy, id: "mine", name: "Mine", toolId: flat.id }],
    etag: "p0",
  };
  const panel = await openTools();
  await click(panel, "Edit Mine");
  await type(panel, "Spindle speed (rpm)", "30000");
  expect(button(panel, "OK").disabled).toBe(true);
  expect(hintText(panel)).toContain(
    "Fix before saving: rpm must be within Shop's spindle range, 12000 to 24000 rpm.",
  );
  await type(panel, "Spindle speed (rpm)", "11000");
  expect(button(panel, "OK").disabled).toBe(true);
  await type(panel, "Spindle speed (rpm)", "20000");
  expect(button(panel, "OK").disabled).toBe(false);
  await click(panel, "OK");
  expect(presetPuts[0]!.data).toEqual([{ ...presets.data[0], rpm: 20000 }]);
});

const slowMill: MachineProfile = {
  ...shop,
  name: "Machine 1",
  rpmMin: 1500,
  rpmMax: 7600,
};

const bull: Tool = {
  ...flat,
  id: "lib-bull",
  name: "Tool 2",
  kind: "bull",
  cornerRadius: 0.5,
};

const FIX = "Fix before saving";

it("a new preset for a bull nose on a 1500 to 7600 rpm machine opens inside its range, and Suggest covers it", async () => {
  machines = [slowMill];
  tools = { data: [bull], etag: "t0" };
  const panel = await openTools();
  await click(panel, "New preset for Tool 2");
  const rpm = Number(value(panel, "Spindle speed (rpm)"));
  expect(rpm).toBeGreaterThanOrEqual(1500);
  expect(rpm).toBeLessThanOrEqual(7600);
  const { limits, ...suggested } = suggestFeeds(
    bull,
    "aluminium6061",
    slowMill,
  );
  expect(limits.map((l) => l.limit)).toContain("rpmMax");
  expect(rpm).toBe(Math.round(suggested.rpm));
  expect(value(panel, "Cut feed (mm/min)")).toBe(
    String(Math.round(suggested.cutFeed)),
  );
  expect(hintText(panel).join(" ")).not.toContain(FIX);
  expect(button(panel, "OK").disabled).toBe(false);

  await click(panel, "Suggest");
  expect(panel.textContent).not.toContain("Suggest refused");
  expect(hintText(panel).join(" ")).toContain(
    "Suggested for Aluminium 6061 on Machine 1",
  );
  await click(panel, "OK");
  expect(presetPuts[0]!.data[1]).toMatchObject({
    toolId: bull.id,
    rpm: Math.round(suggested.rpm),
  });
});

it("a new preset for a tool Suggest refuses opens from the defaults clamped into the machine", async () => {
  machines = [{ ...slowMill, maxFeedX: 800, maxFeedZ: 200 }];
  const vbit: Tool = {
    ...flat,
    id: "lib-v",
    name: "V",
    kind: "vbit",
    tipAngle: 60,
  };
  tools = { data: [vbit], etag: "t0" };
  const panel = await openTools();
  await click(panel, "New preset for V");
  expect(shown(panel)).toEqual({
    rpm: "7600",
    cutFeed: "800",
    plungeFeed: "200",
    rampFeed: "200",
    stepdown: "1",
    stepoverFraction: "0.4",
  });
  expect(hintText(panel).join(" ")).not.toContain(FIX);
  await click(panel, "Suggest");
  expect(panel.textContent).toContain(
    "Suggest refused: the feed charts cover flat, bull nose and ball nose end mills, not a V-bit.",
  );
});

it("with one machine and no default setting, Suggest uses that machine", async () => {
  await mountSettings({
    values: { "plugin.rockett.cam.defaultMachine": null },
    patches: [],
  });
  const { rounded, hint } = aluminium(shop);
  const panel = await openTools();
  await suggestAluminium(panel);
  expect(shown(panel)).toEqual(asText(rounded));
  expect(hintText(panel)).toContain(hint);
  await type(panel, "Spindle speed (rpm)", "30000");
  expect(button(panel, "OK").disabled).toBe(true);
});

it("with no machines Suggest says so and the rpm goes unchecked", async () => {
  machines = [];
  const panel = await openTools();
  await click(panel, "New preset for 6 mm flat");
  expect(button(panel, "Suggest").disabled).toBe(true);
  expect(hintText(panel)).toContain(
    "No machines yet, so Suggest is off and rpm is not checked. Add a mill on the Machines page.",
  );
  await type(panel, "Spindle speed (rpm)", "30000");
  expect(button(panel, "OK").disabled).toBe(false);
});

it("a preset whose tool was deleted says why no operation offers it", async () => {
  presets = {
    data: [{ ...legacy, id: "gone", name: "Gone", toolId: "deleted" }],
    etag: "p0",
  };
  const panel = await openTools();
  expect(names(panel.querySelector('[aria-label="Other presets"]')!)).toEqual([
    "Gone",
  ]);
  await click(panel, "Edit Gone");
  expect(hintText(panel)).toContain(
    "Its tool was deleted, so no operation offers this preset. Link it to a tool or to Any tool.",
  );
  await choose(panel, "Tool", "");
  expect(hintText(panel)).not.toContain(
    "Its tool was deleted, so no operation offers this preset. Link it to a tool or to Any tool.",
  );
  await click(panel, "OK");
  expect(presetPuts[0]!.data).toEqual([
    { ...legacy, id: "gone", name: "Gone" },
  ]);
});

it("imported presets list under their tool and a later edit saves with the import's etag", async () => {
  tools = { data: [], etag: "t0" };
  presets = { data: [], etag: "p0" };
  const linked = { ...legacy, id: "imp", name: "Imported", toolId: flat.id };
  const text = JSON.stringify({
    format: "rockett-tools",
    version: 1,
    tools: [flat],
    presets: [linked],
  });
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    Object.defineProperty(this, "files", {
      value: [new File([text], "rockett-tools.json")],
    });
    this.dispatchEvent(new Event("change"));
  });
  const panel = await openTools();
  await click(panel, "Import tools");
  await click(panel, "Import");
  expect(presetPuts).toEqual([{ data: [linked], etag: "p0" }]);
  expect(names(toolGroup(panel, "6 mm flat"))).toEqual(["Imported"]);

  await click(panel, "Edit Imported");
  await type(panel, "Name", "Imported rough");
  await click(panel, "OK");
  expect(presetPuts[1]).toEqual({
    data: [{ ...linked, name: "Imported rough" }],
    etag: "p0+",
  });
});

it("Export and Import read presets another session saved after the page opened", async () => {
  const panel = await openTools();
  const elsewhere = { ...legacy, id: "tab", name: "Saved elsewhere" };
  presets = { data: [legacy, elsewhere], etag: "p1" };

  const blobs: Blob[] = [];
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => `blob:${blobs.push(blob)}`,
    revokeObjectURL: () => {},
  });
  const save = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  await click(panel, "Export tools");
  expect((save.mock.contexts[0] as HTMLAnchorElement).download).toBe(
    TOOLS_FILE,
  );
  expect(JSON.parse(await blobs[0]!.text()).presets).toEqual([
    legacy,
    elsewhere,
  ]);

  presets = { data: [legacy, elsewhere], etag: "p2" };
  const incoming = { ...legacy, id: "imp", name: "Imported" };
  const text = JSON.stringify({
    format: "rockett-tools",
    version: 1,
    tools: [],
    presets: [incoming],
  });
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement,
  ) {
    Object.defineProperty(this, "files", {
      value: [new File([text], "rockett-tools.json")],
    });
    this.dispatchEvent(new Event("change"));
  });
  await click(panel, "Import tools");
  presets = { data: [legacy, elsewhere], etag: "p3" };
  await click(panel, "Import");
  expect(presetPuts).toEqual([
    { data: [legacy, elsewhere, incoming], etag: "p3" },
  ]);
  expect(names(panel.querySelector('[aria-label="Other presets"]')!)).toEqual([
    "Any tool rough",
    "Saved elsewhere",
    "Imported",
  ]);
});
