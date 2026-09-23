import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CadViewport } from "../../src/three/CadViewport";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../helpers/fakeRenderer")).FakeWebGLRenderer,
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
