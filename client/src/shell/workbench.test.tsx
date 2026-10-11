import "../commands/design";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type SketchFeature } from "@rockett/shared";
import { api } from "../api";
import { Toolbar } from "../components/Toolbar";
import { handleKey } from "../commands/keymap";
import { exitActive } from "../commands/active";
import {
  registerCommand,
  registerToolbarGroup,
  runCommand,
} from "../commands/registry";
import { useStore } from "../store";
import { WorkbenchSwitcher } from "./WorkbenchSwitcher";
import { registerWorkbench, switchWorkbench, useWorkbench } from "./workbench";
import { sketchState } from "../commands/sketch";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      ...actual.api,
      formats: vi.fn(async () => ({ importers: [], exporters: [] })),
    },
  };
});

const initial = useStore.getState();
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const disposers: Array<() => void> = [];
const synthetic = "fixture.workbench";
const keyRun = vi.fn();

beforeEach(() => {
  useStore.setState(initial, true);
  keyRun.mockReset();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  exitActive();
  useStore.setState(initial, true);
  await switchWorkbench("design");
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  host.remove();
});

function registerSecond() {
  disposers.push(
    registerWorkbench({
      id: synthetic,
      label: "Fixture",
      panels: [],
      selectionKinds: [],
    }),
  );
  disposers.push(
    registerToolbarGroup({
      id: "fixture.group",
      label: "FIXTURE",
      context: synthetic,
    }),
  );
  disposers.push(
    registerCommand({
      id: "fixture.command",
      label: "Fixture action",
      group: "fixture.group",
      icon: "fit",
      keys: ["Q"],
      keyContext: synthetic,
      run: keyRun,
    }),
  );
}

it("hides the existing select control with one workbench and reacts to registration", async () => {
  await act(async () => root.render(<WorkbenchSwitcher />));
  expect(host.querySelector("select")).toBeNull();
  await act(async () => registerSecond());
  expect(host.querySelector("select")?.className).toBe("tb-select");
  expect(
    [...host.querySelectorAll("option")].map((o) => o.textContent),
  ).toEqual(["Design", "Fixture"]);
});

