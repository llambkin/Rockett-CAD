import { useEffect, useState } from "react";
import { useStore } from "../store";
import { sketchHints } from "../commands/sketch";
import { activeCommand } from "../commands/active";
import { TIMING_MS } from "../tunables";
import { SketchStatus } from "./SketchStatus";
import { PickReadout } from "./PickReadout";

export function ViewportHud() {
  const active = useStore((s) => s.active);
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
  if (active?.id === "design.sketch") {
    hint = sketchHints[active.state.tool];
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
