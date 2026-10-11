import type {
  BodyPayload,
  CadDocument,
  EvaluateResult,
  SketchFeature,
} from "@rockett/shared";
import { savedRegionIds } from "../sketchUsage";
import { meshOf } from "../three/meshes";
import { isCoreSelection, selectionKey, type Selection } from "./kinds";

function numbered(kind: string, index: number, owner?: string): string {
  const name = index >= 0 ? `${kind} ${index + 1}` : kind;
  return owner ? `${name}, ${owner}` : name;
}

type Ranked<T> = { item: T; rank: number };

const ranks = new WeakMap<readonly object[], Map<string, Ranked<object>>>();

function ranked<T extends object>(
  list: readonly T[],
  id: (x: T) => string,
  group: (x: T) => string = () => "",
): Map<string, Ranked<T>> {
  const hit = ranks.get(list);
  if (hit) return hit as Map<string, Ranked<T>>;
  const counts = new Map<string, number>();
  const made = new Map<string, Ranked<T>>();
  for (const item of list) {
    const key = group(item);
    const rank = counts.get(key) ?? 0;
    counts.set(key, rank + 1);
    if (!made.has(id(item))) made.set(id(item), { item, rank });
  }
  ranks.set(list, made);
  return made;
}

export function pickLabel(
  pick: Selection,
  document: CadDocument | null,
  evaluation: EvaluateResult | null,
  bodies: BodyPayload[],
): string {
  if (!isCoreSelection(pick)) return selectionKey(pick);
  const feature = (id: string) =>
    document && ranked(document.features, (f) => f.id).get(id)?.item;
  const featureName = (id: string) => feature(id)?.name;
  if (pick.kind === "axis") return `${pick.axis} Axis`;
  if (pick.kind === "feature") return featureName(pick.featureId) || "Feature";
  if (pick.kind === "plane") {
    const ref = pick.ref;
    if (ref.kind === "origin") return `${ref.plane} Plane`;
    if (ref.kind === "construction")
      return featureName(ref.featureId) ?? "Plane";
    return pickLabel(ref.face, document, evaluation, bodies);
  }
  if ("bodyId" in pick) {
    const body = ranked(bodies, (b) => b.bodyId).get(pick.bodyId)?.item;
    if (pick.kind === "body") return body?.name ?? "Body";
    const shape = body && meshOf(body);
    const [kind, list, name]: [
      string,
      readonly { name: string }[] | undefined,
      string,
    ] =
      pick.kind === "face"
        ? ["Face", shape?.faces, pick.faceName]
        : pick.kind === "edge"
          ? ["Edge", shape?.edges, pick.edgeName]
          : ["Vertex", shape?.vertices, pick.vertexName];
    return numbered(
      kind,
      (list && ranked(list, (x) => x.name).get(name)?.rank) ?? -1,
      body?.name,
    );
  }
  const sketch = featureName(pick.sketchId);
  if (pick.kind === "sketch") return sketch ?? "Sketch";
  if (pick.kind === "profile") {
    const sk =
      evaluation &&
      ranked(evaluation.sketches, (s) => s.featureId).get(pick.sketchId)?.item;
    const [id = ""] = sk ? savedRegionIds(sk, pick.profileId) : [];
    return numbered(
      "Profile",
      (sk && ranked(sk.profiles, (x) => x.id).get(id)?.rank) ?? -1,
      sketch,
    );
  }
  const entities = (feature(pick.sketchId) as SketchFeature | undefined)
    ?.entities;
  const entity =
    entities &&
    ranked(
      entities,
      (e) => e.id,
      (e) => e.kind,
    ).get(pick.entityId);
  if (!entity) return numbered("Entity", -1, sketch);
  const { kind } = entity.item;
  return numbered(kind[0]!.toUpperCase() + kind.slice(1), entity.rank, sketch);
}
