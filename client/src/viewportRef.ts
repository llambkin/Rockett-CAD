import { createContext } from "react";
import type { CadViewport } from "./three/CadViewport";
import { useStore } from "./store";
import { TIMING_MS } from "./tunables";

export type ViewportRef = Readonly<{ current: CadViewport | null }>;

export const ViewportContext = createContext<ViewportRef>({ current: null });

export function alignCameraToActiveSketch(viewport: ViewportRef): void {
  setTimeout(() => {
    const s = useStore.getState();
    if (s.active?.id !== "design.sketch") return;
    const sketchId = s.active.state.sketchId;
    const sk = s.evaluation?.sketches.find((x) => x.featureId === sketchId);
    const vp = viewport.current;
    if (!sk || !vp) return;
    const n = sk.frame.normal;
    vp.setView([n[0], n[1], n[2]], sk.frame.yAxis);
  }, TIMING_MS.sketchAlignDelay);
}
