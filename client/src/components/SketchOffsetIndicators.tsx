import { useEffect, useRef } from "react";
import { sketchOffsetAnchor } from "@rockett/shared";
import { useStore } from "../store";
import { viewportHandle } from "../viewportRef";
import { uv3 } from "../three/CadViewport";
import { worldToClient } from "../three/screen";

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
    const vp = viewportHandle.current;
    if (!frame || !vp) return;
    const update = () => {
      if (!layer.current) return;
      const rect = vp.canvasRect();
      for (const child of Array.from(layer.current.children)) {
        const el = child as HTMLButtonElement;
        const offset = draft.offsets?.find((o) => o.id === el.dataset.offset);
        const anchor = offset && sketchOffsetAnchor(draft, offset);
        if (!anchor) {
          el.style.display = "none";
          continue;
        }
        const p = worldToClient(
          rect,
          vp.camera,
          uv3(frame, anchor.x, anchor.y),
        );
        el.style.display = p.inFront ? "block" : "none";
        el.style.transform = `translate(${p.x - rect.left}px, ${p.y - rect.top - 18}px) translate(-50%, -100%)`;
      }
    };
    vp.requestRender();
    return vp.onRender(update);
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
