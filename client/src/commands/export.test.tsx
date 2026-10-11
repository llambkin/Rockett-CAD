import { act } from "react";
import { createRoot } from "react-dom/client";
import { ModelTree } from "../components/ModelTree";
import { Timeline } from "../components/Timeline";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, emptyView } from "@rockett/shared";
import { api, saveDownload } from "../api";
import { runCommand } from "./registry";
import { useStore } from "../store";
import { sceneViewport } from "../../test/helpers/boxScene";
import {
  box,
  mountScene,
  pointer,
  result,
  sizeViewport,
  unmountScene,
  wait,
} from "../../test/helpers/boxScene";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
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
  saveDownload: vi.fn(),
  api: {
    formats: vi.fn(async () => ({
      importers: [],
      exporters: [
        {
          format: "stl",
          label: "STL",
          ext: "stl",
          mime: "model/stl",
          source: "bodies",
        },
      ],
    })),
    exportModel: vi.fn(),
    putView: vi.fn(async (_id: string, view: unknown) => view),
  },
}));

const initial = useStore.getState();
let restoreSize: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  restoreSize = sizeViewport();
  vi.clearAllMocks();
});
afterEach(async () => {
  await unmountScene();
  restoreSize();
  useStore.setState(initial, true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("clicks one visible body through the viewport and exports only that body", async () => {
  const second = box("second");
  second.bodyId = "b2";
  second.positions = second.positions.map((v, i) => (i % 3 === 0 ? v + 20 : v));
  second.edges = [];
  second.bbox = { min: [20, 0, 0], max: [30, 10, 10] };
  const doc = createEmptyDocument("export", "Export");
  const host = await mountScene({
    document: doc,
    projectId: doc.id,
    evaluation: result([box("first"), second]),
    view: emptyView(),
    active: null,
    selection: [],
  });
  await act(async () => {
    runCommand("design.export");
  });
  await wait(0);
  sceneViewport().setView([0, 0, 1], [0, 1, 0]);
  sceneViewport().zoomToFit();
  await wait(0);
  await act(async () => {
    pointer("pointermove", new THREE.Vector3(5, 5, 10));
    pointer("pointerdown", new THREE.Vector3(5, 5, 10));
    pointer("pointerup", new THREE.Vector3(5, 5, 10));
  });
  expect(useStore.getState().selection).toEqual([
    { kind: "body", bodyId: "b1" },
  ]);
  vi.mocked(api.exportModel).mockRejectedValue(new Error("stopped"));
  const download = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Download",
  )!;
  await act(async () => download.click());
  expect(api.exportModel).toHaveBeenCalledWith(doc.id, {
    format: "stl",
    bodyIds: ["b1"],
    quality: 0.05,
  });
});

it.each(
  (["feature", "exit", "project", "reopen"] as const).flatMap((change) =>
    [false, true].map((failure) => ({ change, failure })),
  ),
)(
  "isolates earlier export outcome failure=$failure after $change",
  async ({ change, failure }) => {
    const doc = createEmptyDocument("export", "Export");
    const host = await mountScene({
      document: doc,
      projectId: doc.id,
      evaluation: result([box("first")]),
      view: emptyView(),
      active: null,
      selection: [],
    });
    let resolve!: (value: Awaited<ReturnType<typeof api.exportModel>>) => void;
    let reject!: (error: Error) => void;
    vi.mocked(api.exportModel).mockImplementation(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    await act(async () => {
      runCommand("design.export");
    });
    await wait(0);
    const download = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Download",
    )!;
    await act(async () => download.click());
    await act(async () => {
      if (change === "feature") runCommand("design.chamfer");
      if (change === "exit") runCommand("design.cancel");
      if (change === "project")
        useStore.setState({
          projectId: "other",
          document: createEmptyDocument("other", "Other"),
          active: null,
        });
      if (change === "reopen") runCommand("design.export");
      useStore.setState({ error: "current error" });
    });
    const current = useStore.getState();
    const saved = vi.mocked(saveDownload).mock.calls.length;
    await act(async () => {
      if (failure) reject(new Error("obsolete failure"));
      else resolve({ blob: new Blob(["mesh"]), fileName: "part.stl" });
    });
    expect(useStore.getState().active).toBe(current.active);
    expect(useStore.getState().error).toBe("current error");
    expect(saveDownload).toHaveBeenCalledTimes(saved + (failure ? 0 : 1));
    await unmountScene();
  },
);

it.each(["tree", "timeline"] as const)(
  "accumulates body picks through %s and restores preselection on Cancel",
  async (surface) => {
    const doc = createEmptyDocument("export", "Export");
    doc.features = ["first", "second"].map((id) => ({
      id,
      name: id,
      type: "shell",
      suppressed: false,
      openFaces: [],
      direction: "inside",
      thickness: 1,
    }));
    doc.timelinePosition = 2;
    const second = box("second");
    second.bodyId = "b2";
    second.name = "Body2";
    const evaluation = result([box("first"), second]);
    evaluation.featureStatuses = [
      { featureId: "first", status: "ok", targets: ["b1"] },
      { featureId: "second", status: "ok", targets: ["b2"] },
    ];
    const before = [{ kind: "edge" as const, bodyId: "b1", edgeName: "x00" }];
    useStore.setState({
      document: doc,
      projectId: doc.id,
      evaluation,
      view: emptyView(),
      active: null,
      selection: before,
    });
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(surface === "tree" ? <ModelTree /> : <Timeline />);
        await runCommand("design.export");
      });
      const choices =
        surface === "tree"
          ? [...host.querySelectorAll<HTMLElement>(".tree-item")].filter((el) =>
              /Body[12]$/.test(el.textContent?.trim() ?? ""),
            )
          : [...host.querySelectorAll<HTMLElement>(".tl-chip")];
      expect(choices).toHaveLength(2);
      for (const choice of choices)
        await act(async () => {
          choice.click();
        });
      expect(useStore.getState().selection).toEqual([
        { kind: "body", bodyId: "b1" },
        { kind: "body", bodyId: "b2" },
      ]);
      await act(async () => {
        await runCommand("design.cancel");
      });
      expect(useStore.getState().selection).toEqual(before);
      expect(useStore.getState().active).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it("refuses body picks and Escape while busy, then restores preselection on Cancel", async () => {
  const before = [{ kind: "edge" as const, bodyId: "b1", edgeName: "e1" }];
  useStore.setState({
    active: null,
    selection: before,
  });
  await runCommand("design.export");
  const owner = useStore.getState().active;
  useStore.setState({ busy: true });
  const command = (await import("./active")).activeCommand()!;
  await command.onClick(
    { kind: "body", bodyId: "b1" },
    { shiftKey: false, ctrlKey: false, metaKey: false },
  );
  command.onSelection?.([{ kind: "body", bodyId: "b2" }], false);
  await runCommand("design.cancel");
  expect(useStore.getState().active).toBe(owner);
  expect(useStore.getState().selection).toEqual([]);
  useStore.setState({ busy: false });
  await runCommand("design.cancel");
  expect(useStore.getState().active).toBeNull();
  expect(useStore.getState().selection).toEqual(before);
});

it.each([
  { selected: false, hidden: [], expected: ["b1", "b2"] },
  { selected: false, hidden: ["b2"], expected: ["b1"] },
  { selected: true, hidden: ["b2"], expected: ["b2"] },
])(
  "exports selected=$selected hidden=$hidden through the shared body policy",
  async ({ selected, hidden, expected }) => {
    const document = createEmptyDocument("export", "Export");
    const second = box("second");
    second.bodyId = "b2";
    const view = emptyView();
    view.hidden.bodies = hidden;
    const host = await mountScene({
      document,
      projectId: document.id,
      evaluation: result([box("first"), second]),
      view,
      active: null,
      selection: selected ? [{ kind: "body", bodyId: "b2" }] : [],
    });
    await act(async () => {
      await runCommand("design.export");
    });
    await wait(0);
    vi.mocked(api.exportModel).mockRejectedValue(new Error("stopped"));
    const download = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Download",
    )!;
    await act(async () => download.click());
    expect(api.exportModel).toHaveBeenCalledWith(document.id, {
      format: "stl",
      bodyIds: expected,
      quality: 0.05,
    });
  },
);
