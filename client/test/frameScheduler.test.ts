import { describe, expect, it, vi } from "vitest";
import { frameScheduler, type FrameSource } from "../src/three/frameScheduler";

function fakeFrames() {
  const queued = new Map<number, (now: number) => void>();
  let next = 1;
  let now = 0;
  const source: FrameSource = {
    request(callback) {
      queued.set(next, callback);
      return next++;
    },
    cancel: (handle) => queued.delete(handle),
  };
  const run = (count: number) => {
    for (let i = 0; i < count; i++) {
      now += 16;
      const due = [...queued.values()];
      queued.clear();
      for (const callback of due) callback(now);
    }
  };
  return { source, run, pending: () => queued.size };
}

describe("frameScheduler", () => {
  it("renders 0 of 120 idle frames and requests none", () => {
    const frames = fakeFrames();
    const draw = vi.fn(() => false);
    frameScheduler(draw, frames.source);
    frames.run(120);
    expect(draw).toHaveBeenCalledTimes(0);
    expect(frames.pending()).toBe(0);
  });

  it("coalesces requests into one render on the next frame", () => {
    const frames = fakeFrames();
    const draw = vi.fn(() => false);
    const scheduler = frameScheduler(draw, frames.source);
    scheduler.requestRender();
    scheduler.requestRender();
    scheduler.requestRender();
    frames.run(120);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("renders every frame while an animation runs, then stops", () => {
    const frames = fakeFrames();
    let left = 10;
    const draw = vi.fn(() => --left > 0);
    const scheduler = frameScheduler(draw, frames.source);
    scheduler.requestRender();
    frames.run(10);
    expect(draw).toHaveBeenCalledTimes(10);
    frames.run(120);
    expect(draw).toHaveBeenCalledTimes(10);
  });

  it("a request made while drawing renders on the next frame", () => {
    const frames = fakeFrames();
    let again = true;
    const scheduler = frameScheduler(() => {
      if (again) scheduler.requestRender();
      again = false;
      return false;
    }, frames.source);
    const draw = vi.fn();
    scheduler.onRender(draw);
    scheduler.requestRender();
    frames.run(5);
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels the pending frame and ignores later requests", () => {
    const frames = fakeFrames();
    const draw = vi.fn(() => true);
    const scheduler = frameScheduler(draw, frames.source);
    scheduler.requestRender();
    scheduler.dispose();
    scheduler.requestRender();
    frames.run(10);
    expect(draw).toHaveBeenCalledTimes(0);
    expect(frames.pending()).toBe(0);
  });
});
