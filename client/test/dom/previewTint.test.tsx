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
} from "@rockett/shared";
import { FeatureDialog } from "../../src/components/FeatureDialog";
import { ViewportView } from "../../src/components/ViewportView";
import { PREVIEW_DWELL_MS } from "../../src/livePreview";
import { useStore } from "../../src/store";
import { viewportHandle } from "../../src/viewportRef";
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
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    replaceDocument: vi.fn(),
  },
}));

const NORMAL = "b7bcc1";
const ADDED = "8cbf9e";
const REMOVED = "d4a4a7";

function body(bodyId: string, size: number): BodyPayload {
  return {
    bodyId,
    name: bodyId,
    visible: true,
    meshKey: `${bodyId}:${size}`,
    positions: [0, 0, 0, size, 0, 0, 0, size, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
    faces: [
      {
        name: `${bodyId}:f`,
        start: 0,
        count: 3,
        surface: { type: "other" },
        area: 0,
      },
    ],
    edges: [],
    vertices: [],
    bbox: { min: [0, 0, 0], max: [size, size, 0] },
  };
}

const result = (bodies: BodyPayload[]): EvaluateResult => ({
  bodies,
  planes: [],
  sketches: [],
  featureStatuses: [],
  kernelMs: 0,
});
const before = result([body("b1", 1), body("b2", 5)]);
const after = result([body("b1", 3), body("b2", 5)]);

function withNewFace(b: BodyPayload): BodyPayload {
  return {
    ...b,
    meshKey: `${b.meshKey}+`,
    positions: [...b.positions, 0, 0, 1, 1, 0, 1, 0, 1, 1],
    normals: [...b.normals, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [...b.indices, 3, 4, 5],
    faces: [...b.faces, { ...b.faces[0]!, name: "new", start: 3 }],
  };
}
const filleted = result([withNewFace(body("b1", 1)), body("b2", 5)]);
let next: EvaluateResult;

let original: CadDocument;
let server: CadDocument;
let evaluation: EvaluateResult;
let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLElement;

const reply = async () => ({
  document: structuredClone(server),
  evaluation: structuredClone(evaluation),
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  original = createEmptyDocument("proj", "doc");
  server = structuredClone(original);
  evaluation = before;
  next = after;
  vi.mocked(api.addFeature).mockImplementation(async (_id, feature) => {
    server.features.push(structuredClone(feature));
    evaluation = next;
    return reply();
  });
  vi.mocked(api.updateFeature).mockImplementation(async (_id, fid, patch) => {
    server.features = server.features.map((f) =>
      f.id === fid ? ({ ...f, ...patch } as Feature) : f,
    );
    evaluation = next;
    return reply();
  });
  vi.mocked(api.replaceDocument).mockImplementation(async (_id, document) => {
    server = structuredClone(document);
    evaluation = before;
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

async function previewExtrude(operation: string) {
  useStore.setState({
    projectId: original.id,
    document: structuredClone(original),
    evaluation: structuredClone(before),
    busy: false,
    error: null,
    undoStack: [],
    redoStack: [],
    previewBaseline: null,
    selection: [{ kind: "profile", sketchId: "s1", profileId: "p1" }],
    dialogParams: { operation },
    mode: { name: "dialog", dialog: "extrude" },
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
  await wait(PREVIEW_DWELL_MS);
}

function colours() {
  const found: Record<string, string> = {};
  viewportHandle.current!.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.userData.bodyId) return;
    const materials = [o.material].flat() as THREE.MeshStandardMaterial[];
    const groups: { materialIndex?: number }[] = o.geometry.groups.length
      ? o.geometry.groups
      : [{ materialIndex: 0 }];
    found[o.userData.bodyId] = groups
      .map((g) => materials[g.materialIndex ?? 0]!.color.getHexString())
      .join(",");
  });
  return found;
}

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

it("tints the body a previewed join changes green and leaves the others alone", async () => {
  await previewExtrude("join");
  expect(api.addFeature).toHaveBeenCalledOnce();
  expect(colours()).toEqual({ b1: ADDED, b2: NORMAL });
});

it("tints the body a previewed cut changes red", async () => {
  await previewExtrude("cut");
  expect(colours()).toEqual({ b1: REMOVED, b2: NORMAL });
});

it("tints only the face a previewed cut adds", async () => {
  next = filleted;
  await previewExtrude("cut");
  expect(colours()).toEqual({ b1: `${NORMAL},${REMOVED}`, b2: NORMAL });
  await act(async () => button("Cancel").click());
  await wait(0);
  expect(colours()).toEqual({ b1: NORMAL, b2: NORMAL });
});

it("clears the tint on Cancel", async () => {
  await previewExtrude("join");
  expect(colours().b1).toBe(ADDED);
  await act(async () => button("Cancel").click());
  await wait(0);
  expect(useStore.getState().previewBaseline).toBeNull();
  expect(colours()).toEqual({ b1: NORMAL, b2: NORMAL });
});

it("clears the tint on OK and keeps the committed geometry", async () => {
  await previewExtrude("join");
  expect(colours().b1).toBe(ADDED);
  await act(async () => button("OK").click());
  await wait(0);
  expect(useStore.getState().mode).toEqual({ name: "idle" });
  expect(useStore.getState().evaluation!.bodies[0]!.positions[3]).toBe(3);
  expect(colours()).toEqual({ b1: NORMAL, b2: NORMAL });
});
