import type { BodyPayload, Feature } from "@rockett/shared";
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

function sameNumbers(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameMesh(a: BodyPayload | undefined, b: BodyPayload): boolean {
  return (
    a === b ||
    (a !== undefined &&
      sameNumbers(a.positions, b.positions) &&
      sameNumbers(a.indices, b.indices))
  );
}

export function previewTints(
  feature: Feature,
  before: BodyPayload[],
  after: BodyPayload[],
): Map<string, ThemeColor> {
  const tint = removesMaterial(feature) ? "preview-cut" : "preview-add";
  const old = new Map(before.map((b) => [b.bodyId, b]));
  return new Map(
    after
      .filter((b) => !sameMesh(old.get(b.bodyId), b))
      .map((b) => [b.bodyId, tint]),
  );
}
