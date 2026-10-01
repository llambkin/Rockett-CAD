import { afterEach, expect, it, vi } from "vitest";
import type { EvaluateResult } from "@rockett/shared";
import { alignCameraToActiveSketch, type ViewportRef } from "./viewportRef";
import { useStore } from "./store";
import { TIMING_MS } from "./tunables";
import type { CadViewport } from "./three/CadViewport";

const initial = useStore.getState();

afterEach(() => {
  vi.useRealTimers();
  useStore.setState(initial, true);
});

function sketch(viewport: ViewportRef) {
  const frame = {
    origin: [0, 0, 0],
    normal: [0, 0, 1],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
  };
  useStore.setState({
    active: {
      id: "design.sketch",
      state: {
        sketchId: "sketch",
        tool: "select",
        constructionMode: false,
        polygonSides: 6,
      },
    },
    evaluation: {
      sketches: [{ featureId: "sketch", frame }],
    } as unknown as EvaluateResult,
  });
  alignCameraToActiveSketch(viewport);
  return frame;
}

it("aligns the supplied viewport after the existing sketch delay", async () => {
  vi.useFakeTimers();
  const setView = vi.fn();
  const frame = sketch({ current: { setView } as unknown as CadViewport });
  expect(setView).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(TIMING_MS.sketchAlignDelay);
  expect(setView).toHaveBeenCalledExactlyOnceWith(frame.normal, frame.yAxis);
});

it("does not align an ended viewport lifetime or a replacement viewport", async () => {
  vi.useFakeTimers();
  const oldView = vi.fn();
  const replacement = vi.fn();
  const old: { current: CadViewport | null } = {
    current: { setView: oldView } as unknown as CadViewport,
  };
  sketch(old);
  old.current = null;
  const next = { current: { setView: replacement } as unknown as CadViewport };
  await vi.advanceTimersByTimeAsync(TIMING_MS.sketchAlignDelay);
  expect(oldView).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
  sketch(next);
  await vi.advanceTimersByTimeAsync(TIMING_MS.sketchAlignDelay);
  expect(replacement).toHaveBeenCalledOnce();
});
