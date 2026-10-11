import {
  collectTopoRefs,
  inputBodies,
  inputFeatures,
  refName,
  compareNames,
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type CadDocument,
  type EdgeRef,
  type FaceRef,
  type Feature,
  type FeatureStatus,
  type RefCandidate,
  type RefResolution,
  type RefSignature,
  type UnresolvedRef,
} from "@rockett/shared";
import { faces, scoped, type Shape } from "./kernel.js";
import { computeEdgeNames, namingVersion, type NamedBody } from "./naming.js";
import type { EvalState, FeatureOutcome } from "./features.js";
import { edgeSignature, faceSignature } from "./signature.js";
import { namesOf } from "./meshBody.js";

type Ref = FaceRef | EdgeRef;
type Kind = Ref["kind"];

const EDGE = /^e\[(.*)\]((?:~\d+)*)$/;

const untie = (name: string) => name.replace(/~\?\d+/g, "");

const stem = (name: string) => name.replace(/~\??\d+/g, "");

const within = (a: string, b: string) =>
  a === b || a.startsWith(`${b}~`) || b.startsWith(`${a}~`);

function paired(xs: string[], ys: string[]): boolean {
  const [first, ...rest] = xs;
  if (first === undefined) return ys.length === 0;
  return ys.some(
    (y, i) =>
      within(first, y) &&
      paired(
        rest,
        ys.filter((_, j) => j !== i),
      ),
  );
}

function related(kind: Kind, a: string, b: string): boolean {
  const [x, y] = [untie(a), untie(b)];
  if (kind === "face") return within(x, y);
  const [ex, ey] = [EDGE.exec(x), EDGE.exec(y)];
  return (
    !!ex &&
    !!ey &&
    within(ex[2]!, ey[2]!) &&
    paired(ex[1]!.split("|"), ey[1]!.split("|"))
  );
}

function faceParts(kind: Kind, name: string): string[] {
  const plain = untie(name);
  return kind === "face" ? [plain] : (EDGE.exec(plain)?.[1]?.split("|") ?? []);
}

const byBodyAndName = (a: RefCandidate, b: RefCandidate) =>
  compareNames(a.bodyId, b.bodyId) || compareNames(a.name, b.name);

class Topology {
  private readonly named = new Map<string, Map<string, Shape>>();
  private readonly signatures = new Map<Shape, RefSignature>();

  of(body: NamedBody, kind: Kind): Map<string, Shape> {
    const key = `${kind}\n${body.bodyId}`;
    const known = this.named.get(key);
    if (known) return known;
    const named =
      kind === "edge" ? computeEdgeNames(body).byName : namedFaces(body);
    this.named.set(key, named);
    return named;
  }

  signature(kind: Kind, shape: Shape): RefSignature {
    const known = this.signatures.get(shape);
    if (known) return known;
    const sig = kind === "face" ? faceSignature(shape) : edgeSignature(shape);
    this.signatures.set(shape, sig);
    return sig;
  }
}

function namedFaces(body: NamedBody): Map<string, Shape> {
  const named = new Map<string, Shape>();
  for (const face of faces(body.shape)) {
    const name = body.names.get(face);
    if (name && !named.has(name)) named.set(name, face);
  }
  return named;
}

function lineage(
  topology: Topology,
  body: NamedBody,
  kind: Kind,
  name: string,
): RefCandidate[] {
  return [...topology.of(body, kind).keys()]
    .filter((other) => related(kind, name, other))
    .map((other) => ({ bodyId: body.bodyId, name: other, basis: "lineage" }));
}

function aligned(kind: Kind, a: RefSignature, b: RefSignature): boolean {
  const dot = a.direction.reduce((sum, x, i) => sum + x * b.direction[i]!, 0);
  return (kind === "edge" ? Math.abs(dot) : dot) >= 1 - UNIT_DOT_TOL;
}

function gap(kind: Kind, found: RefSignature, sig: RefSignature): number {
  if (found.type !== sig.type || !aligned(kind, found, sig)) return Infinity;
  return Math.hypot(...found.point.map((x, i) => x - sig.point[i]!));
}

