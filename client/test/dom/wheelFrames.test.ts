import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../helpers/fakeRenderer")).FakeWebGLRenderer,
}));

const queued = new Map<number, FrameRequestCallback>();
let nextHandle = 1;

function runFrames(count: number) {
  for (let i = 0; i < count; i++) {
    const due = [...queued.values()];
    queued.clear();
    for (const callback of due) callback(i * 16);
  }
}

beforeEach(() => {
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

function fire(el: HTMLElement, init: WheelEventInit) {
  const { ctrlKey = false, clientX = 0, clientY = 0, ...deltas } = init;
  const e = new WheelEvent("wheel", { cancelable: true, ...deltas });
  Object.defineProperties(e, {
    ctrlKey: { value: ctrlKey },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  el.dispatchEvent(e);
  return e.defaultPrevented;
}

it("wheel streams apply once per frame and Safari never zooms twice", async () => {
  const { CadViewport } = await import("../../src/three/CadViewport");
  const { listenWheel } = await import("../../src/three/wheel");
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { value: 1280 },
    clientHeight: { value: 800 },
  });
  const vp = new CadViewport(container);
  const unlisten = listenWheel(container, vp);
  runFrames(2);
  const zoomBy = vi.spyOn(vp, "zoomBy");
  const pan = vi.spyOn(vp, "pan");
  for (let i = 0; i < 20; i++) {
    const prevented = fire(container, {
      deltaY: -1,
      ctrlKey: true,
      clientX: 100 + i,
      clientY: 200 + i,
    });
    expect(prevented).toBe(true);
  }
  expect(zoomBy).not.toHaveBeenCalled();
  runFrames(1);
  expect(zoomBy).toHaveBeenCalledTimes(1);
  const [factor, x, y] = zoomBy.mock.calls[0]!;
  expect(factor).toBeCloseTo(Math.exp(-0.2), 9);
  expect([x, y]).toEqual([119, 219]);
  expect(vp.zoom).toBeCloseTo(90 * Math.exp(-0.2), 6);
  const gesture = new Event("gesturechange", { cancelable: true });
  Object.assign(gesture, { scale: 2, clientX: 10, clientY: 20 });
  container.dispatchEvent(gesture);
  expect(gesture.defaultPrevented).toBe(true);
  runFrames(1);
  expect(zoomBy).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 20; i++) fire(container, { deltaX: 1.5, deltaY: -2 });
  runFrames(10);
  expect(zoomBy).toHaveBeenCalledTimes(1);
  expect(pan).toHaveBeenCalledTimes(1);
  expect(pan.mock.calls[0]).toEqual([-30, 40]);
  Object.assign(gesture, { scale: 2.2 });
  container.dispatchEvent(gesture);
  runFrames(1);
  expect(zoomBy).toHaveBeenCalledTimes(2);
  const [spread, gx, gy] = zoomBy.mock.calls[1]!;
  expect(spread).toBeCloseTo(2 / 2.2, 9);
  expect([gx, gy]).toEqual([10, 20]);
  unlisten();
  vp.dispose();
});
