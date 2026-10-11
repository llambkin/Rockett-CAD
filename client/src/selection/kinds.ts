import type { Active } from "../commands/active";
import type { HighlightContext, HighlightStyle } from "./highlights";
import {
  createRegistry,
  faceMadeBy,
  type EdgeRef,
  type FaceRef,
  type OriginAxis,
  type PlaneRef,
  type PointRef,
  type ProfileRef,
  REGISTRY_ID,
  type VertexRef,
} from "@rockett/shared";

export type CoreSelection =
  | { kind: "body"; bodyId: string }
  | { kind: "face"; bodyId: string; faceName: string }
  | { kind: "edge"; bodyId: string; edgeName: string }
  | { kind: "vertex"; bodyId: string; vertexName: string }
  | { kind: "plane"; ref: PlaneRef; label: string }
  | { kind: "axis"; axis: OriginAxis }
  | { kind: "profile"; sketchId: string; profileId: string }
  | { kind: "sketch"; sketchId: string }
  | {
      kind: "sketchEntity";
      sketchId: string;
      entityId: string;
      piece?: number[];
    }
  | { kind: "sketchPoint"; sketchId: string; entityId: string }
  | { kind: "feature"; featureId: string };

export type ExtensionSelection = {
  kind: `${string}.${string}`;
  [key: string]: unknown;
};
export type Selection = CoreSelection | ExtensionSelection;
export function selectionBeforeCommand(s: {
  active: Active | null;
  selection: Selection[];
}): Selection[] {
  return s.active?.state && "selectionBefore" in s.active.state
    ? s.active.state.selectionBefore
    : s.selection;
}

type Kind = Selection["kind"];
type SelectionOf<K extends Kind> = K extends CoreSelection["kind"]
  ? Extract<CoreSelection, { kind: K }>
  : ExtensionSelection & { kind: K };

interface CoreRefs {
  body: string;
  face: FaceRef;
  edge: EdgeRef;
  vertex: VertexRef;
  plane: PlaneRef;
  axis: { kind: "originAxis"; axis: OriginAxis };
  profile: ProfileRef;
  sketch: string;
  sketchEntity: Omit<SelectionOf<"sketchEntity">, "kind">;
  sketchPoint: Extract<PointRef, { kind: "sketchPoint" }>;
  feature: string;
}
type RefOf<K extends Kind> = K extends keyof CoreRefs ? CoreRefs[K] : unknown;

export interface SelectionKind<K extends Kind = Kind> {
  kind: K;
  key(s: SelectionOf<K>): string;
  toRef: (s: SelectionOf<K>) => RefOf<K>;
  fromRef(ref: RefOf<K>): SelectionOf<K>;
  highlight(
    s: SelectionOf<K>,
    style: HighlightStyle,
    ctx: HighlightContext,
  ): void;
}

interface RegisteredKind {
  kind: Kind;
  key(s: Selection): string;
  toRef(s: Selection): unknown;
  fromRef(ref: unknown): Selection;
  highlight(s: Selection, style: HighlightStyle, ctx: HighlightContext): void;
}

const registry = createRegistry<RegisteredKind>(
  "selection kind",
  (k) => k.kind,
);
const coreKinds = new Set<CoreSelection["kind"]>();

function registerCore<K extends CoreSelection["kind"]>(
  entry: SelectionKind<K>,
) {
  coreKinds.add(entry.kind);
  registerSelectionKind(entry);
}

export const isCoreSelection = (s: Selection): s is CoreSelection =>
  coreKinds.has(s.kind as CoreSelection["kind"]);

export function registerSelectionKind<K extends Kind>(
  entry: SelectionKind<K>,
): () => void {
  if (
    !coreKinds.has(entry.kind as CoreSelection["kind"]) &&
    !REGISTRY_ID.test(entry.kind)
  )
    throw new Error(`Invalid selection kind: ${entry.kind}`);
  return registry.register({
    kind: entry.kind,
    key: (s) => entry.key(s as SelectionOf<K>),
    toRef: (s) => entry.toRef(s as SelectionOf<K>),
    fromRef: (ref) => entry.fromRef(ref as RefOf<K>),
    highlight: (s, style, ctx) =>
      entry.highlight(s as SelectionOf<K>, style, ctx),
  });
}

export const selectionKinds = registry.list;

function requiredKind(kind: Kind) {
  const entry = registry.get(kind);
  if (!entry) throw new Error(`Unregistered selection kind: ${kind}`);
  return entry;
}

export const selectionKey = (s: Selection): string =>
  requiredKind(s.kind).key(s);

export function toRef<S extends Selection>(s: S): RefOf<S["kind"]> {
  return requiredKind(s.kind).toRef(s) as RefOf<S["kind"]>;
}

export function fromRef<K extends Kind>(
  kind: K,
  ref: RefOf<K>,
): SelectionOf<K> {
  return requiredKind(kind).fromRef(ref) as SelectionOf<K>;
}

export function refsOf<K extends Kind>(
  selection: readonly Selection[],
  kind: K,
): RefOf<K>[] {
  const entry = requiredKind(kind);
  return selection
    .filter((s) => s.kind === kind)
    .map((s) => entry.toRef(s) as RefOf<K>);
}

