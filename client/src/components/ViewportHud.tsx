import { useEffect, useState } from "react";
import { useStore } from "../store";
import { activeCommand } from "../commands/active";
import { TIMING_MS } from "../tunables";
import { SketchStatus } from "./SketchStatus";
import { PickReadout } from "./PickReadout";

export function ViewportHud() {
  const mode = useStore((s) => s.mode);
  const active = useStore((s) => s.active?.id);
  const job = useStore((s) => s.job);
  const jobStartedAt = useStore((s) => s.jobStartedAt);
  const cancelJob = useStore((s) => s.cancelJob);
  const [showJob, setShowJob] = useState(false);

  useEffect(() => {
    setShowJob(false);
    if (jobStartedAt === null) return;
    const remaining = Math.max(
      0,
      jobStartedAt + TIMING_MS.jobHintDelay - Date.now(),
    );
    const timer = window.setTimeout(() => setShowJob(true), remaining);
    return () => window.clearTimeout(timer);
  }, [jobStartedAt]);

  let hint = active ? (activeCommand()?.hint ?? "") : "";
  if (!active && mode.name === "sketch") {
    const toolHints: Record<string, string> = {
      select: "Drag points to adjust · click to select",
      line: "Click points to chain lines · double-click / Esc to end",
      rect: "Click two corners",
      centerRect: "Click centre, then a corner",
      circle: "Click centre, then a point on the circle",
      arc3: "Click start, end, then a point on the arc",
      polygon: "Click centre, then a vertex",
      slot: "Click two centres, then the radius",
      point: "Click to place points",
      dimension:
        "Click an entity or two points · Ctrl-click a line, then a line or point · right-click a dimension to change its kind",
      project:
        "Click a model edge to create a linked purple reference · source must precede this sketch",
      trim: "Click a section between intersections, or drag across sections, to remove · Esc cancels",
      extend:
        "Click near the endpoint to extend to the next boundary · Esc cancels",
      offset:
        "Ctrl-click to add/remove curves · select a connected chain · preview then Create offset",
    };
    hint = toolHints[mode.tool] ?? "";
  }

  return (
    <>
      {(showJob && jobStartedAt !== null) || hint ? (
        <div className="viewport-hint">
          {showJob && jobStartedAt !== null ? (
            <>
              {job ? `${job.label} · ${job.done} of ${job.total}` : "Working…"}{" "}
              <button
                className="btn"
                style={{ pointerEvents: "auto" }}
                onClick={() => void cancelJob()}
              >
                Cancel
              </button>
            </>
          ) : (
            hint
          )}
        </div>
      ) : null}
      <SketchStatus />
      <PickReadout />
    </>
  );
}
