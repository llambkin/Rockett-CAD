import { useEffect, useRef, useState } from "react";
import type { EvaluateResult } from "@rockett/shared";
import { api } from "./api";
import { createLivePreview } from "./livePreview";
import { useStore } from "./store";

function createTimelinePeek(blocked: () => boolean) {
  let shown: { saved: EvaluateResult; peek: EvaluateResult } | null = null;
  let seq = 0;
  const live = createLivePreview({
    send: async (fid) => {
      const { document, evaluation } = useStore.getState();
      const index = document?.features.findIndex((f) => f.id === fid) ?? -1;
      if (blocked() || !document || !evaluation || index < 0) return;
      const token = ++seq;
      const peek = await api.evaluate(document.id, index + 1).catch(() => null);
      const now = useStore.getState();
      if (
        !peek ||
        token !== seq ||
        blocked() ||
        now.document !== document ||
        now.evaluation !== evaluation
      )
        return;
      shown = { saved: evaluation, peek };
      useStore.setState({ evaluation: peek });
    },
  });
  const leave = () => {
    live.cancel();
    seq++;
    if (shown && useStore.getState().evaluation === shown.peek)
      useStore.setState({ evaluation: shown.saved });
    shown = null;
  };
  return {
    enter(featureId: string) {
      leave();
      live.dwell(featureId, {});
    },
    leave,
  };
}

export function useTimelinePeek(quickEditOpen: boolean) {
  const busy = useStore((s) => s.busy);
  const idle = useStore((s) => s.mode.name === "idle");
  const blocked = busy || !idle || quickEditOpen;
  const block = useRef(blocked);
  block.current = blocked;
  const [peek] = useState(() => createTimelinePeek(() => block.current));
  useEffect(() => {
    if (blocked) peek.leave();
  }, [blocked, peek]);
  useEffect(() => peek.leave, [peek]);
  return peek;
}
