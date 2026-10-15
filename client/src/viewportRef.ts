import type { CadViewport } from "./three/CadViewport";
import { useStore } from "./store";

/** Shared handle so toolbar/dialogs can drive the viewport (views, raycasts). */
export const viewportHandle: { current: CadViewport | null } = {
  current: null,
};

/** Animate the camera to face the sketch plane currently being edited. */
export function alignCameraToActiveSketch(): void {
  setTimeout(() => {
    const s = useStore.getState();
    if (s.mode.name !== "sketch") return;
    const sk = s.evaluation?.sketches.find(
      (x) => x.featureId === (s.mode as any).sketchId,
    );
    const vp = viewportHandle.current;
    if (!sk || !vp) return;
    const n = sk.frame.normal;
    vp.setView([n[0], n[1], n[2]], sk.frame.yAxis);
  }, 60);
}
