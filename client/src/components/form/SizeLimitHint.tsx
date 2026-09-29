import { useEffect, useState } from "react";
import {
  formatLength,
  type Feature,
  type SizedFeature,
  type SizeLimit,
  type Units,
} from "@rockett/shared";
import { api } from "../../api";
import { PREVIEW_DEBOUNCE_MS } from "../../livePreview";
import { dialogFeatureId, useStore } from "../../store";
import { useSetting } from "../../settings";

const SIZE_SCOPE = {
  fillet: "on these edges",
  chamfer: "on these edges",
  shell: "for this body",
};

function sizeText(
  limit: SizeLimit,
  feature: SizedFeature,
  units: Units,
): string {
  switch (limit.kind) {
    case "upTo":
      return `Works up to about ${formatLength(limit.size, units)} ${SIZE_SCOPE[feature.type]}`;
    case "smooth":
      return "No corner: the faces meet flat or smoothly";
    case "none":
      return `Fails at every size tried, down to ${formatLength(limit.below, units)}`;
    case "stopped":
      if ("size" in limit)
        return `Works up to about ${formatLength(limit.size, units)}, stopped early`;
      return `Stopped early: fails at ${formatLength(limit.below, units)}, smaller sizes not checked`;
    case "slow":
      return "Too slow to find the usable size";
  }
}

function sizePicks(draft: Feature | null): string | null {
  if (draft?.type === "shell")
    return draft.openFaces.length ? JSON.stringify(draft.openFaces) : null;
  if (draft?.type !== "fillet" && draft?.type !== "chamfer") return null;
  return draft.edges.length
    ? JSON.stringify([draft.edges, draft.tangentChain])
    : null;
}

function sizePosition(id: string): number {
  const { document: before, mode } = useStore.getState();
  const own = dialogFeatureId(mode) ?? id;
  const edited = before!.features.findIndex((f) => f.id === own);
  if (edited >= 0) return edited;
  return Math.min(before!.timelinePosition, before!.features.length);
}

export function SizeLimitHint({ draft }: { draft: Feature | null }) {
  const units = useSetting("units.length");
  const projectId = useStore((s) => s.projectId);
  const key = sizePicks(draft);
  const [hint, setHint] = useState<{
    key: string;
    result: SizeLimit | string;
  } | null>(null);
  useEffect(() => {
    if (!key || !projectId) return;
    let current = true;
    const ask = window.setTimeout(() => {
      const feature = draft as SizedFeature;
      api.sizeLimit(projectId, feature, sizePosition(feature.id)).then(
        (limit) => current && setHint({ key, result: limit }),
        () =>
          current &&
          setHint({ key, result: "Could not check the usable size" }),
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      current = false;
      window.clearTimeout(ask);
    };
  }, [projectId, key]);
  if (!key) return null;
  return (
    <div className="field-hint">
      {hint?.key === key
        ? typeof hint.result === "string"
          ? hint.result
          : sizeText(hint.result, draft as SizedFeature, units)
        : "Checking the usable size"}
    </div>
  );
}
