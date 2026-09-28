import { act } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createEmptyDocument, detectProfiles } from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { ViewportView } from "../../src/components/ViewportView";
import { api } from "../../src/api";
import { useStore } from "../../src/store";
import { viewportHandle } from "../../src/viewportRef";
import { pointer, result, sizeViewport, type P } from "../helpers/boxScene";
import { manyBodyPayloads, squareSketch } from "../helpers/perfFixtures";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../helpers/fakeRenderer")).FakeWebGLRenderer,
}));
vi.mock("../../src/three/ViewCube", () => ({
  ViewCube: class {
    dispose() {}
  },
}));
vi.mock("../../src/api", () => ({ api: { addFeature: vi.fn() } }));

const first = { kind: "face", bodyId: "b:0:0", faceName: "f:b:0:0:1" };
const second = { kind: "face", bodyId: "b:1:0", faceName: "f:b:1:0:1" };
const sketch = squareSketch(1, 1);
const profiles = detectProfiles(sketch.entities);
const profile = {
  kind: "profile",
  sketchId: sketch.sketchId,
  profileId: profiles[0]!.id,
};
let root: ReturnType<typeof createRoot>;
let host: HTMLElement;
let restoreSize: () => void;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  restoreSize = sizeViewport();
  const saved = createEmptyDocument("loft-picks", "Loft picks");
  const evaluation = result(manyBodyPayloads(2, 1), [
    {
      featureId: sketch.sketchId,
      frame: { ...sketch.frame, origin: [0, 20, 15] },
      entities: sketch.entities,
      solveStatus: "unconstrained",
      dof: 8,
      profiles,
    },
  ]);
  vi.mocked(api.addFeature).mockResolvedValue({ document: saved, evaluation });
  useStore.setState({
    projectId: saved.id,
    document: saved,
    evaluation,
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    selection: [],
    hover: null,
    dialogParams: { operation: "newBody" },
    mode: { name: "dialog", dialog: "loft" },
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root.render(
      <>
        <ViewportView />
        <FeatureDialog />
      </>,
    ),
  );
  viewportHandle.current!.zoomToFit(false);
  viewportHandle.current!.render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  restoreSize();
  vi.useRealTimers();
});

async function click(world: P) {
  await act(async () => {
    pointer("pointerdown", new THREE.Vector3(...world));
    pointer("pointerup", new THREE.Vector3(...world));
  });
  viewportHandle.current!.render();
}

it("submits two faces selected with plain viewport clicks in their picked order", async () => {
  await click([5, 4, 5]);
  await click([20, 4, 5]);
  expect(useStore.getState().selection).toEqual([first, second]);
  const ok = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "OK",
  )!;
  await act(async () => ok.click());
  expect(api.addFeature).toHaveBeenCalledWith(
    "loft-picks",
    expect.objectContaining({
      type: "loft",
      sections: [first, second],
      operation: "newBody",
    }),
  );
});

it("accumulates face and profile sections with plain clicks and removes a clicked section", async () => {
  await click([5, 4, 5]);
  await click([3, 23, 15]);
  await click([20, 4, 5]);
  expect(useStore.getState().selection).toEqual([first, profile, second]);
  await click([3, 23, 15]);
  expect(useStore.getState().selection).toEqual([first, second]);
});
