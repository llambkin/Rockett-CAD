import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type SketchPayload } from "@rockett/shared";
import { Toolbar } from "../components/Toolbar";
import { HANDLE_VALUES } from "../three/featureHandles";
import { featureUI } from "./registry";
import { useStore } from "../store";
import {
  mountScene,
  result,
  sizeViewport,
  unmountScene,
} from "../../test/helpers/boxScene";
import "./core";

const initial = vi.hoisted(() => ({
  extrude: [] as number[],
  revolve: [] as number[],
}));
vi.mock("three", async (load) => ({
  ...(await load<typeof import("three")>()),
  WebGLRenderer: (await import("../../test/helpers/fakeRenderer"))
    .FakeWebGLRenderer,
}));
vi.mock("../three/ViewCube", () => ({
  ViewCube: class {
    dispose() {}
  },
}));
vi.mock("../api", () => ({
  watchUnauthorized: vi.fn(),
  api: {
    formats: vi.fn(async () => ({ importers: [], exporters: [] })),
    sizeLimit: vi.fn(() => new Promise(() => {})),
    evaluate: vi.fn(() => new Promise(() => {})),
  },
}));
vi.mock("../three/ExtrudeGizmo", async (load) => {
  const actual = await load<typeof import("../three/ExtrudeGizmo")>();
  return {
    ...actual,
    ExtrudeGizmo: class extends actual.ExtrudeGizmo {
      constructor(...args: ConstructorParameters<typeof actual.ExtrudeGizmo>) {
        super(...args);
        initial.extrude.push(args[2]);
      }
    },
  };
});
vi.mock("../three/RevolveGizmo", async (load) => {
  const actual = await load<typeof import("../three/RevolveGizmo")>();
  return {
    ...actual,
    RevolveGizmo: class extends actual.RevolveGizmo {
      constructor(...args: ConstructorParameters<typeof actual.RevolveGizmo>) {
        super(...args);
        initial.revolve.push(args[5]);
      }
    },
  };
});

const sketch: SketchPayload = {
  featureId: "s1",
  frame: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  },
  entities: [],
  solveStatus: "fully_constrained",
  dof: 0,
  profiles: [
    {
      id: "p1",
      outer: [],
      holes: [],
      polygon: [2, 2, 8, 2, 8, 8, 2, 8],
      holePolygons: [],
      area: 36,
    },
  ],
};
let toolbarRoot: Root | undefined;
let toolbarHost: HTMLElement | undefined;
let restoreSize: (() => void) | undefined;
const restores: Array<() => void> = [];

afterEach(async () => {
  await unmountScene();
  await act(async () => toolbarRoot?.unmount());
  toolbarHost?.remove();
  toolbarRoot = undefined;
  restoreSize?.();
  for (const restore of restores.splice(0)) restore();
  vi.useRealTimers();
});

it.each([
  ["extrude", "Extrude", "distance", 10, 13],
  ["revolve", "Revolve", "angle", 360, 270],
] as const)(
  "%s toolbar, form, build and specialised handle read HANDLE_VALUES",
  async (type, label, param, shipped, changed) => {
    const entry = HANDLE_VALUES[type];
    expect(entry).toMatchObject({ param, fallback: shipped });
    const descriptor = Object.getOwnPropertyDescriptor(entry, "fallback")!;
    Object.defineProperty(entry, "fallback", { ...descriptor, value: changed });
    restores.push(() => Object.defineProperty(entry, "fallback", descriptor));
    vi.useFakeTimers();
    restoreSize = sizeViewport();
    initial.extrude.length = initial.revolve.length = 0;
    await mountScene({
      projectId: "project",
      document: createEmptyDocument("project", "Model"),
      evaluation: result([], [sketch]),
      selection: [{ kind: "profile", sketchId: "s1", profileId: "p1" }],
      dialogParams: {},
      mode: { name: "idle" },
    });
    toolbarHost = document.body.appendChild(document.createElement("div"));
    toolbarRoot = createRoot(toolbarHost);
    await act(async () => toolbarRoot!.render(<Toolbar />));
    const button = toolbarHost.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    )!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(useStore.getState().mode).toEqual({ name: "dialog", dialog: type });
    expect(initial[type]).toContain(changed);
    const fieldLabel = [...document.querySelectorAll("label")].find((node) =>
      node.textContent?.includes(type === "extrude" ? "Distance" : "Angle"),
    )!;
    expect(fieldLabel.querySelector("input")?.value).toBe(String(changed));
    const state = useStore.getState();
    expect(
      featureUI(type)!.build!(state.dialogParams, state.selection),
    ).toMatchObject({ [param]: changed });
    await act(async () => state.setDialogParams({ [param]: 0 }));
    expect(
      featureUI(type)!.build!(
        useStore.getState().dialogParams,
        state.selection,
      ),
    ).toMatchObject(
      type === "extrude"
        ? { error: "Extrude distance must be non-zero" }
        : { angle: 0 },
    );
  },
);
