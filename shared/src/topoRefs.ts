import type { AutoTargets, EdgeRef, FaceRef, Feature } from "./model.js";
import { featureInputs, featureSpec } from "./featureSpec.js";

export const topoRefPaths = (feature: Feature) =>
  featureInputs(feature).topology;

export function collectTopoRefs(feature: Feature): Array<FaceRef | EdgeRef> {
  return topoRefPaths(feature).map(([, ref]) => ref);
}

export const refName = (ref: FaceRef | EdgeRef) =>
  ref.kind === "face" ? ref.faceName : ref.edgeName;

const refKey = (ref: FaceRef | EdgeRef) =>
  `${ref.kind}\n${ref.bodyId}\n${refName(ref)}`;

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
    !("autoTargets" in feature) &&
    "targets" in (featureSpec(feature.type)?.paramsSchema.properties ?? {})
  );
}

export function pinTargets(feature: Feature, targets: string[] | undefined) {
  if (lacksTargets(feature) && targets) Object.assign(feature, { targets });
}

export function startBody(feature: Feature): string | undefined {
  if (feature.type !== "extrude" && feature.type !== "revolve") return;
  if (feature.operation === "join") return feature.faces?.[0]?.bodyId;
}

export function startFirst(feature: Feature) {
  const start = startBody(feature);
  if (start && "targets" in feature && feature.targets?.includes(start))
    feature.targets = [start, ...feature.targets.filter((id) => id !== start)];
}

export const autoTarget = (auto: AutoTargets | undefined, bodyId: string) =>
  !auto ||
  (!auto.exclude.includes(bodyId) &&
    auto.features.some((id) => bodyMadeBy(id, bodyId)));

export const autoTargetsAt = (
  bodyIds: string[],
  hidden: readonly string[],
  earlier: Feature[],
): AutoTargets => ({
  exclude: bodyIds.filter((id) => hidden.includes(id)),
  features: earlier
    .filter((f) => bodyIds.some((id) => bodyMadeBy(f.id, id)))
    .map((f) => f.id),
});

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

export function bodyMadeBy(featureId: string, bodyId: string) {
  const made = bodyId.slice(bodyId.indexOf(":") + 1);
  return (
    made !== bodyId && (made === featureId || made.startsWith(`${featureId}:`))
  );
}

export const faceMadeBy = (featureId: string, faceName: string) =>
  /^(?:f|m|p\d+):/.test(faceName) &&
  faceName.slice(faceName.indexOf(":") + 1).startsWith(`${featureId}:`);

export const derivedBodyId = (featureId: string, n: number) =>
  `b:${featureId}:${n}`;

export const moduleBodyId = (
  moduleId: string,
  featureId: string,
  key: string,
) => `${moduleId}:${featureId}:${key}`;

export const moduleBody = (bodyId: string) => !bodyId.startsWith("b:");
