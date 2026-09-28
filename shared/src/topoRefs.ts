import type { EdgeRef, FaceRef, Feature } from "./model.js";
import { FEATURE_SCHEMAS, MAX_TARGETS } from "./schema/features.js";

export function topoRefPaths(
  feature: Feature,
): Array<[string, FaceRef | EdgeRef]> {
  const found: Array<[string, FaceRef | EdgeRef]> = [];
  const visit = (value: unknown, at: string): void => {
    if (typeof value !== "object" || value === null) return;
    const item = value as Record<string, unknown>;
    if (
      (item.kind === "face" && typeof item.faceName === "string") ||
      (item.kind === "edge" && typeof item.edgeName === "string")
    ) {
      found.push([at, value as FaceRef | EdgeRef]);
      return;
    }
    for (const [key, child] of Object.entries(item))
      visit(child, `${at}/${key}`);
  };
  visit(feature, "");
  return found;
}

export function collectTopoRefs(feature: Feature): Array<FaceRef | EdgeRef> {
  return topoRefPaths(feature).map(([, ref]) => ref);
}

const refKey = (ref: FaceRef | EdgeRef) =>
  `${ref.kind}\n${ref.bodyId}\n${ref.kind === "face" ? ref.faceName : ref.edgeName}`;

export function unsignedRefs(
  feature: Feature,
  previous?: Feature,
): Array<FaceRef | EdgeRef> {
  const known = new Map(
    (previous ? collectTopoRefs(previous) : []).map((r) => [refKey(r), r.sig]),
  );
  return collectTopoRefs(feature).filter((ref) => {
    const sig = ref.sig ?? known.get(refKey(ref));
    if (sig) ref.sig = sig;
    return !sig;
  });
}

export function lacksTargets(feature: Feature): boolean {
  return (
    !("targets" in feature) &&
    "targets" in FEATURE_SCHEMAS[feature.type].properties
  );
}

export function pinTargets(feature: Feature, targets: string[] | undefined) {
  if (lacksTargets(feature) && targets && targets.length <= MAX_TARGETS)
    Object.assign(feature, { targets });
}

export function startFirst(feature: Feature) {
  if (feature.type !== "extrude" && feature.type !== "revolve") return;
  const start = feature.faces?.[0]?.bodyId;
  if (feature.operation !== "join" || !start) return;
  if (feature.targets?.includes(start))
    feature.targets = [start, ...feature.targets.filter((id) => id !== start)];
}

export function compareNames(a: string, b: string): number {
  const x = a.match(/\d+|\D+/g) ?? [];
  const y = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const [p, q] = [x[i]!, y[i]!];
    if (p === q) continue;
    const numeric = /^\d/.test(p) && /^\d/.test(q);
    return (numeric && Number(p) - Number(q)) || (p < q ? -1 : 1);
  }
  return x.length - y.length;
}

export const bodyMadeBy = (featureId: string, bodyId: string) =>
  bodyId === `b:${featureId}` || bodyId.startsWith(`b:${featureId}:`);

export const derivedBodyId = (featureId: string, n: number) =>
  `b:${featureId}:${n}`;
