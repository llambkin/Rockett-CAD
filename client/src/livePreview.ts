import type { Feature } from "@rockett/shared";

type Send = (featureId: string, patch: Partial<Feature>) => Promise<void>;

export function createLivePreview({
  intervalMs,
  send,
  now,
}: {
  intervalMs: number;
  send: Send;
  now: () => number;
}) {
  let last = -Infinity;
  let inFlight = false;
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
    commit(featureId: string, patch: Partial<Feature>) {
      void send(featureId, patch);
    },
  };
}