function nearest(
  topology: Topology,
  body: NamedBody,
  kind: Kind,
  sig: RefSignature,
): RefCandidate[] {
  const matches = [...topology.of(body, kind)].flatMap(([name, shape]) => {
    const distance = gap(kind, topology.signature(kind, shape), sig);
    return distance === Infinity ? [] : [{ name, gap: distance }];
  });
  const best = Math.min(...matches.map((m) => m.gap));
  return matches
    .filter((m) => m.gap <= best + LINEAR_TOL)
    .map((m) => ({ bodyId: body.bodyId, name: m.name, basis: "signature" }));
}

function suggestions(
  topology: Topology,
  bodies: ReadonlyMap<string, NamedBody>,
  ref: Ref,
): RefCandidate[] {
  const name = refName(ref);
  const parts = faceParts(ref.kind, name);
  const found = [...bodies.values()]
    .filter(
      (other) =>
        other.bodyId !== ref.bodyId &&
        [...namesOf(other)].some((face) =>
          parts.some((part) => within(untie(face), part)),
        ),
    )
    .flatMap((other) => lineage(topology, other, ref.kind, name));
  found.sort(byBodyAndName);
  return found;
}

function renumbered(
  topology: Topology,
  bodies: ReadonlyMap<string, NamedBody>,
  ref: Ref,
  shape: Shape,
): RefCandidate[] {
  const { kind, sig } = ref;
  if (!sig || namingVersion() === 1) return [];
  if (gap(kind, topology.signature(kind, shape), sig) <= LINEAR_TOL) return [];
  const family = stem(refName(ref));
  const parts = new Set(faceParts(kind, family));
  return [...bodies.values()]
    .filter((body) => [...namesOf(body)].some((face) => parts.has(stem(face))))
    .flatMap((body) =>
      [...topology.of(body, kind)]
        .filter(
          ([name, other]) =>
            related(kind, stem(name), family) &&
            gap(kind, topology.signature(kind, other), sig) <= LINEAR_TOL,
        )
        .map(([name]) => ({ bodyId: body.bodyId, name, basis: "signature" })),
    );
}

function resolveRef(
  topology: Topology,
  bodies: ReadonlyMap<string, NamedBody>,
  ref: Ref,
): RefResolution {
  const name = refName(ref);
  const body = bodies.get(ref.bodyId);
  const tied =
    ref.kind === "edge" &&
    name.includes("~?") &&
    namingVersion() === 2 &&
    ref.sig;
  const named =
    body && !name.includes("~?")
      ? topology.of(body, ref.kind).get(name)
      : undefined;
  const moved = named ? renumbered(topology, bodies, ref, named) : [];
  if (named && moved.length === 0) return { status: "resolved" };
  const lineal =
    moved.length > 0 || !body ? moved : lineage(topology, body, ref.kind, name);
  const candidates =
    tied && body
      ? lineal
          .filter(
            ({ name: other }) =>
              gap(
                ref.kind,
                topology.signature(
                  ref.kind,
                  topology.of(body, ref.kind).get(other)!,
                ),
                tied,
              ) <= LINEAR_TOL,
          )
          .map(({ bodyId, name: other }) => ({
            bodyId,
            name: other,
            basis: "signature" as const,
          }))
      : lineal.length === 0 && body && ref.sig
        ? nearest(topology, body, ref.kind, ref.sig)
        : lineal;
  if (tied && candidates.length === 1 && candidates[0]!.name === name)
    return { status: "resolved" };
  candidates.sort(byBodyAndName);
  const status =
    candidates.length === 0
      ? "missing"
      : candidates.length === 1
        ? "candidate"
        : "ambiguous";
  return {
    status,
    candidates,
    suggestions: suggestions(topology, bodies, ref),
  };
}

export function resolveRefs(
  bodies: ReadonlyMap<string, NamedBody>,
  refs: Ref[],
): RefResolution[] {
  return scoped(() => {
    const topology = new Topology();

    return refs.map((ref) => resolveRef(topology, bodies, ref));
  });
}

export function signatureCandidates(
  bodies: ReadonlyMap<string, NamedBody>,
  bodyIds: string[],
  ref: Ref,
): RefCandidate[] {
  return scoped(() => {
    const { sig } = ref;
    if (!sig) return [];
    const topology = new Topology();

    return bodyIds.flatMap((id) => {
      const body = bodies.get(id);
      return body ? nearest(topology, body, ref.kind, sig) : [];
    });
  });
}

