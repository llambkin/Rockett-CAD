import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type Feature,
} from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { openFeatureEditor } from "../../src/components/Timeline";
import { useStore } from "../../src/store";
import { api } from "../../src/api";

vi.mock("../../src/api", () => ({
  api: {
    updateFeature: vi.fn(),
    replaceDocument: vi.fn(),
  },
}));

const edgeInfo = (name: string) => ({
  name,
  polyline: [],
  length: 1,
  curve: { type: "other" },
});
const evaluation = {
  bodies: [
    {
      bodyId: "b1",
      name: "Body 1",
      visible: true,
      faces: [],
      edges: ["eA", "eB", "eC"].map(edgeInfo),
      vertices: [],
    },
  ],
  planes: [],
  kernelMs: 0,
  featureStatuses: [],
  sketches: [],
} as any;
const fillet = {
  id: "fillet1",
  type: "fillet",
  name: "Fillet1",
  suppressed: false,
  edges: [
    { kind: "edge", bodyId: "b1", edgeName: "eB" },
    { kind: "edge", bodyId: "b1", edgeName: "eC" },
  ],
  radius: 2,
  tangentChain: false,
} as Feature;

let document_: CadDocument;
let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  vi.clearAllMocks();
  document_ = { ...createEmptyDocument("proj", "doc"), features: [fillet] };
  vi.mocked(api.updateFeature).mockImplementation(async (_id, fid, patch) => ({
    document: {
      ...document_,
      features: document_.features.map((f) =>
        f.id === fid ? ({ ...f, ...patch } as Feature) : f,
      ),
    },
    evaluation,
  }));
  useStore.setState({
    projectId: document_.id,
    document: document_,
    evaluation,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    selection: [],
    hover: null,
    mode: { name: "idle" },
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<FeatureDialog />));
  await act(() => openFeatureEditor(fillet));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const rows = () =>
  [...host.querySelectorAll<HTMLElement>("[role=listitem]")].map((r) =>
    r.querySelector("span")!.textContent?.trim(),
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  )!;

it("lists one labelled row per picked edge when editing a fillet", () => {
  expect(rows()).toEqual(["Edge 2, Body 1", "Edge 3, Body 1"]);
});

it("removes one pick with its x and OK saves the remaining edge", async () => {
  await act(async () => button("Remove Edge 2, Body 1").click());
  expect(rows()).toEqual(["Edge 3, Body 1"]);
  expect(useStore.getState().selection).toEqual([
    { kind: "edge", bodyId: "b1", edgeName: "eC" },
  ]);
  await act(async () => button("OK").click());
  const saved = vi.mocked(api.updateFeature).mock.calls.at(-1)![2] as any;
  expect(saved.edges).toEqual([{ kind: "edge", bodyId: "b1", edgeName: "eC" }]);
});

it("empties the list with Clear", async () => {
  await act(async () => button("Clear").click());
  expect(rows()).toEqual([]);
  expect(useStore.getState().selection).toEqual([]);
});

it("sets the viewport hover to the edge under the pointer", async () => {
  const row = host.querySelectorAll("[role=listitem]")[1]!;
  await act(async () =>
    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  expect(useStore.getState().hover).toEqual({
    kind: "edge",
    bodyId: "b1",
    edgeName: "eC",
  });
  await act(async () =>
    row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
  );
  expect(useStore.getState().hover).toBeNull();
});
