import { afterEach, expect, it } from "vitest";
import type { ExtensionFeature } from "@rockett/shared";
import { registerSelectionKind } from "../selection/kinds";
import {
  registerFeatureUI,
  type FeatureUI,
  type InputParams,
} from "../features/registry";
import { registerPickProvider } from "../three/pickProviders";
import { featureCommand } from "./featureCommand";
import { meshedBody } from "../../test/helpers/meshedBody";
import { activeCommand } from "./active";
import { runCommand } from "./registry";
import { useStore, type Selection } from "../store";
import "../features/core";
import "./design";

const edge: Selection = { kind: "edge", bodyId: "b1", edgeName: "e1" };
const body: Selection = { kind: "body", bodyId: "b1" };

afterEach(() => {
  useStore.getState().clearActive();
  useStore.setState({ selection: [], busy: false });
});

it("activates Chamfer through the registered feature command and restores preselection", async () => {
  useStore.setState({ selection: [edge, body] });
  await runCommand("design.chamfer");
  expect(useStore.getState().active).toEqual({
    id: "design.feature",
    state: {
      type: "chamfer",
      selectionBefore: [edge, body],
      inputs: expect.any(Object),
    },
  });
  expect(activeCommand()).toBeDefined();
  expect(useStore.getState().selection).toEqual([edge]);
  useStore.getState().cancelDialog();
  expect(useStore.getState().active).toBeNull();
  expect(useStore.getState().selection).toEqual([edge, body]);
});

const profile: Selection = { kind: "profile", sketchId: "sk", profileId: "r0" };
const secondProfile: Selection = {
  kind: "profile",
  sketchId: "sk",
  profileId: "r1",
};
const plane: Selection = {
  kind: "plane",
  ref: { kind: "origin", plane: "XY" },
  label: "XY Plane",
};
const face: Selection = { kind: "face", bodyId: "b1", faceName: "flat" };
const modifiers = { shiftKey: false, ctrlKey: false, metaKey: false };

it.each([
  ["extrude", profile, edge],
  ["revolve", profile, body],
  ["sweep", profile, body],
  ["loft", profile, edge],
  ["emboss", profile, face],
  ["fillet", edge, body],
  ["chamfer", edge, body],
  ["shell", face, edge],
  ["combine", body, profile],
  ["splitBody", body, edge],
  ["offsetFace", face, edge],
  ["move", body, profile],
  ["constructionPlane", plane, edge],
  ["mirror", body, profile],
  ["linearPattern", body, profile],
  ["circularPattern", body, profile],
  ["referenceImage", plane, edge],
] as const)(
  "%s accepts its input and rejects an unrelated kind through the active command",
  async (type, allowed, refused) => {
    useStore.setState({
      evaluation: {
        bodies: [
          meshedBody({
            bodyId: "b1",
            name: "Body",
            meshKey: "mesh",
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
            ],
          }),
        ],
        planes: [],
        sketches: [],
        featureStatuses: [],
        kernelMs: 0,
      },
    });
    await runCommand(`design.${type}`);
    const command = activeCommand()!;
    expect(useStore.getState().active?.id).toBe("design.feature");
    expect(command.onHover(refused, modifiers)).toBeNull();
    await command.onClick(refused, modifiers);
    expect(useStore.getState().selection).toEqual([]);
    expect(command.onHover(allowed, modifiers)).toEqual(allowed);
    await command.onClick(allowed, modifiers);
    expect(useStore.getState().selection).toEqual([allowed]);
  },
);

it("uses Shift for extrude face providers while retaining profile replacement and additive picks", async () => {
  await runCommand("design.extrude");
  const command = activeCommand()!;
  expect(command.pickFilter(modifiers)).toEqual(["sketch.profile"]);
  expect(command.pickFilter({ shiftKey: true })).toEqual(["design.face"]);
  expect(command.pickFilter()).toEqual(["design.face", "sketch.profile"]);
  await command.onClick(profile, modifiers);
  await command.onClick(secondProfile, modifiers);
  expect(useStore.getState().selection).toEqual([secondProfile]);
  await command.onClick(profile, { ...modifiers, ctrlKey: true });
  expect(useStore.getState().selection).toEqual([secondProfile, profile]);
  await command.onClick(profile, { ...modifiers, shiftKey: true });
  expect(useStore.getState().selection).toEqual([secondProfile]);
});