export function unresolvedRefs(
  bodies: ReadonlyMap<string, NamedBody>,
  feature: Feature,
): UnresolvedRef[] {
  const refs = collectTopoRefs(feature);
  if (refs.length === 0) return [];
  return resolveRefs(bodies, refs).flatMap((resolution, i) =>
    resolution.status === "resolved" ? [] : [{ ref: refs[i]!, ...resolution }],
  );
}

export const describeRef = ({ ref, status, candidates }: UnresolvedRef) =>
  status === "missing"
    ? `${ref.kind} ${refName(ref)} no longer exists on ${ref.bodyId}`
    : `${ref.kind} ${refName(ref)} on ${ref.bodyId} is ${status}${ref.kind === "edge" && ref.sig && refName(ref).includes("~?") && status === "ambiguous" ? `: ${candidates.map((candidate) => candidate.name).join(", ")}` : ""}`;

export class BlockedFeature extends Error {
  constructor(
    message: string,
    readonly bodies: string[],
    readonly refs: UnresolvedRef[] = [],
  ) {
    super(message);
  }
}

export { inputBodies, inputFeatures } from "@rockett/shared";

export interface CrashFeature {
  featureId: string;
  featureKey: string;
}

const CRASH_BLOCKED_MESSAGE = "blocked by kernel crash in a dependent feature";

export function blockedFeatureIds(
  doc: CadDocument,
  statuses: FeatureStatus[],
  quarantine: CrashFeature[],
  keyAt: (index: number) => string,
) {
  const ids = new Set(
    statuses
      .filter((status) => status.error === CRASH_BLOCKED_MESSAGE)
      .map((status) => status.featureId),
  );
  for (const entry of quarantine)
    if (
      doc.features.some(
        (feature, index) =>
          !feature.suppressed &&
          feature.id === entry.featureId &&
          keyAt(index) === entry.featureKey,
      )
    )
      ids.add(entry.featureId);
  return ids;
}

export function blockedBodies(state: EvalState, feature: Feature) {
  const bodies = inputBodies(feature);
  const implicit =
    feature.type === "emboss" ||
    ((feature.type === "extrude" ||
      feature.type === "revolve" ||
      feature.type === "sweep" ||
      feature.type === "loft") &&
      feature.operation !== "newBody");
  if (implicit && (!("targets" in feature) || feature.targets === undefined))
    bodies.push(...state.bodies.keys());
  if (
    feature.type === "importStep" ||
    feature.type === "importMesh" ||
    implicit ||
    ("operation" in feature && feature.operation === "newBody")
  )
    bodies.push(`b:${feature.id}`);
  return new Set([...state.blocked, ...bodies]);
}

export function crashStatus(
  feature: Feature,
  key: string,
  quarantine: CrashFeature[],
  blocked: Set<string>,
): FeatureStatus | undefined {
  if (feature.suppressed) return;
  if (
    quarantine.some(
      (entry) => entry.featureId === feature.id && entry.featureKey === key,
    )
  )
    return {
      featureId: feature.id,
      status: "error",
      error: "kernel crashed evaluating this feature",
    };
  if (!inputFeatures(feature).some((id) => blocked.has(id))) return;
  blocked.add(feature.id);
  return {
    featureId: feature.id,
    status: "error",
    error: CRASH_BLOCKED_MESSAGE,
  };
}

function refuseBlocked(blocked: ReadonlySet<string>, inputs: string[]): void {
  const held = inputs.filter((id) => blocked.has(id));
  if (held.length > 0)
    throw new BlockedFeature(
      `blocked by unresolved references on ${held.join(", ")}`,
      inputs,
    );
}

function requireResolved(
  bodies: ReadonlyMap<string, NamedBody>,
  blocked: ReadonlySet<string>,
  feature: Feature,
): void {
  const inputs = inputBodies(feature);
  refuseBlocked(blocked, inputs);
  const refs = unresolvedRefs(bodies, feature);
  if (refs.length > 0)
    throw new BlockedFeature(refs.map(describeRef).join("; "), inputs, refs);
}

export function evaluateResolved(
  state: EvalState,
  feature: Feature,
  run: () => FeatureOutcome | void,
): FeatureOutcome | void {
  requireResolved(state.bodies, state.blocked, feature);
  const outcome = run();
  refuseBlocked(state.blocked, outcome?.targets ?? []);
  return outcome;
}
