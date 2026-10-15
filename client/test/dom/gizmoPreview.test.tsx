import { act } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type BodyPayload,
  type CadDocument,
  type EvaluateResult,
  type Feature,
  type SketchPayload,
} from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { ViewportView } from "../../src/components/ViewportView";
import { openFeatureEditor } from "../../src/components/Timeline";
import { PREVIEW_DWELL_MS } from "../../src/livePreview";
import { useStore, type Mode, type Selection } from "../../src/store";
import { viewportHandle } from "../../src/viewportRef";
import { themeColor, type ThemeColor } from "../../src/theme/tokens";
import { api } from "../../src/api";
import {
  box,
  pointer,
  quad,
  result,
  S,
  sizeViewport,
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
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    replaceDocument: vi.fn(),
  },
}));

const top: Selection = { kind: "face", bodyId: "b1", faceName: "top" };
const region: Selection = { kind: "profile", sketchId: "s1", profileId: "p1" };
const sketch: SketchPayload = {
  featureId: "s1",
  frame: {
    origin: [0, 0, S],
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

const before = box("box");
const joined = box("joined", S + 5, "extrude1:top");
const pocketed: BodyPayload = (() => {
  const b = box("pocketed");
  quad(
    [
      [2, 2, S - 5],
      [8, 2, S - 5],
      [8, 8, S - 5],
      [2, 8, S - 5],
    ],
    "extrude1:floor",
    b,
  );
  return b;
})();
const moved: BodyPayload = (() => {
  const b = box("moved");
  b.positions = b.positions.map((v, i) => (i % 3 === 0 ? v + 5 : v));
  b.edges = b.edges.map((e) => ({
    ...e,
    polyline: e.polyline.map((v, i) => (i % 3 === 0 ? v + 5 : v)),
  }));
  b.bbox = { min: [5, 0, 0], max: [S + 5, S, S] };
  return b;
})();

let server: CadDocument;
let preview: EvaluateResult;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;
let restoreSize: () => void;

const reply = async () => ({
  document: structuredClone(server),
  evaluation: structuredClone(preview),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  restoreSize = sizeViewport();
  server = createEmptyDocument("proj", "doc");
  vi.mocked(api.evaluate).mockImplementation(async () =>
    structuredClone(result([before], [sketch])),
  );
  vi.mocked(api.addFeature).mockImplementation(async (_id, feature) => {
    server.features.push(structuredClone(feature));
    server.timelinePosition = server.features.length;
    return reply();
  });
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

async function open(
  mode: Mode,
  selection: Selection[],
  dialogParams: Record<string, unknown>,
  shown: EvaluateResult,
) {
  useStore.setState({
    projectId: server.id,
    document: structuredClone(server),
    evaluation: structuredClone(shown),
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    selection,
    hover: null,
    dialogParams,
    mode,
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
  const vp = viewportHandle.current!;
  vp.setView([1, -1, 0.6], [0, 0, 1], false);
  vp.zoomToFit(false);
  vp.render();
}

function shaft(colour: ThemeColor): THREE.Vector3 | null {
  const hex = new THREE.Color(themeColor(colour)).getHexString();
  let at: THREE.Vector3 | null = null;
  viewportHandle.current!.scene.traverse((o) => {
    if (
      o instanceof THREE.Mesh &&
      o.geometry instanceof THREE.CylinderGeometry &&
      o.renderOrder === 20 &&
      (o.material as THREE.MeshBasicMaterial).color.getHexString() === hex
    )
      at = o.getWorldPosition(new THREE.Vector3());
  });
  return at;
}

async function drag(from: THREE.Vector3, by: THREE.Vector3) {
  await act(async () => {
    pointer("pointerdown", from);
    pointer("pointermove", from.clone().addScaledVector(by, 0.5));
    pointer("pointermove", from.clone().add(by));
    pointer("pointerup", from.clone().add(by));
  });
  await wait(0);
}

async function dragsAfterPreview(colour: ThemeColor, by: THREE.Vector3) {
  expect(shaft(colour), "handle before the preview").not.toBeNull();
  await wait(PREVIEW_DWELL_MS);
  expect(useStore.getState().previewBaseline).not.toBeNull();
  const handle = shaft(colour);
  expect(handle, "handle after the preview").not.toBeNull();
  await drag(handle!, by);
  expect(shaft(colour), "handle after the drag").not.toBeNull();
}

it("keeps the extrude handle on a face through a join preview", async () => {
  preview = result([joined], [sketch]);
  await open(
    { name: "dialog", dialog: "extrude" },
    [top],
    { distance: 5, direction: "normal", operation: "join" },
    result([before], [sketch]),
  );
  await dragsAfterPreview("gizmo", new THREE.Vector3(0, 0, 4));
  expect(useStore.getState().dialogParams.distance).toBeGreaterThan(5);
});

it("keeps the extrude handle on a profile through a cut preview", async () => {
  preview = result([pocketed], [sketch]);
  await open(
    { name: "dialog", dialog: "extrude" },
    [region],
    { distance: 5, direction: "reverse", operation: "cut" },
    result([before], [sketch]),
  );
  await dragsAfterPreview("gizmo", new THREE.Vector3(0, 0, -3));
  expect(useStore.getState().dialogParams.distance).toBeGreaterThan(5);
});

it("keeps the move handle through a move preview", async () => {
  preview = result([moved], [sketch]);
  await open(
    { name: "dialog", dialog: "move" },
    [{ kind: "body", bodyId: "b1" }],
    { tx: 5, ty: 0, tz: 0 },
    result([before], [sketch]),
  );
  await dragsAfterPreview("move-axis-x", new THREE.Vector3(4, 0, 0));
  expect(useStore.getState().dialogParams.tx).toBeGreaterThan(5);
});

it("keeps the extrude handle on a face when editing a join", async () => {
  const extrude = {
    id: "extrude1",
    type: "extrude",
    name: "Extrude1",
    suppressed: false,
    profiles: [],
    faces: [{ kind: "face", bodyId: "b1", faceName: "top" }],
    distance: 5,
    direction: "normal",
    operation: "join",
  } as Feature;
  server.features.push(extrude);
  server.timelinePosition = 1;
  preview = result([box("joined8", S + 8, "extrude1:top")], [sketch]);
  await open({ name: "idle" }, [], {}, result([joined], [sketch]));
  await act(async () => openFeatureEditor(extrude));
  await wait(0);
  const handle = shaft("gizmo");
  expect(handle, "handle on the saved extrude").not.toBeNull();
  await drag(handle!, new THREE.Vector3(0, 0, 3));
  await wait(PREVIEW_DWELL_MS);
  expect(useStore.getState().dialogParams.distance).toBeGreaterThan(5);
  expect(shaft("gizmo"), "handle after the preview").not.toBeNull();
});
