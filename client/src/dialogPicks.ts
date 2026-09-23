/** What each feature dialog wants picked in the viewport. */

import type { DialogType, Selection } from "./store";

export interface DialogPicks {
  profiles?: boolean;
  edges?: boolean;
  faces?: boolean;
  bodies?: boolean;
  planes?: boolean;
  /** Sketch lines are pickable (revolve / circular-pattern axes). */
  sketchLines?: boolean;
}

export const DIALOG_PICKS: Record<DialogType, DialogPicks> = {
  importStep: {},
  extrude: { profiles: true, faces: true },
  revolve: { profiles: true, edges: true, sketchLines: true },
  sweep: { profiles: true },
  loft: { profiles: true },
  emboss: { profiles: true },
  fillet: { edges: true },
  chamfer: { edges: true },
  shell: { faces: true },
  combine: { bodies: true },
  splitBody: { bodies: true, planes: true, faces: true },
  offsetFace: { faces: true },
  mirror: { bodies: true, planes: true, faces: true },
  linearPattern: { bodies: true, edges: true },
  circularPattern: { bodies: true, edges: true, sketchLines: true },
  constructionPlane: { planes: true, faces: true },
  referenceImage: { planes: true, faces: true },
  move: { bodies: true },
  export: { bodies: true },
};

/** Keep only the selection entries a dialog can use. */
export function filterSelectionFor(
  dialog: DialogType,
  selection: Selection[],
): Selection[] {
  const picks = DIALOG_PICKS[dialog] ?? {};
  return selection.filter((s) => {
    switch (s.kind) {
      case "profile":
        return !!picks.profiles;
      case "edge":
        return !!picks.edges;
      case "face":
        return !!picks.faces;
      case "body":
        return !!picks.bodies;
      case "plane":
        return !!picks.planes;
      case "sketchEntity":
        return !!picks.sketchLines;
      default:
        return false;
    }
  });
}
