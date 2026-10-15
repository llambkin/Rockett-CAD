import type { BodyPayload, FaceInfo, Feature } from "@rockett/shared";
import type { ThemeColor } from "./theme/tokens";

type Send = (featureId: string, patch: Partial<Feature>) => Promise<void>;

export const PREVIEW_DWELL_MS = 300;

export function createLivePreview({
  send,
  intervalMs = 250,
  dwellMs = PREVIEW_DWELL_MS,
  now = () => performance.now(),
}: {
  send: Send;
  intervalMs?: number;
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
    during(featureId: string, patch: Partial<Feature>) {
      const t = now();
      if (inFlight || t - last <= intervalMs) return;
      last = t;
      inFlight = true;
      void send(featureId, patch).finally(() => {
        inFlight = false;
      });
    },
    dwell(featureId: string, patch: Partial<Feature>) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        void send(featureId, patch);
      }, dwellMs);
    },
    commit(featureId: string, patch: Partial<Feature>) {
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
  body: BodyPayload;
}

function sameTriangles(
  a: BodyPayload,
  fa: FaceInfo,
  b: BodyPayload,
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

function changedFaces(old: BodyPayload | undefined, body: BodyPayload) {
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
  before: BodyPayload[],
  after: BodyPayload[],
): Map<string, PreviewTint> {
  const tint = removesMaterial(feature) ? "preview-cut" : "preview-add";
  const old = new Map(before.map((b) => [b.bodyId, b]));
  const tints = new Map<string, PreviewTint>();
  for (const body of after) {
    const base = old.get(body.bodyId);
    if (base?.meshKey === body.meshKey) continue;
    const ranges = changedFaces(base, body);
    if (ranges.length > 0) tints.set(body.bodyId, { tint, ranges });
  }
  return tints;
}
