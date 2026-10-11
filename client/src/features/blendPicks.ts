import type { FilletFeature } from "@rockett/shared";
import { fromRef, refsOf } from "../selection/kinds";
import type { Selection } from "../store";
import {
  edgePicks,
  edgeRefs,
  facePicks,
  faceRefs,
  keptRefs,
  storedFeature,
} from "./inputs";
import type { PickState, SharedInputParams } from "./registry";
import { tangentChain } from "./tangentChain";

type BlendPicks = Pick<FilletFeature, "edges" | "faces" | "features">;

export const blendHint = "click edges, faces or a timeline feature";

export function blendSources(
  id: string | undefined,
  selection: Selection[],
): BlendPicks | { error: string } {
  const edges = edgeRefs(selection);
  const faces = faceRefs(selection);
  const features = refsOf(selection, "feature");
  if (edges.length + faces.length + features.length === 0)
    return { error: "Select at least one edge, face or feature" };
  const stored = storedFeature(id);
  return {
    edges,
    ...keptRefs("faces", faces, stored),
    ...keptRefs("features", features, stored),
  };
}

export const blendSelection = (f: BlendPicks): Selection[] => [
  ...edgePicks(f.edges),
  ...facePicks(f.faces ?? []),
  ...(f.features ?? []).map((id) => fromRef("feature", id)),
];

export const refuseVertex =
  (message: string) =>
  (sel: Selection, s: PickState, params: SharedInputParams) => {
    if (sel.kind !== "vertex") return tangentChain(sel, s, params);
    s.setError(message);
    return Promise.resolve();
  };