registerCore<"body">({
  kind: "body",
  highlight: (s, style, ctx) => ctx.body(s.bodyId, null, style),
  key: (s) => `body:${s.bodyId}`,
  toRef: (s) => s.bodyId,
  fromRef: (bodyId) => ({ kind: "body", bodyId }),
});
registerCore<"face">({
  kind: "face",
  highlight: (s, style, ctx) => ctx.face(s.bodyId, s.faceName, style),
  key: (s) => `face:${s.bodyId}:${s.faceName}`,
  toRef: (s) => ({ kind: "face", bodyId: s.bodyId, faceName: s.faceName }),
  fromRef: (ref) => ({
    kind: "face",
    bodyId: ref.bodyId,
    faceName: ref.faceName,
  }),
});
registerCore<"edge">({
  kind: "edge",
  highlight: (s, style, ctx) =>
    ctx.line(
      ctx.mesh(s.bodyId)?.edges.find((edge) => edge.name === s.edgeName)
        ?.polyline,
      style,
    ),
  key: (s) => `edge:${s.bodyId}:${s.edgeName}`,
  toRef: (s) => ({ kind: "edge", bodyId: s.bodyId, edgeName: s.edgeName }),
  fromRef: (ref) => ({
    kind: "edge",
    bodyId: ref.bodyId,
    edgeName: ref.edgeName,
  }),
});
registerCore<"vertex">({
  kind: "vertex",
  highlight: (s, style, ctx) =>
    ctx.point(
      ctx
        .mesh(s.bodyId)
        ?.vertices.find((vertex) => vertex.name === s.vertexName)?.position,
      style,
    ),
  key: (s) => `vertex:${s.bodyId}:${s.vertexName}`,
  toRef: (s) => ({
    kind: "vertex",
    bodyId: s.bodyId,
    vertexName: s.vertexName,
  }),
  fromRef: (ref) => ({
    kind: "vertex",
    bodyId: ref.bodyId,
    vertexName: ref.vertexName,
  }),
});
registerCore<"plane">({
  kind: "plane",
  highlight: (s, style, ctx) => ctx.plane(s.ref, style),
  key: (s) => `plane:${JSON.stringify(s.ref)}`,
  toRef: (s) => s.ref,
  fromRef: (ref) => ({
    kind: "plane",
    ref,
    label: ref.kind === "origin" ? `${ref.plane} Plane` : "Plane",
  }),
});
registerCore<"axis">({
  kind: "axis",
  highlight: (s, style, ctx) =>
    ctx.line(
      ctx.sources.originAxisLines.get(s.axis)?.geometry.getAttribute("position")
        .array,
      style,
    ),
  key: (s) => `axis:${s.axis}`,
  toRef: (s) => ({ kind: "originAxis", axis: s.axis }),
  fromRef: (ref) => ({ kind: "axis", axis: ref.axis }),
});
registerCore<"profile">({
  kind: "profile",
  highlight: () => {},
  key: (s) => `profile:${s.sketchId}:${s.profileId}`,
  toRef: (s) => ({ sketchId: s.sketchId, profileId: s.profileId }),
  fromRef: (ref) => ({
    kind: "profile",
    sketchId: ref.sketchId,
    profileId: ref.profileId,
  }),
});
registerCore<"sketch">({
  kind: "sketch",
  highlight: () => {},
  key: (s) => `sketch:${s.sketchId}`,
  toRef: (s) => s.sketchId,
  fromRef: (sketchId) => ({ kind: "sketch", sketchId }),
});
registerCore<"sketchEntity">({
  kind: "sketchEntity",
  highlight: () => {},
  key: (s) => `se:${s.sketchId}:${s.entityId}`,
  toRef: (s) => ({
    sketchId: s.sketchId,
    entityId: s.entityId,
    ...(s.piece && { piece: s.piece }),
  }),
  fromRef: (ref) => ({ kind: "sketchEntity", ...ref }),
});
registerCore<"sketchPoint">({
  kind: "sketchPoint",
  highlight: () => {},
  key: (s) => `sp:${s.sketchId}:${s.entityId}`,
  toRef: (s) => ({
    kind: "sketchPoint",
    sketchId: s.sketchId,
    entityId: s.entityId,
  }),
  fromRef: (ref) => ({
    kind: "sketchPoint",
    sketchId: ref.sketchId,
    entityId: ref.entityId,
  }),
});
registerCore<"feature">({
  kind: "feature",
  highlight: (s, style, ctx) => {
    for (const bodyId of ctx.sources.bodies.keys())
      for (const face of ctx.mesh(bodyId)?.faces ?? [])
        if (faceMadeBy(s.featureId, face.name))
          ctx.face(bodyId, face.name, style);
  },
  key: (s) => `feature:${s.featureId}`,
  toRef: (s) => s.featureId,
  fromRef: (featureId) => ({ kind: "feature", featureId }),
});

export function highlightSelection(
  s: Selection,
  style: HighlightStyle,
  ctx: HighlightContext,
): void {
  requiredKind(s.kind).highlight(s, style, ctx);
}
