import { act } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type BodyPayload,
  type CadDocument,
  type Feature,
} from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { ViewportView } from "../../src/components/ViewportView";
import { openFeatureEditor } from "../../src/components/Timeline";
import { PREVIEW_DWELL_MS } from "../../src/livePreview";
import { useStore } from "../../src/store";
import { viewportHandle } from "../../src/viewportRef";
import { themeColor } from "../../src/theme/tokens";
import { api } from "../../src/api";
import {
  box,
  edge,
  pointer,
  quad,
  result,
  S,
  sizeViewport,
  type P,
} from "../helpers/boxScene";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../helpers/fakeRenderer")).FakeWebGLRenderer,
}));
vi.mock("../../src/three/ViewCube", () => ({
  ViewCube: class {
    dispose() {}
  },
}));
vi.mock("../../src/api", () => ({
  api: {
    evaluate: vi.fn(),
    updateFeature: vi.fn(),
    replaceDocument: vi.fn(),
  },
}));

const original = box("box");
const filleted: BodyPayload = (() => {
  const b = box("filleted");
  b.edges = b.edges
    .filter((e) => e.name !== `x0${S}`)
    .map((e) =>
      e.name === `z${S}0` ? edge(e.name, [S, 0, 0], [S, 0, S - 1]) : e,
    );
  quad(
    [
      [0, 0, S - 1],
      [S, 0, S - 1],
      [S, 1, S],
      [0, 1, S],
    ],
    "fillet",
    b,
  );
  b.edges.push(edge("fa", [0, 0, S - 1], [S, 0, S - 1]));
  b.edges.push(edge("fb", [0, 1, S], [S, 1, S]));
  return b;
})();

const picked = { kind: "edge", bodyId: "b1", edgeName: `x0${S}` } as const;
const other = { kind: "edge", bodyId: "b1", edgeName: `z${S}0` } as const;

const fillet = {
  id: "fillet1",
  type: "fillet",
  name: "Fillet1",
  suppressed: false,
  edges: [picked],
  radius: 1,
  tangentChain: false,
} as Feature;

let saved: CadDocument;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;
let restoreSize: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  restoreSize = sizeViewport();
  saved = createEmptyDocument("proj", "doc");
  saved.features.push(
    {
      id: "import1",
      type: "importStep",
      name: "Import1",
      suppressed: false,
    } as Feature,
    fillet,
  );
  saved.timelinePosition = 2;
  vi.mocked(api.evaluate).mockImplementation(async (_id, position) =>
    structuredClone(result(position === 1 ? [original] : [filleted])),
  );
  vi.mocked(api.updateFeature).mockImplementation(async (_id, fid, patch) => ({
    document: {
      ...structuredClone(saved),
      features: saved.features.map((f) =>
        f.id === fid ? ({ ...f, ...patch } as Feature) : f,
      ),
    },
    evaluation: structuredClone(result([filleted])),
  }));
  vi.mocked(api.replaceDocument).mockImplementation(async (_id, document) => ({
    document: structuredClone(document),
    evaluation: structuredClone(result([filleted])),
  }));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
  restoreSize();
});

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function editFillet() {
  useStore.setState({
    projectId: saved.id,
    document: structuredClone(saved),
    evaluation: result([structuredClone(filleted)]),
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    selection: [],
    hover: null,
    dialogParams: {},
    mode: { name: "idle" },
  });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <>
        <ViewportView />
        <FeatureDialog />
      </>,
    ),
  );
  await act(async () => openFeatureEditor(fillet));
  await wait(0);
  const vp = viewportHandle.current!;
  vp.zoomToFit(false);
  vp.render();
}

const shownKeys = () =>
  viewportHandle.current!.bodyPayloads().map((b) => b.meshKey);

function ghosts() {
  const found: { bodyId: string; triangles: number; colour: string }[] = [];
  viewportHandle.current!.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.ghostOf) return;
    found.push({
      bodyId: o.userData.ghostOf,
      triangles: o.geometry.index!.count / 3,
      colour: (o.material as THREE.MeshStandardMaterial).color.getHexString(),
    });
  });
  return found;
}

function selectedEdgeLines() {
  const colour = new THREE.Color(themeColor("selection")).getHexString();
  const lines: number[][] = [];
  viewportHandle.current!.scene.traverse((o) => {
    if (
      o instanceof THREE.Line &&
      !(o instanceof THREE.LineSegments) &&
      !(o.material as THREE.LineBasicMaterial).depthTest &&
      (o.material as THREE.LineBasicMaterial).color.getHexString() === colour
    )
      lines.push([...o.geometry.getAttribute("position").array]);
  });
  return lines;
}

async function click(world: P) {
  await act(async () => {
    pointer("pointerdown", new THREE.Vector3(...world));
    pointer("pointerup", new THREE.Vector3(...world));
  });
  await wait(0);
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

it("edits a fillet on the pre-fillet box with its edge highlighted and a ghost of the fillet face", async () => {
  await editFillet();
  expect(api.evaluate).toHaveBeenCalledExactlyOnceWith(saved.id, 1);
  expect(shownKeys()).toEqual(["box"]);
  expect(selectedEdgeLines()).toEqual([[0, 0, S, S, 0, S]]);
  expect(ghosts()).toEqual([
    {
      bodyId: "b1",
      triangles: 2,
      colour: themeColor("preview-cut").slice(1),
    },
  ]);
});

it("adds a clicked original edge to the picks", async () => {
  await editFillet();
  await click([S, 0, S - 0.4]);
  expect(useStore.getState().selection).toEqual([picked, other]);
  expect(selectedEdgeLines()).toHaveLength(2);
});

it("returns to the saved evaluation on Cancel without another evaluation", async () => {
  await editFillet();
  await act(async () => button("Cancel").click());
  await wait(0);
  expect(useStore.getState().mode).toEqual({ name: "idle" });
  expect(shownKeys()).toEqual(["filleted"]);
  expect(ghosts()).toEqual([]);
  expect(api.evaluate).toHaveBeenCalledOnce();
  expect(api.replaceDocument).not.toHaveBeenCalled();
});

it("returns to the committed evaluation on OK", async () => {
  await editFillet();
  await click([S, 0, S - 0.4]);
  await wait(PREVIEW_DWELL_MS);
  expect(shownKeys()).toEqual(["box"]);
  await act(async () => button("OK").click());
  await wait(0);
  expect(useStore.getState().mode).toEqual({ name: "idle" });
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(shownKeys()).toEqual(["filleted"]);
  expect(ghosts()).toEqual([]);
});
