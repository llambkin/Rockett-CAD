import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type Feature,
} from "@rockett/shared";
import { Timeline } from "../../src/components/Timeline";
import { PREVIEW_DWELL_MS } from "../../src/livePreview";
import { useStore } from "../../src/store";
import { api } from "../../src/api";

vi.mock("../../src/api", () => ({
  api: {
    updateFeature: vi.fn(),
    replaceDocument: vi.fn(),
    evaluate: vi.fn(),
  },
}));

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;
const evaluation = {
  bodies: [],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
} as any;
const sketch = {
  id: "s1",
  type: "sketch",
  name: "Sketch1",
  suppressed: false,
  plane: { kind: "origin", plane: "XY" },
  entities: [],
  constraints: [],
} as unknown as Feature;
const fillet = {
  id: "fillet1",
  type: "fillet",
  name: "Fillet1",
  suppressed: false,
  edges: [{ kind: "edge", bodyId: "b1", edgeName: "e1" }],
  radius: 2,
  tangentChain: false,
} as Feature;

let original: CadDocument;
let server: CadDocument;
let root: Root;
let host: HTMLElement;
let select: ReturnType<typeof vi.spyOn>;

const reply = async () => ({ document: structuredClone(server), evaluation });

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  original = createEmptyDocument("proj", "doc");
  original.features = [sketch, fillet];
  original.timelinePosition = 2;
  server = structuredClone(original);
  vi.mocked(api.updateFeature).mockImplementation(async (_id, fid, patch) => {
    server.features = server.features.map((f) =>
      f.id === fid ? ({ ...f, ...patch } as Feature) : f,
    );
    return reply();
  });
  vi.mocked(api.replaceDocument).mockImplementation(async (_id, document) => {
    server = structuredClone(document);
    return reply();
  });
  useStore.setState({
    projectId: original.id,
    document: structuredClone(original),
    evaluation,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    selection: [],
    dialogParams: {},
    mode: { name: "idle" },
  });
  select = vi.spyOn(HTMLInputElement.prototype, "select");
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<Timeline />));
});

afterEach(async () => {
  select.mockRestore();
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const chip = (name: string) =>
  [...host.querySelectorAll(".tl-chip")].find((c) =>
    c.textContent?.includes(name),
  )!;
const menuLabels = () =>
  [...document.querySelectorAll(".context-menu button")].map(
    (b) => b.textContent,
  );

async function rightClick(el: Element) {
  await act(async () => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 500,
      }),
    );
  });
}

async function quickEdit(name: string) {
  await rightClick(chip(name));
  const item = [...document.querySelectorAll(".context-menu button")].find(
    (b) => b.textContent === "Quick edit",
  ) as HTMLButtonElement;
  await act(async () => item.click());
  await wait(0);
}

const field = (label: string) =>
  [...document.querySelectorAll(".dim-edit label.field")]
    .find((l) => l.querySelector("span")?.textContent === label)!
    .querySelector("input")!;

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

it("opens with the main value focused and selected", async () => {
  await quickEdit("Fillet1");
  const radius = field("Radius (mm)");
  expect(radius.value).toBe("2");
  expect(document.activeElement).toBe(radius);
  expect(select.mock.contexts).toEqual([radius]);
});

it("sends one preview carrying the last of five keystrokes inside the dwell", async () => {
  await quickEdit("Fillet1");
  const radius = field("Radius (mm)");
  for (const value of ["3", "3.", "3.5", "3.52", "3.525"]) {
    await type(radius, value);
    await wait(PREVIEW_DWELL_MS / 5);
  }
  expect(api.updateFeature).not.toHaveBeenCalled();
  await wait(PREVIEW_DWELL_MS);
  expect(vi.mocked(api.updateFeature).mock.calls).toEqual([
    ["proj", "fillet1", { radius: 3.525 }],
  ]);
  expect(useStore.getState().undoStack).toEqual([]);
});

it("commits on Enter as one undo entry that undoes to the original", async () => {
  await quickEdit("Fillet1");
  const radius = field("Radius (mm)");
  await type(radius, "4");
  await wait(PREVIEW_DWELL_MS);
  await type(radius, "5");
  await press(radius, "Enter");
  await wait(0);
  const s = useStore.getState();
  expect(document.querySelector(".dim-edit")).toBeNull();
  expect((s.document!.features[1] as any).radius).toBe(5);
  expect(s.undoStack).toEqual([original]);
  expect(s.previewBaseline).toBeNull();
});

it("restores the original document on Escape", async () => {
  await quickEdit("Fillet1");
  const radius = field("Radius (mm)");
  await type(radius, "4");
  await wait(PREVIEW_DWELL_MS);
  expect((useStore.getState().document!.features[1] as any).radius).toBe(4);
  await press(radius, "Escape");
  await wait(0);
  expect(document.querySelector(".dim-edit")).toBeNull();
  expect(useStore.getState().document).toEqual(original);
  expect(server).toEqual(original);
  expect(useStore.getState().undoStack).toEqual([]);
});

it("restores the original document on a pointer down outside", async () => {
  await quickEdit("Fillet1");
  await type(field("Radius (mm)"), "4");
  await wait(PREVIEW_DWELL_MS);
  await act(async () => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  await wait(0);
  expect(document.querySelector(".dim-edit")).toBeNull();
  expect(useStore.getState().document).toEqual(original);
});

it("offers no quick edit for a sketch or while a dialog is open", async () => {
  await rightClick(chip("Sketch1"));
  expect(menuLabels()).not.toContain("Quick edit");
  await act(async () => {
    useStore.setState({ mode: { name: "dialog", dialog: "extrude" } });
  });
  await rightClick(chip("Fillet1"));
  expect(menuLabels()).not.toContain("Quick edit");
});

it("edits one of several main values and keeps the others", async () => {
  const move = {
    id: "move1",
    type: "move",
    name: "Move1",
    suppressed: false,
    bodies: ["b1"],
    translation: [1, 2, 3],
  } as Feature;
  original.features.push(move);
  server = structuredClone(original);
  await act(async () => {
    useStore.setState({ document: structuredClone(original) });
  });
  await quickEdit("Move1");
  expect(document.activeElement).toBe(field("X (mm)"));
  await type(field("Y (mm)"), "7");
  await press(field("Y (mm)"), "Enter");
  await wait(0);
  expect(vi.mocked(api.updateFeature).mock.calls).toEqual([
    ["proj", "move1", { translation: [1, 7, 3] }, undefined],
  ]);
});
