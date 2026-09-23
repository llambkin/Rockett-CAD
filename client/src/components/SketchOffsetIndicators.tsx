import { useEffect, useRef } from "react";
import { sketchOffsetAnchor } from "@rockett/shared";
import { useStore } from "../store";
import { viewportHandle } from "../viewportRef";
import { uv3 } from "../three/CadViewport";

/** Screen-space badges remain attached to the sketch while panning and zooming. */
export function SketchOffsetIndicators() {
  const draft = useStore((s) => s.draftSketch);
  const mode = useStore((s) => s.mode);
  const evaluation = useStore((s) => s.evaluation);
  const busy = useStore((s) => s.busy);
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode.name !== "sketch" || !draft) return;
    const frame = evaluation?.sketches.find(
      (s) => s.featureId === draft.id,
    )?.frame;
    if (!frame) return;
    let handle = 0;
    const update = () => {
      const vp = viewportHandle.current;
      if (vp && layer.current) {
        const rect = vp.renderer.domElement.getBoundingClientRect();
        for (const child of Array.from(layer.current.children)) {
          const el = child as HTMLButtonElement;
          const offset = draft.offsets?.find((o) => o.id === el.dataset.offset);
          const anchor = offset && sketchOffsetAnchor(draft, offset);
          if (!anchor) {
            el.style.display = "none";
            continue;
          }
          const p = uv3(frame, anchor.x, anchor.y).project(vp.camera);
          el.style.display = p.z >= -1 && p.z <= 1 ? "block" : "none";
          el.style.transform = `translate(${((p.x + 1) * rect.width) / 2}px, ${((1 - p.y) * rect.height) / 2 - 18}px) translate(-50%, -100%)`;
        }
      }
      handle = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(handle);
  }, [draft, mode.name, evaluation]);
  if (mode.name !== "sketch" || !draft) return null;
  return (
    <div className="dim-label-layer" ref={layer}>
      {(draft.offsets ?? []).map((offset, i) => (
        <button
          key={offset.id}
          data-offset={offset.id}
          className="dim-label offset-label"
          title={`Edit Offset ${i + 1}`}
          aria-label={`Edit Offset ${i + 1}, ${offset.distance} mm`}
          disabled={busy}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => {
            const s = useStore.getState();
            s.setSketchTool("offset");
            s.setDialogParams({
              editOffsetId: offset.id,
              sketchOffset: offset.distance,
            });
          }}
        >
          ↔ Offset {i + 1}: {offset.distance} mm
        </button>
      ))}
    </div>
  );
}
