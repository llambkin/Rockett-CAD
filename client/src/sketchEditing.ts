import type { CadDocument, SketchFeature } from "@rockett/shared";
import type { MutationResponse } from "./api";
import type { Active } from "./commands/active";
import type { Selection } from "./selection/kinds";

export function historyEditingState(
  active: Active | null,
  m: MutationResponse,
): {
  draftSketch: SketchFeature | null;
  selection: Selection[];
  active: Active | null;
} {
  const cleared = { active: null, selection: [] };
  if (active?.id === "design.sketch") {
    const feature = m.document.features.find(
      (f) => f.id === active.state.sketchId,
    );
    const solved = m.evaluation.sketches.find(
      (sk) => sk.featureId === active.state.sketchId,
    );
    if (feature?.type === "sketch" && solved)
      return {
        ...cleared,
        active: { ...active, state: { ...active.state, tool: "select" } },
        draftSketch: JSON.parse(
          JSON.stringify({ ...feature, entities: solved.entities }),
        ),
      };
  }
  return { ...cleared, draftSketch: null };
}

export function sketchEditingPosition(
  document: CadDocument,
  active: Active | null,
): number | undefined {
  if (active?.id !== "design.sketch") return undefined;
  const index = document.features.findIndex(
    (f) => f.id === active.state.sketchId && f.type === "sketch",
  );
  return index < 0 ? undefined : index + 1;
}
