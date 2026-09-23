import type { Feature } from "@rockett/shared";

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
