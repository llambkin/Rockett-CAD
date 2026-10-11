import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import type { EvaluateResult } from "@rockett/shared";
import { api } from "./api";
import { createLivePreview } from "./livePreview";
import { meshOf } from "./three/meshes";
import { useStore, isIdle, type Selection } from "./store";
import { TIMING_MS } from "./tunables";

const peeked = create<{ featureId: string | null }>(() => ({
  featureId: null,
}));

export const usePeekedFeature = () => peeked((s) => s.featureId);

const NAMER = /^(?:f|m|p\d+):/;

export function peekHighlight(
  evaluation: EvaluateResult,
  featureId: string,
): Selection[] {
  if (evaluation.planes.some((p) => p.featureId === featureId))
    return [
      { kind: "plane", ref: { kind: "construction", featureId }, label: "" },
    ];
  const modified = evaluation.featureStatuses.find(
    (s) => s.featureId === featureId,
  )?.modified;
  const made = (bodyId: string, name: string) => {
    const head = NAMER.exec(name)?.[0];
    return (
      (!!head && name.startsWith(`${featureId}:`, head.length)) ||
      !!modified?.[bodyId]?.includes(name)
    );
  };
  return evaluation.bodies.flatMap((b) =>
    (meshOf(b)?.faces ?? [])
      .filter((f) => made(b.bodyId, f.name))
      .map((f) => ({
        kind: "face" as const,
        bodyId: b.bodyId,
        faceName: f.name,
      })),
  );
}

function createTimelinePeek(blocked: () => boolean) {
  let shown: { saved: EvaluateResult; peek: EvaluateResult } | null = null;
  let seq = 0;
  const live = createLivePreview({
    dwellMs: TIMING_MS.timelinePeekDwell,
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
      peeked.setState({ featureId: fid });
    },
  });
  const leave = () => {
    live.cancel();
    seq++;
    peeked.setState({ featureId: null });
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
  const idle = useStore(isIdle);
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
