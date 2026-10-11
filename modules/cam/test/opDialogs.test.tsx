import { act } from "react";
import { expect, it } from "vitest";
import {
  CAM_EXTENSION,
  isCamData,
  type CamData,
} from "../src/shared/document.js";
import { contourParams, paramsOf, pocketParams } from "../src/shared/params.js";
import {
  fetchMock,
  FACE_NAME,
  field,
  fieldLabels,
  flat,
  flush,
  hints,
  library,
  mark,
  ok,
  open,
  panelTitled,
  preset,
  routes,
  saved,
  selectFace,
  sig,
  signed,
  STATUS,
  toolSelect,
  type,
  useStore,
} from "./helpers/camClient.js";

type Params = typeof contourParams | typeof pocketParams;

const titleOf = (property: unknown) => (property as { title?: string }).title;

const titles = (schema: Params) =>
  Object.values(schema.properties).flatMap((property) => {
    const title = titleOf(property);
    return title === undefined ? [] : [title];
  });

const untitled = (schema: Params) =>
  Object.entries(schema.properties).flatMap(([key, property]) =>
    titleOf(property) === undefined ? [key] : [],
  );

it("contour and pocket each open a dialog built from its schema", async () => {
  expect(untitled(contourParams)).toEqual(["opening"]);
  expect(untitled(pocketParams)).toEqual([]);
  for (const [label, command, schema, labels] of [
    [
      "Contour",
      "rockett.cam.contour",
      contourParams,
      ["Face", "Side", "Bottom offset (mm)"],
    ],
    ["Pocket", "rockett.cam.pocket", pocketParams, ["Floor", "Ramp angle (°)"]],
  ] as const) {
    expect(panelTitled(label)).toBeUndefined();
    const panel = await open(label, command);
    expect(titles(schema)).toEqual(labels.map((l) => l.split(" (")[0]));
    expect(fieldLabels(panel)).toEqual(["Setup", "Tool", "Preset", ...labels]);
    expect(
      [...toolSelect(panel).querySelectorAll("option")].map(
        (o) => o.textContent,
      ),
    ).toEqual(["6 mm flat"]);
    expect(field(panel, labels[0]).disabled).toBe(true);
    await act(async () =>
      [...panel.querySelectorAll("button")]
        .find((b) => b.textContent === "Cancel")!
        .click(),
    );
    expect(panelTitled(label)).toBeUndefined();
  }
});

it("adaptive and drill open dialogs built from their schemas", async () => {
  const adaptive = await open("Adaptive", "rockett.cam.adaptive");
  expect(fieldLabels(adaptive)).toEqual([
    "Setup",
    "Tool",
    "Preset",
    "Floor",
    "Ramp angle (°)",
    "Maximum engagement (°)",
  ]);
  const drill = await open("Drill", "rockett.cam.drill");
  expect(fieldLabels(drill)).toEqual(["Setup", "Preset", "Hole diameter (mm)"]);
  expect(hints(drill)).toContain("No tool in your library can cut a drill.");
});

it("with no face selected Save is blocked with text, and the face field takes the selection", async () => {
  const panel = await open("Contour", "rockett.cam.contour");
  expect(field(panel, "Face").value).toBe("");
  expect(hints(panel)).toEqual([
    "Enter a value",
    "Select a face in the viewport.",
  ]);
  expect(ok(panel).disabled).toBe(true);
  await act(async () => ok(panel).click());
  expect(signed).toEqual([]);

  await selectFace("f:plate:side:1");
  expect(field(panel, "Face").value).toBe("Plate f:plate:side:1");
  expect(hints(panel)).toEqual(["Enter a value"]);
  expect(ok(panel).disabled).toBe(true);
  await type(field(panel, "Bottom offset"), "0.5");
  expect(hints(panel)).toEqual([]);
  expect(ok(panel).disabled).toBe(false);

  await act(async () => useStore.setState({ selection: [] }));
  expect(field(panel, "Face").value).toBe("Plate f:plate:side:1");
});

it("with a face selected Save signs it and stores an operation that passes paramsOf", async () => {
  await selectFace(FACE_NAME);
  const panel = await open("Pocket", "rockett.cam.pocket");
  expect(field(panel, "Floor").value).toBe(`Plate ${FACE_NAME}`);
  await type(field(panel, "Ramp angle"), "3");
  const before = saved.revision;
  await act(async () => ok(panel).click());
  await flush();

  expect(signed).toEqual([
    [{ kind: "face", bodyId: "b1", faceName: FACE_NAME }],
  ]);
  const signCall = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("/sig"),
  )!;
  expect(String(signCall[0])).toContain(
    `/faces/${encodeURIComponent(FACE_NAME)}/sig`,
  );
  expect(saved.revision).toBe(before + 1);
  expect(panelTitled("Pocket")).toBeUndefined();
  const data = saved.extensions[CAM_EXTENSION]!.data as CamData;
  expect(isCamData(data)).toBe(true);
  const [tool] = data.tools;
  expect(tool).toEqual({
    ...flat,
    id: tool!.id,
    libraryRef: { id: flat.id },
    number: 1,
    presets: [preset],
  });
  expect(tool!.id).not.toBe(flat.id);
  const [setup] = data.setups;
  const [op] = setup!.operations!;
  expect(op).toMatchObject({
    type: "rockett.cam.pocket",
    name: "Pocket 1",
    toolId: tool!.id,
    presetId: preset.id,
  });
  expect(paramsOf(pocketParams, op!.type!, op!.params)).toEqual({
    floor: { kind: "face", bodyId: "b1", faceName: FACE_NAME, sig },
    rampAngle: 3,
  });

  const status = await routes.get(STATUS)!(
    saved,
    { params: { id: "p1", setupId: setup!.id } },
    { user: mark },
  );
  expect(status).toEqual({ [op!.id]: { status: "never" } });
});

it("states empty and error text for its lists", async () => {
  library.tools = null;
  library.presets = "fail";
  await selectFace("f:plate:side:1");
  const panel = await open("Contour", "rockett.cam.contour");
  expect(hints(panel)).toContain("No tool in your library can cut a contour.");
  expect(panel.querySelector(".error-banner")?.textContent).toBe(
    "Presets did not load: HTTP 500.",
  );
  expect(ok(panel).disabled).toBe(true);
});
