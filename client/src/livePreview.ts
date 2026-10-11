import type { FaceInfo, Feature, MeshPayload } from "@rockett/shared";
import { meshOf, type LayerBody } from "./three/meshes";
import type { ThemeColor } from "./theme/tokens";
import { TIMING_MS } from "./tunables";

type Send<P> = (featureId: string, patch: P) => Promise<void>;

export function createLivePreview<
  P extends Partial<Feature> = Partial<Feature>,
>({
  send,
  dwellMs = TIMING_MS.previewDebounce,
  now = () => performance.now(),
}: {
  send: Send<P>;
  dwellMs?: number;
  now?: () => number;
}) {
  let last = -Infinity;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    during(featureId: string, patch: P) {
      const t = now();
      if (inFlight || t - last <= TIMING_MS.dragThrottle) return;
      last = t;
      inFlight = true;
      void send(featureId, patch).finally(() => {
        inFlight = false;
      });
    },
    dwell(featureId: string, patch: P) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        void send(featureId, patch);
      }, dwellMs);
    },
    commit(featureId: string, patch: P) {
      cancel();
      void send(featureId, patch);
    },
    cancel,
  };
}

function removesMaterial(feature: Feature): boolean {
  switch (feature.type) {
    case "extrude":
    case "revolve":
    case "sweep":
    case "loft":
    case "combine":
      return feature.operation === "cut" || feature.operation === "intersect";
    case "emboss":
      return feature.mode === "deboss";
    case "offsetFace":
      return feature.distance < 0;
    case "shell":
    case "fillet":
    case "chamfer":
      return true;
    default:
      return false;
  }
}

export interface PreviewTint {
  tint: ThemeColor;
  ranges: { start: number; count: number }[];
}

export interface PreviewGhost extends PreviewTint {
  body: LayerBody;
}

function sameTriangles(
  a: MeshPayload,
  fa: FaceInfo,
  b: MeshPayload,
  fb: FaceInfo,
): boolean {
  if (fa.count !== fb.count) return false;
  for (let i = 0; i < fb.count; i++) {
    const pa = a.indices[fa.start + i]! * 3;
    const pb = b.indices[fb.start + i]! * 3;
    for (let k = 0; k < 3; k++)
      if (a.positions[pa + k] !== b.positions[pb + k]) return false;
  }
  return true;
}

function changedFaces(old: MeshPayload | undefined, body: MeshPayload) {
  if (!old) return [{ start: 0, count: body.indices.length }];
  const before = new Map(old.faces.map((f) => [f.name, f]));
  const added = body.faces.filter((f) => !before.has(f.name));
  const changed =
    added.length > 0
      ? added
      : body.faces.filter(
          (f) => !sameTriangles(old, before.get(f.name)!, body, f),
        );
  return changed.map(({ start, count }) => ({ start, count }));
}

export function previewTints(
  feature: Feature,
  before: readonly LayerBody[],
  after: readonly LayerBody[],
): Map<string, PreviewTint> {
  const tint = removesMaterial(feature) ? "preview-cut" : "preview-add";
  const old = new Map(before.map((b) => [b.bodyId, b]));
  const tints = new Map<string, PreviewTint>();
  for (const body of after) {
    const base = old.get(body.bodyId);
    if (base?.meshKey === body.meshKey) continue;
    const shape = meshOf(body);
    const baseShape = base && meshOf(base);
    if (!shape || (base && !baseShape)) continue;
    const ranges = changedFaces(baseShape, shape);
    if (ranges.length > 0) tints.set(body.bodyId, { tint, ranges });
  }
  return tints;
}
