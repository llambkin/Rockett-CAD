import "../features/core";
import { featureCommand } from "./featureCommand";
import "./design";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { activeCommand, exitActive } from "./active";
import { runCommand } from "./registry";
import { useStore, type Selection } from "../store";
import { sketchState } from "./sketch";
import { meshedBody } from "../../test/helpers/meshedBody";

const initial = useStore.getState();
const plane: Selection = {
  kind: "plane",
  ref: { kind: "origin", plane: "XY" },
  label: "XY Plane",
};
const face: Selection = { kind: "face", bodyId: "body", faceName: "flat" };
const curved: Selection = { kind: "face", bodyId: "body", faceName: "round" };
const event = new Event("pointerdown") as PointerEvent;
const start = vi.fn(async () => {});

beforeEach(() => {
  start.mockReset();
  useStore.setState(
    {
      ...initial,
      selection: [],
      active: null,
      startSketchOnPlane: start,
      evaluation: {
        kernelMs: 0,
        bodies: [
          meshedBody({
            bodyId: "body",
            name: "Body",
            meshKey: "body",
            faces: [
              {
                name: "flat",
                start: 0,
                count: 0,
                area: 1,
                surface: {
                  type: "plane",
                  origin: [0, 0, 0],
                  normal: [0, 0, 1],
                },
              },
              {
                name: "round",
                start: 0,
                count: 0,
                area: 1,
                surface: {
                  type: "cylinder",
                  origin: [0, 0, 0],
                  axis: [0, 0, 1],
                  radius: 1,
                },
              },
            ],
          }),
        ],
        planes: [],
        sketches: [],
        featureStatuses: [],
      },
    },
    true,
  );
});
afterEach(() => {
  exitActive();
  useStore.setState(initial, true);
  vi.restoreAllMocks();
});

it("owns plane picking through the registered active command", async () => {
  await runCommand("design.sketch.create");
  expect(useStore.getState().active?.id).toBe("design.sketch.create");
  expect(activeCommand()?.pickFilter()).toEqual([
    "design.originPlane",
    "design.constructionPlane",
    "design.face",
  ]);
  expect(activeCommand()?.hint).toBe(
    "Select a plane or planar face to sketch on",
  );
  expect(activeCommand()?.banner).toBe(
    "Select a plane or planar face for the sketch (Escape to cancel)",
  );
  expect(start).not.toHaveBeenCalled();
});

for (const selection of [plane, face]) {
  it(`accepts ${selection.kind} hover and starts on its unchanged support`, async () => {
    await runCommand("design.sketch.create");
    const command = activeCommand()!;
    expect(command.onHover(selection, event)).toBe(selection);
    await command.onClick(selection, event);
    expect(start).toHaveBeenCalledExactlyOnceWith(
      selection.kind === "plane"
        ? selection.ref
        : { kind: "face", face: selection },
    );
    expect(useStore.getState().active).toBeNull();
  });
  it(`starts directly from a preselected ${selection.kind}`, async () => {
    useStore.setState({ selection: [selection] });
    await runCommand("design.sketch.create");
    expect(start).toHaveBeenCalledExactlyOnceWith(
      selection.kind === "plane"
        ? selection.ref
        : { kind: "face", face: selection },
    );
    expect(useStore.getState().active).toBeNull();
  });
}

it("rejects cylindrical, missing and unsupported picks without leaving the command", async () => {
  await runCommand("design.sketch.create");
  const command = activeCommand()!;
  for (const selection of [
    curved,
    { kind: "face", bodyId: "body", faceName: "missing" },
    { kind: "body", bodyId: "body" },
    null,
  ] satisfies (Selection | null)[]) {
    expect(command.onHover(selection, event)).toBeNull();
    await command.onClick(selection, event);
  }
  expect(start).not.toHaveBeenCalled();
  expect(activeCommand()).toBe(command);
});

it("Escape removes hover and command ownership while preserving selection", async () => {
  await runCommand("design.sketch.create");
  useStore.setState({ selection: [curved], hover: plane });
  runCommand("design.cancel");
  expect(useStore.getState()).toMatchObject({
    active: null,
    hover: null,
    selection: [curved],
  });
});

it("refuses clicks after exit or while a job is busy", async () => {
  await runCommand("design.sketch.create");
  const command = activeCommand()!;
  useStore.setState({ busy: true });
  await command.onClick(plane, event);
  useStore.setState({ busy: false });
  exitActive();
  await command.onClick(plane, event);
  expect(start).not.toHaveBeenCalled();
});

it("releases plane picking when a different mode takes ownership", async () => {
  await runCommand("design.sketch.create");
  featureCommand.enter("extrude");
  expect(useStore.getState().active?.id).toBe("design.feature");
});

it("hands ownership to sketch editing after the existing starter changes mode", async () => {
  start.mockImplementationOnce(async () => {
    useStore.setState({
      active: {
        id: "design.sketch",
        state: sketchState("sketch", "line"),
      },
    });
  });
  await runCommand("design.sketch.create");
  await activeCommand()!.onClick(plane, event);
  expect(useStore.getState()).toMatchObject({
    active: {
      id: "design.sketch",
      state: { sketchId: "sketch", tool: "line", polygonSides: 6 },
    },
  });
});

it("keeps picking available when existing sketch creation rejects", async () => {
  start.mockRejectedValueOnce(new Error("Sketch creation refused"));
  await runCommand("design.sketch.create");
  await expect(activeCommand()!.onClick(plane, event)).rejects.toThrow(
    "Sketch creation refused",
  );
  expect(useStore.getState()).toMatchObject({
    active: { id: "design.sketch.create" },
  });
  await activeCommand()!.onClick(plane, event);
  expect(useStore.getState().active).toBeNull();
});
