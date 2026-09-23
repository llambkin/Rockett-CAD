import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type BodyPayload,
  type EvaluateResult,
  type SketchFeature,
} from "@rockett/shared";
import { SketchOffsetIndicators } from "../../src/components/SketchOffsetIndicators";
import { ViewportView } from "../../src/components/ViewportView";
import { useStore } from "../../src/store";
import type { CadViewport } from "../../src/three/CadViewport";
import { MoveGizmo } from "../../src/three/MoveGizmo";
import { viewportHandle } from "../../src/viewportRef";
import { manyBodyPayloads } from "../helpers/perfFixtures";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../helpers/fakeRenderer")).FakeWebGLRenderer,
}));
vi.mock("../../src/three/ViewCube", () => ({
  ViewCube: class {
    dispose() {}
  },
}));

const queued = new Map<number, FrameRequestCallback>();
let nextHandle = 1;
let clock = 0;

function runFrames(count: number) {
  for (let i = 0; i < count; i++) {
    clock += 1000 / 60;
    const due = [...queued];
    queued.clear();
    for (const [, callback] of due) callback(clock);
  }
}

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queued.set(nextHandle, callback);
    return nextHandle++;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
    queued.delete(handle),
  );
});

afterEach(() => {
  queued.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountIdle() {
  const { CadViewport } = await import("../../src/three/CadViewport");
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { value: 1280 },
    clientHeight: { value: 800 },
  });
  const vp = new CadViewport(container);
  runFrames(2);
  return { vp, renders: vi.spyOn(vp.renderer, "render") };
}

it("an idle viewport renders 0 of 120 frames", async () => {
  const { vp, renders } = await mountIdle();
  runFrames(120);
  expect(renders).toHaveBeenCalledTimes(0);
  vp.dispose();
});

it("camera moves render once on the next frame", async () => {
  const { vp, renders } = await mountIdle();
  const moves: [string, (vp: CadViewport) => void][] = [
    ["pan", (v) => v.pan(10, 5)],
    ["orbit", (v) => v.orbitTrackball(10, 5)],
    ["zoom", (v) => v.zoomBy(1.1)],
    ["resize", (v) => v.resize()],
    ["projection", (v) => v.setProjection("perspective")],
    ["instant view", (v) => v.setView([0, 0, 1], [0, 1, 0], false)],
  ];
  for (const [name, move] of moves) {
    renders.mockClear();
    move(vp);
    move(vp);
    runFrames(10);
    expect(renders, name).toHaveBeenCalledTimes(1);
  }
  vp.dispose();
});

it("an animated view renders every frame until it lands, then stops", async () => {
  const { vp, renders } = await mountIdle();
  vp.setView([1, 0, 0], [0, 0, 1]);
  runFrames(30);
  const animated = renders.mock.calls.length;
  expect(animated).toBeGreaterThanOrEqual(18);
  expect(animated).toBeLessThanOrEqual(19);
  expect(vp.camera.position.y).toBeCloseTo(vp.target.y, 6);
  renders.mockClear();
  runFrames(120);
  expect(renders).toHaveBeenCalledTimes(0);
  vp.dispose();
});

it("labels: offset labels move only on rendered frames", async () => {
  const { vp } = await mountIdle();
  const draft: SketchFeature = {
    id: "s1",
    type: "sketch",
    name: "Sketch1",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [
      { id: "a", kind: "point", x: 0, y: 0 },
      { id: "b", kind: "point", x: 20, y: 0 },
      { id: "l", kind: "line", p1: "a", p2: "b" },
    ],
    constraints: [],
    offsets: [
      {
        id: "o1",
        distance: 2,
        sourceIds: ["l"],
        entityIds: ["l"],
        joinTolerance: 0.01,
      },
    ],
  };
  const frame = {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  };
  useStore.setState({
    mode: {
      name: "sketch",
      sketchId: "s1",
      tool: "select",
      constructionMode: false,
    },
    draftSketch: draft,
    evaluation: {
      sketches: [{ featureId: "s1", frame }],
    } as unknown as EvaluateResult,
  });
  viewportHandle.current = vp;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(SketchOffsetIndicators)));
  runFrames(2);
  const label = host.querySelector<HTMLElement>("[data-offset='o1']")!;
  const placed = label.style.transform;
  expect(placed).toContain("translate(");

  const reads = vi.spyOn(vp, "canvasRect");
  runFrames(120);
  expect(reads).toHaveBeenCalledTimes(0);

  vp.pan(40, 0);
  runFrames(10);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(label.style.transform).not.toBe(placed);

  await act(async () => root.unmount());
  host.remove();
  viewportHandle.current = null;
  vp.dispose();
});

it("canvasRect reads the layout once until a resize or scroll", async () => {
  const { vp } = await mountIdle();
  const layout = vi.spyOn(vp.renderer.domElement, "getBoundingClientRect");
  for (let i = 0; i < 10; i++) {
    vp.canvasRect();
    vp.pick(640, 400, { faces: true });
  }
  expect(layout).toHaveBeenCalledTimes(1);
  vp.resize();
  vp.canvasRect();
  vp.canvasRect();
  expect(layout).toHaveBeenCalledTimes(2);
  const scroller = document.body.appendChild(document.createElement("div"));
  scroller.dispatchEvent(new Event("scroll"));
  vp.canvasRect();
  vp.canvasRect();
  expect(layout).toHaveBeenCalledTimes(3);
  scroller.remove();
  vp.dispose();
  window.dispatchEvent(new Event("scroll"));
});

async function mountView(bodies: BodyPayload[]) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
  useStore.setState({
    projectId: "p",
    document: createEmptyDocument("p", "d"),
    evaluation: {
      bodies,
      planes: [],
      sketches: [],
      featureStatuses: [],
      kernelMs: 0,
    },
    mode: { name: "idle" },
    selection: [],
    hover: null,
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(ViewportView)));
  runFrames(5);
  const vp = viewportHandle.current!;
  const move = (clientX: number, clientY: number) => {
    vp.renderer.domElement.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX, clientY }),
    );
    runFrames(1);
  };
  const unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return { vp, renders: vi.spyOn(vp.renderer, "render"), move, unmount };
}

it("pointer moves over empty space render nothing", async () => {
  const { renders, move, unmount } = await mountView(manyBodyPayloads(1, 1));
  for (let i = 0; i < 60; i++) move(5 + (i % 2), 5);
  expect(useStore.getState().hover).toBeNull();
  expect(renders).toHaveBeenCalledTimes(0);
  await unmount();
});

it("a pointer move onto a body renders once", async () => {
  const { renders, move, unmount } = await mountView(manyBodyPayloads(1, 1));
  move(5, 5);
  move(640, 400);
  move(641, 400);
  expect(useStore.getState().hover).not.toBeNull();
  expect(renders).toHaveBeenCalledTimes(1);
  await unmount();
});

it("pointer hover on one gizmo axis renders once", async () => {
  const { vp, renders } = await mountIdle();
  const gizmo = new MoveGizmo(vp, new THREE.Vector3(), [0, 0, 0], []);
  runFrames(1);
  renders.mockClear();
  for (let i = 0; i < 10; i++) {
    gizmo.setHover(0);
    runFrames(1);
  }
  expect(renders).toHaveBeenCalledTimes(1);
  gizmo.dispose();
  vp.dispose();
});
