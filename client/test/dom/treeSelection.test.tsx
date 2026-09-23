import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, type Feature } from "@rockett/shared";
import { api } from "../../src/api";
import { ModelTree } from "../../src/components/ModelTree";
import { useStore } from "../../src/store";

vi.mock("../../src/api", () => ({
  api: {
    updateBody: vi.fn(),
    deleteFeature: vi.fn(),
    updateFeature: vi.fn(),
  },
}));

const sketch = (id: string, name: string) =>
  ({
    id,
    type: "sketch",
    name,
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [],
    constraints: [],
  }) as unknown as Feature;

const body = (n: number) => ({
  bodyId: `b${n}`,
  name: `Body${n}`,
  visible: true,
});

let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  const doc = createEmptyDocument("p1", "Part");
  doc.features = [
    sketch("s1", "Sketch1"),
    sketch("s2", "Sketch2"),
    sketch("s3", "Sketch3"),
  ];
  doc.timelinePosition = 3;
  const evaluation = {
    bodies: [body(1), body(2), body(3)],
    planes: [],
    kernelMs: 0,
    featureStatuses: [],
    sketches: [{ featureId: "s1", profiles: [{ id: "r1" }] }],
  } as any;
  const response = { document: doc, evaluation };
  vi.mocked(api.updateBody).mockResolvedValue(response);
  vi.mocked(api.deleteFeature).mockResolvedValue(response);
  vi.mocked(api.updateFeature).mockResolvedValue(response);
  useStore.setState({
    projectId: "p1",
    document: doc,
    evaluation,
    mode: { name: "idle" },
    selection: [],
    undoStack: [],
    busy: false,
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<ModelTree />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const row = (text: string) =>
  [...host.querySelectorAll(".tree-item")].find((el) =>
    el.textContent?.trim().endsWith(text),
  )!;

async function click(text: string, mods: MouseEventInit = {}) {
  await act(async () => {
    row(text).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }),
    );
  });
}

async function rightClick(text: string) {
  await act(async () => {
    row(text).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
}

const labels = () =>
  [...host.querySelectorAll(".context-menu button")].map((b) => b.textContent);

async function choose(label: string) {
  const item = [...host.querySelectorAll(".context-menu button")].find(
    (b) => b.textContent === label,
  ) as HTMLElement;
  await act(async () => item.click());
}

const selection = () => useStore.getState().selection;

it("toggles bodies with Ctrl or Cmd+click", async () => {
  await click("Body1");
  await click("Body3", { ctrlKey: true });
  expect(selection()).toEqual([
    { kind: "body", bodyId: "b1" },
    { kind: "body", bodyId: "b3" },
  ]);
  expect(row("Body3").classList.contains("selected")).toBe(true);
  await click("Body1", { metaKey: true });
  expect(selection()).toEqual([{ kind: "body", bodyId: "b3" }]);
  expect(row("Body1").classList.contains("selected")).toBe(false);
});

it("keeps a plain sketch click on its regions and selects a range with Shift", async () => {
  await click("Sketch1");
  expect(selection()).toEqual([
    { kind: "profile", sketchId: "s1", profileId: "r1" },
  ]);
  expect(row("Sketch1").classList.contains("selected")).toBe(true);
  await click("Sketch2", { ctrlKey: true });
  expect(selection()).toEqual([
    { kind: "sketch", sketchId: "s1" },
    { kind: "sketch", sketchId: "s2" },
  ]);
  await click("Sketch3", { shiftKey: true });
  expect(selection()).toEqual([
    { kind: "sketch", sketchId: "s2" },
    { kind: "sketch", sketchId: "s3" },
  ]);
  await click("Sketch1", { shiftKey: true });
  expect(selection()).toEqual([
    { kind: "sketch", sketchId: "s1" },
    { kind: "sketch", sketchId: "s2" },
  ]);
});

it("replaces the selection when a click crosses sections", async () => {
  await click("Sketch1", { ctrlKey: true });
  await click("Sketch2", { ctrlKey: true });
  expect(selection()).toHaveLength(2);
  await click("Body2", { ctrlKey: true });
  expect(selection()).toEqual([{ kind: "body", bodyId: "b2" }]);
  await click("Sketch3", { shiftKey: true });
  expect(selection()).toEqual([{ kind: "sketch", sketchId: "s3" }]);
});

it("keeps additive picking across kinds while a dialog is open", async () => {
  useStore.setState({ mode: { name: "dialog", dialog: "mirror" } });
  await click("Body1", { ctrlKey: true });
  await click("XY Plane", { ctrlKey: true });
  expect(selection().map((s) => s.kind)).toEqual(["body", "plane"]);
});

it("acts on every selected body from the multi-selection menu in one undo step", async () => {
  await click("Body1");
  await click("Body2", { ctrlKey: true });
  await rightClick("Body1");
  expect(labels()).toEqual([
    "Move…",
    "Group",
    "Show / Hide",
    "Isolate",
    "Show all bodies",
  ]);
  await choose("Show / Hide");
  expect(vi.mocked(api.updateBody).mock.calls).toEqual([
    ["p1", "b1", { visible: false }],
    ["p1", "b2", { visible: false }],
  ]);
  expect(useStore.getState().undoStack).toHaveLength(1);

  await rightClick("Body3");
  expect(labels()).toContain("Rename");
});

it("deletes every selected sketch in one undo step", async () => {
  await click("Sketch1", { ctrlKey: true });
  await click("Sketch3", { ctrlKey: true });
  await rightClick("Sketch3");
  expect(labels()).toEqual(["Show / Hide", "Group", "Delete"]);
  await choose("Delete");
  expect(vi.mocked(api.deleteFeature).mock.calls).toEqual([
    ["p1", "s1"],
    ["p1", "s3"],
  ]);
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(selection()).toEqual([]);
});