it("accumulates loft sections without a modifier and advances one-only inputs", async () => {
  await runCommand("design.loft");
  const loft = activeCommand()!;
  await loft.onClick(profile, modifiers);
  await loft.onClick(secondProfile, modifiers);
  expect(useStore.getState().selection).toEqual([profile, secondProfile]);
  await runCommand("design.splitBody");
  const split = activeCommand()!;
  await split.onClick(body, modifiers);
  expect(useStore.getState().pickInput).toBe("tool");
  expect(split.pickFilter()).toEqual([
    "design.face",
    "design.originPlane",
    "design.constructionPlane",
  ]);
});

it("preserves pre-open selection when a context action supplies different picks", () => {
  useStore.setState({ selection: [body] });
  featureCommand.enter("chamfer", { selection: [edge] });
  expect(useStore.getState().selection).toEqual([edge]);
  useStore.getState().cancelDialog();
  expect(useStore.getState().selection).toEqual([body]);
});

it("exports through a plain body-picking panel command and restores selection on cancel", async () => {
  useStore.setState({ selection: [edge, body] });
  await runCommand("design.export");
  expect(useStore.getState().active?.id).toBe("design.export");
  const command = activeCommand()!;
  expect(command.panel).toBe("design.export");
  expect(command.pickFilter()).toEqual(["design.body"]);
  expect(useStore.getState().selection).toEqual([body]);
  await command.onClick(edge, modifiers);
  expect(useStore.getState().selection).toEqual([body]);
  const other: Selection = { kind: "body", bodyId: "b2" };
  await command.onClick(other, modifiers);
  expect(useStore.getState().selection).toEqual([body, other]);
  command.exit();
  expect(useStore.getState().active).toBeNull();
  expect(useStore.getState().selection).toEqual([edge, body]);
});

it("runs a registered extension through the same provider and command owners", async () => {
  const pick = { kind: "test.node", nodeId: "n1" } satisfies Selection;
  const disposeKind = registerSelectionKind({
    kind: "test.node",
    key: () => "test.node:n1",
    toRef: () => pick,
    fromRef: () => pick,
    highlight() {},
  });
  const disposePick = registerPickProvider({
    id: "test.node",
    kind: "test.node",
    priority: 0,
    pick: () => [],
  });
  const ui: FeatureUI<ExtensionFeature, InputParams<Record<never, never>>> = {
    type: "test.feature",
    icon: "test",
    title: "Test",
    group: "test",
    picks: [{ key: "node", providers: ["test.node"] }],
    Form: () => null,
    initialParams: {},
    prefill: (f) => ({ params: f.params, selection: [] }),
    build: (params) => ({
      id: "test",
      name: "Test",
      suppressed: false,
      type: "test.feature",
      version: 1,
      params,
    }),
  };
  const disposeUI = registerFeatureUI(ui);
  try {
    featureCommand.enter("test.feature");
    expect(activeCommand()?.pickFilter()).toEqual(["test.node"]);
    await activeCommand()!.onClick(body, modifiers);
    expect(useStore.getState().selection).toEqual([]);
    await activeCommand()!.onClick(pick, modifiers);
    expect(useStore.getState().selection).toEqual([pick]);
  } finally {
    disposeUI();
    disposePick();
    disposeKind();
  }
});

it("leaves the current command and selection intact for an unregistered feature", () => {
  featureCommand.enter("chamfer");
  const before = useStore.getState();
  featureCommand.enter("test.absent");
  expect(useStore.getState().active).toBe(before.active);
  expect(useStore.getState().selection).toBe(before.selection);
});
