import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  nextFeatureName,
  type CadDocument,
  type Feature,
} from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { PREVIEW_DWELL_MS } from "../../src/livePreview";
import { useStore, type Selection } from "../../src/store";
import { api } from "../../src/api";

vi.mock("../../src/api", () => ({
  api: {
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    replaceDocument: vi.fn(),
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
const edge: Selection = { kind: "edge", bodyId: "b1", edgeName: "e1" };
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
let hold: Promise<void> | null;
let root: ReturnType<typeof createRoot> | null;
let host: HTMLElement;

const reply = async () => {
  await hold;
  return { document: structuredClone(server), evaluation };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  hold = null;
  original = createEmptyDocument("proj", "doc");
  server = structuredClone(original);
  vi.mocked(api.addFeature).mockImplementation(async (_id, feature) => {
    const added = structuredClone(feature);
    if (!added.name) added.name = nextFeatureName(server, added.type);
    server.features.push(added);
    return reply();
  });
  vi.mocked(api.updateFeature).mockImplementation(async (_id, fid, patch) => {
    if ((patch as any).radius > 100) throw new Error("Radius is too large");
    server.features = server.features.map((f) =>
      f.id === fid ? ({ ...f, ...patch } as Feature) : f,
    );
    return reply();
  });
  vi.mocked(api.replaceDocument).mockImplementation(async (_id, document) => {
    server = structuredClone(document);
    return reply();
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function open(
  selection: Selection[],
  editFeatureId?: string,
  params: Record<string, any> = {},
) {
  if (editFeatureId) {
    original.features = [fillet];
    server = structuredClone(original);
  }
  useStore.setState({
    projectId: original.id,
    document: structuredClone(original),
    evaluation,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    selection,
    dialogParams: params,
    mode: editFeatureId
      ? { name: "dialog", dialog: "fillet", editFeatureId }
      : { name: "dialog", dialog: "fillet" },
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<FeatureDialog />));
  await wait(0);
}

const radius = () =>
  [...host.querySelectorAll("label.field")]
    .find((l) => l.querySelector("span")?.textContent === "Radius (mm)")!
    .querySelector("input")!;

async function type(value: string) {
  await act(async () => {
    setValue.call(radius(), value);
    radius().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

const radii = () =>
  vi.mocked(api.updateFeature).mock.calls.map(([, , p]) => (p as any).radius);

it("sends one preview carrying the last of five keystrokes inside the dwell", async () => {
  await open([edge], "fillet1", { name: "Fillet1", radius: 2 });
  await wait(PREVIEW_DWELL_MS * 3);
  expect(api.updateFeature).not.toHaveBeenCalled();
  for (const value of ["3", "4", "5", "6", "7"]) {
    await type(value);
    await wait(PREVIEW_DWELL_MS / 5);
  }
  expect(api.updateFeature).not.toHaveBeenCalled();
  await wait(PREVIEW_DWELL_MS);
  expect(radii()).toEqual([7]);
  expect((useStore.getState().document!.features[0] as any).radius).toBe(7);
});

it("sends only the newest input after a slow preview settles", async () => {
  await open([edge], "fillet1", { name: "Fillet1", radius: 2 });
  let release!: () => void;
  hold = new Promise((resolve) => (release = resolve));
  await type("3");
  await wait(PREVIEW_DWELL_MS);
  await type("4");
  await wait(PREVIEW_DWELL_MS);
  await type("5");
  await wait(PREVIEW_DWELL_MS);
  expect(radii()).toEqual([3]);
  hold = null;
  release();
  await wait(0);
  expect(radii()).toEqual([3, 5]);
  expect((useStore.getState().document!.features[0] as any).radius).toBe(5);
});

it("previews a new feature once, and OK keeps one feature and one undo entry", async () => {
  await open([edge]);
  await wait(PREVIEW_DWELL_MS);
  expect(api.addFeature).toHaveBeenCalledOnce();
  expect(useStore.getState().document!.features).toMatchObject([
    { type: "fillet", name: "Fillet1", radius: 2 },
  ]);
  await type("3");
  await wait(PREVIEW_DWELL_MS);
  expect(radii()).toEqual([3]);

  await act(async () => button("OK").click());
  expect(api.addFeature).toHaveBeenCalledOnce();
  const state = useStore.getState();
  expect(state.mode).toEqual({ name: "idle" });
  expect(state.document!.features).toMatchObject([
    { type: "fillet", name: "Fillet1", radius: 3 },
  ]);
  expect(state.undoStack).toEqual([original]);

  await act(() => useStore.getState().undo());
  expect(useStore.getState().document).toEqual(original);
  expect(server).toEqual(original);
});

it.each([
  ["Cancel", () => button("Cancel").click()],
  [
    "Escape",
    () =>
      radius().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
  ],
  [
    "switching dialogs",
    () => useStore.getState().setMode({ name: "dialog", dialog: "chamfer" }),
  ],
  ["closing the project", () => useStore.getState().closeProject()],
])("%s removes the provisional feature", async (_how, leave) => {
  await open([edge]);
  await type("4");
  await wait(PREVIEW_DWELL_MS);
  expect(server.features).toHaveLength(1);
  await act(async () => leave());
  await wait(0);
  expect(server).toEqual(original);
  const state = useStore.getState();
  if (state.document) expect(state.document).toEqual(original);
  expect(state.previewBaseline).toBeNull();
  expect(state.undoStack).toEqual([]);
});

it("sends nothing while the inputs are invalid", async () => {
  await open([]);
  await type("5");
  await wait(PREVIEW_DWELL_MS * 3);
  expect(api.addFeature).not.toHaveBeenCalled();
  expect(api.updateFeature).not.toHaveBeenCalled();
  expect(useStore.getState().error).toBeNull();
});

it("commits the latest typed value on Enter inside the dwell", async () => {
  await open([edge]);
  await wait(PREVIEW_DWELL_MS);
  await type("9");
  await act(async () => {
    radius().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  await wait(PREVIEW_DWELL_MS * 3);
  expect(radii()).toEqual([9]);
  expect(api.addFeature).toHaveBeenCalledOnce();
  expect(useStore.getState().document!.features).toMatchObject([
    { name: "Fillet1", radius: 9 },
  ]);
  expect(useStore.getState().undoStack).toEqual([original]);
});

it("shows the latest preview error and clears it after a good preview", async () => {
  await open([edge], "fillet1", { name: "Fillet1", radius: 2 });
  for (const value of ["500", "600"]) await type(value);
  await wait(PREVIEW_DWELL_MS);
  expect(useStore.getState().error).toBe("Radius is too large");
  await type("4");
  await wait(PREVIEW_DWELL_MS);
  expect(radii()).toEqual([600, 4]);
  expect(useStore.getState().error).toBeNull();
});
