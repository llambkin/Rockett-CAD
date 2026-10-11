import { useMemo } from "react";
import { sketchConstraintsHold, type SketchSolveStatus } from "@rockett/shared";
import { useStore } from "../store";

export function SketchStatus() {
  const active = useStore((s) => s.active);
  const evaluation = useStore((s) => s.evaluation);
  const draftSketch = useStore((s) => s.draftSketch);
  const willSettle = useMemo(
    () => (draftSketch ? sketchConstraintsHold(draftSketch) === false : false),
    [draftSketch?.entities, draftSketch?.constraints],
  );
  if (active?.id !== "design.sketch" || !draftSketch || !evaluation)
    return null;
  const solved = evaluation.sketches.find(
    (s) => s.featureId === draftSketch.id,
  );
  const status = solved?.solveStatus ?? "unconstrained";
  const dof = solved?.dof ?? 0;
  const map: Record<SketchSolveStatus, { label: string; cls: string }> = {
    unconstrained: { label: `Unconstrained (${dof} DOF)`, cls: "warn" },
    partially_constrained: {
      label: `Partially constrained (${dof} DOF)`,
      cls: "warn",
    },
    fully_constrained: { label: "Fully constrained", cls: "ok" },
    over_constrained: { label: "Over-constrained!", cls: "err" },
  };
  const sketchBadge = map[status];

  return (
    <div className={`sketch-status ${sketchBadge.cls}`}>
      {sketchBadge.label}
      {willSettle && solved && solved.solveStatus !== "over_constrained" && (
        <div>Sketch will settle at the next edit.</div>
      )}
    </div>
  );
}
