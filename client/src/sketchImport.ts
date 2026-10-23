import type { EvaluateResult, PlaneRef } from "@rockett/shared";
import type { Selection } from "./store";

export const INSERT_SVG_NEEDS_PLANE =
  "Select a planar face or a plane first, then Insert SVG to place it there.";

export function insertPlaneFor(
  selection: Selection[],
  evaluation: EvaluateResult | null,
): PlaneRef | null {
  for (const s of selection) {
    if (s.kind === "plane") return s.ref;
    if (
      s.kind === "face" &&
      evaluation?.bodies
        .find((b) => b.bodyId === s.bodyId)
        ?.faces.find((f) => f.name === s.faceName)?.surface.type === "plane"
    )
      return {
        kind: "face",
        face: { kind: "face", bodyId: s.bodyId, faceName: s.faceName },
      };
  }
  return null;
}
