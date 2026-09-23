import { act } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type BodyPayload,
  type CadDocument,
  type EdgeInfo,
  type EvaluateResult,
  type Feature,
} from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { ViewportView } from "../../src/components/ViewportView";
import { openFeatureEditor } from "../../src/components/Timeline";
import { PREVIEW_DWELL_MS } from "../../src/livePreview";
import { useStore } from "../../src/store";
import { viewportHandle } from "../../src/viewportRef";
import { worldToClient } from "../../src/three/screen";
import { themeColor } from "../../src/theme/tokens";
import { api } from "../../src/api";

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

type P = [number, number, number];
const S = 10;

function quad(corners: P[], name: string, into: BodyPayload) {
  const at = into.positions.length / 3;
  const start = into.indices.length;
  const [a, b, c] = corners.map((p) => new THREE.Vector3(...p));
  const n = b!.clone().sub(a!).cross(c!.clone().sub(a!)).normalize();
  for (const p of corners) {
    into.positions.push(...p);
    into.normals.push(n.x, n.y, n.z);
  }
  into.indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  into.faces.push({
    name,
    start,
    count: 6,
    surface: { type: "other" },
    area: 0,
  });
}

function edge(name: string, a: P, b: P): EdgeInfo {
  return {
    name,
    polyline: [...a, ...b],
    length: new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)),
    curve: { type: "line", a, b },
  };
}

function box(meshKey: string): BodyPayload {
  const body: BodyPayload = {
    bodyId: "b1",
    name: "Body1",
    visible: true,
    meshKey,
    positions: [],
    normals: [],
    indices: [],
    faces: [],
    edges: [],
    vertices: [],
    bbox: { min: [0, 0, 0], max: [S, S, S] },
  };
  quad(
    [
      [0, 0, S],
      [S, 0, S],
      [S, S, S],
      [0, S, S],
    ],
    "top",
    body,
  );
  quad(
    [
      [0, 0, 0],
      [0, S, 0],
      [S, S, 0],
      [S, 0, 0],
    ],
    "bottom",
    body,
  );
  quad(
    [
      [0, 0, 0],
      [S, 0, 0],
      [S, 0, S],
      [0, 0, S],
    ],
    "front",
    body,
  );
  quad(
    [
      [S, 0, 0],
      [S, S, 0],
      [S, S, S],
      [S, 0, S],
    ],
    "right",
    body,
  );
  for (const [x, y] of [
    [0, 0],
    [S, 0],
    [S, S],
    [0, S],
  ] as const)
    body.edges.push(edge(`z${x}${y}`, [x, y, 0], [x, y, S]));
  for (const z of [0, S]) {
    body.edges.push(edge(`x0${z}`, [0, 0, z], [S, 0, z]));
    body.edges.push(edge(`y${S}${z}`, [S, 0, z], [S, S, z]));
  }
  return body;
}

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

const result = (bodies: BodyPayload[]): EvaluateResult => ({
  bodies,
  planes: [],
  sketches: [],
  featureStatuses: [],
  kernelMs: 0,
});

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
const size = Object.getOwnPropertyDescriptors(HTMLElement.prototype);

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 600 },
  });
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
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: size.clientWidth!,
    clientHeight: size.clientHeight!,
  });
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
  const vp = viewportHandle.current!;
  const at = worldToClient(
    vp.canvasRect(),
    vp.camera,
    new THREE.Vector3(...world),
  );
  const canvas = host.querySelector("canvas")!;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  const init = {
    bubbles: true,
    button: 0,
    pointerId: 1,
    clientX: at.x,
    clientY: at.y,
  };
  await act(async () => {
    canvas.dispatchEvent(new PointerEvent("pointerdown", init));
    canvas.dispatchEvent(new PointerEvent("pointerup", init));
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