it("switches the toolbar and key context, clears selection and exits the active command", async () => {
  registerSecond();
  await act(async () =>
    root.render(
      <>
        <WorkbenchSwitcher />
        <Toolbar />
      </>,
    ),
  );
  expect(host.textContent).toContain("CREATE");
  await act(async () => {
    await runCommand("design.sketch.create");
    useStore
      .getState()
      .setSelection([{ kind: "face", bodyId: "fixture", faceName: "face" }]);
  });
  expect(useStore.getState().active?.id).toBe("design.sketch.create");
  const select = host.querySelector("select")!;
  await act(async () => {
    select.value = synthetic;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(useStore.getState()).toMatchObject({
    active: null,
    selection: [],
    hover: null,
  });
  expect(useWorkbench.getState().current).toBe(synthetic);
  expect(host.textContent).toContain("FIXTURE");
  expect(host.textContent).not.toContain("CREATE");
  handleKey(new KeyboardEvent("keydown", { key: "q" }));
  expect(keyRun).toHaveBeenCalledOnce();
  const selection = [{ kind: "body" as const, bodyId: "fixture" }];
  await act(async () => {
    useStore.getState().setSelection(selection);
    handleKey(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(useStore.getState().selection).toEqual([]);
  expect(useStore.getState().document).toBe(initial.document);
});

const sketch: SketchFeature = {
  id: "sketch",
  type: "sketch",
  name: "Sketch",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [],
  constraints: [],
};
function openSketch() {
  const document = {
    ...createEmptyDocument("fixture", "Fixture"),
    features: [sketch],
    timelinePosition: 1,
  };
  useStore.setState({
    document,
    projectId: document.id,
    active: {
      id: "design.sketch",
      state: sketchState(sketch.id, "line"),
    },
    draftSketch: sketch,
  });
  return document;
}

it("finishes the open sketch through its evaluation owner before changing contexts", async () => {
  registerSecond();
  const document = openSketch();
  const finish: ((result: Awaited<ReturnType<typeof api.evaluate>>) => void)[] =
    [];
  const evaluation = {
    bodies: [],
    planes: [],
    sketches: [],
    featureStatuses: [],
    kernelMs: 0,
  };
  vi.spyOn(api, "evaluate").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      }),
  );
  const switching = switchWorkbench(synthetic);
  await Promise.resolve();
  expect(useWorkbench.getState().current).toBe("design");
  expect(useWorkbench.getState().switching).toBe(true);
  await switchWorkbench("design");
  finish[0]!(evaluation);
  await switching;
  expect(api.evaluate).toHaveBeenCalledExactlyOnceWith(document.id);
  expect(useStore.getState()).toMatchObject({
    draftSketch: null,
    selection: [],
    evaluation,
  });
  expect(useStore.getState().document).toBe(document);
  expect(useWorkbench.getState()).toMatchObject({
    current: synthetic,
    switching: false,
  });
  expect("workbench" in document).toBe(false);
});

it("keeps the sketch and workbench when finishing fails and refuses a busy switch", async () => {
  registerSecond();
  openSketch();
  vi.spyOn(api, "evaluate").mockRejectedValue(new Error("Evaluation refused"));
  await switchWorkbench(synthetic);
  expect(useWorkbench.getState()).toMatchObject({
    current: "design",
    switching: false,
  });
  expect(useStore.getState()).toMatchObject({
    active: { id: "design.sketch", state: { polygonSides: 6 } },
    draftSketch: sketch,
    error: "Evaluation refused",
  });
  useStore.setState({ busy: true });
  await switchWorkbench(synthetic);
  expect(api.evaluate).toHaveBeenCalledOnce();
  expect(useWorkbench.getState().current).toBe("design");
});

it("commits edited sketch geometry before the final evaluation and context change", async () => {
  registerSecond();
  const document = openSketch();
  const edited: SketchFeature = {
    ...sketch,
    entities: [{ id: "point", kind: "point", x: 4, y: 7 }],
  };
  useStore.setState({ draftSketch: edited });
  const saved = { ...document, features: [edited] };
  const evaluation = {
    bodies: [],
    planes: [],
    sketches: [],
    featureStatuses: [],
    kernelMs: 0,
  };
  vi.spyOn(api, "updateFeature").mockResolvedValue({
    document: saved,
    evaluation,
  });
  vi.spyOn(api, "evaluate").mockImplementation(async () => {
    expect(api.updateFeature).toHaveBeenCalledOnce();
    expect(useWorkbench.getState().current).toBe("design");
    expect(useStore.getState().document).toBe(saved);
    return evaluation;
  });
  await switchWorkbench(synthetic);
  expect(api.updateFeature).toHaveBeenCalledWith(
    document.id,
    sketch.id,
    { entities: edited.entities, constraints: [], offsets: undefined },
    1,
    expect.any(String),
  );
  expect(useStore.getState()).toMatchObject({
    document: saved,
    draftSketch: null,
    evaluation,
  });
  expect(useWorkbench.getState()).toMatchObject({
    current: synthetic,
    switching: false,
  });
});

it("rejects unknown registrations without changing selection or command state", async () => {
  const selection = [{ kind: "body" as const, bodyId: "fixture" }];
  useStore.getState().setSelection(selection);
  await runCommand("design.sketch.create");
  const state = useStore.getState();
  await expect(switchWorkbench("fixture.absent")).rejects.toThrow(
    "Unknown workbench: fixture.absent",
  );
  expect(useStore.getState()).toBe(state);
  expect(useWorkbench.getState()).toMatchObject({
    current: "design",
    switching: false,
  });
});

it.each(["target", "project"])(
  "does not transfer stale ownership when the %s changes while finishing",
  async (changed) => {
    registerSecond();
    openSketch();
    const finish: ((
      result: Awaited<ReturnType<typeof api.evaluate>>,
    ) => void)[] = [];
    const evaluation = {
      bodies: [],
      planes: [],
      sketches: [],
      featureStatuses: [],
      kernelMs: 0,
    };
    vi.spyOn(api, "evaluate").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish.push(resolve);
        }),
    );
    const switching = switchWorkbench(synthetic);
    await Promise.resolve();
    if (changed === "target") disposers[0]!();
    else
      useStore.setState({
        ...initial,
        projectId: "replacement",
        selection: [{ kind: "body", bodyId: "replacement" }],
      });
    finish[0]!(evaluation);
    await switching;
    expect(useWorkbench.getState()).toMatchObject({
      current: "design",
      switching: false,
    });
    if (changed === "project")
      expect(useStore.getState().selection).toEqual([
        { kind: "body", bodyId: "replacement" },
      ]);
  },
);
