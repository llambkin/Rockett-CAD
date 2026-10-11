import { useEffect, useState } from "react";
import {
  filletSets,
  formatLength,
  withFilletSets,
  type Feature,
  type SizedFeature,
  type SizeLimit,
  type Units,
} from "@rockett/shared";
import { api } from "../../api";
import { TIMING_MS } from "../../tunables";
import { dialogFeatureId, useStore } from "../../store";
import { featureParams } from "../../commands/featureCommand";
import { useSetting } from "../../settings";

const UP_TO = { works: "Works up to", untried: "smaller" };
const FROM = { untried: "larger", scope: "" };
const SIZE_TEXT: Record<
  SizedFeature["type"],
  { works: string; scope: string; untried: string }
> = {
  fillet: { ...UP_TO, scope: " on these edges" },
  chamfer: { ...UP_TO, scope: " on these edges" },
  shell: { ...UP_TO, scope: " for this body" },
  offsetFace: { ...UP_TO, scope: " inward on these faces" },
  extrude: { ...FROM, works: "Cuts through all from" },
  linearPattern: { ...FROM, works: "Copies stay apart from" },
};

function sizeText(
  limit: SizeLimit,
  feature: SizedFeature,
  units: Units,
): string | null {
  const { works, scope, untried } = SIZE_TEXT[feature.type];
  switch (limit.kind) {
    case "upTo":
      return `${works} about ${formatLength(limit.size, units)}${scope}`;
    case "smooth":
      return "No corner: the faces meet flat or smoothly";
    case "none":
      return `Fails at every size tried, down to ${formatLength(limit.below, units)}`;
    case "stopped":
      if ("size" in limit)
        return `${works} about ${formatLength(limit.size, units)}, stopped early`;
      return `Stopped early: fails at ${formatLength(limit.below, units)}, ${untried} sizes not checked`;
    case "slow":
      return "Too slow to find the usable size";
    case "untouched":
      return null;
  }
}

function sizePicks(draft: Feature | null): string | null {
  switch (draft?.type) {
    case "shell":
      return draft.openFaces.length || draft.body !== undefined
        ? JSON.stringify([draft.openFaces, draft.body])
        : null;
    case "fillet":
    case "chamfer":
      return (draft.type === "fillet"
        ? draft.filletType
        : draft.chamferType) === "equalDistance"
        ? JSON.stringify([
            draft.edges,
            draft.faces,
            draft.features,
            draft.tangentChain,
            draft.type === "fillet" && [
              draft.betweenFaces,
              draft.betweenFeatures,
            ],
          ])
        : null;
    case "extrude":
      return draft.operation === "cut" &&
        (draft.profiles.length || draft.faces?.length)
        ? JSON.stringify([
            draft.profiles,
            draft.faces,
            draft.targets,
            draft.direction,
            draft.distance < 0,
            draft.startOffset,
          ])
        : null;
    case "linearPattern":
      return draft.bodies.length
        ? JSON.stringify([
            draft.bodies,
            draft.direction,
            draft.count,
            draft.spacing < 0,
          ])
        : null;
    case "offsetFace":
      return draft.faces.length && draft.distance < 0
        ? JSON.stringify(draft.faces)
        : null;
    default:
      return null;
  }
}

function sizePosition(id: string): number {
  const { document: before, active } = useStore.getState();
  const own = dialogFeatureId(active) ?? id;
  const edited = before!.features.findIndex((f) => f.id === own);
  if (edited >= 0) return edited;
  return Math.min(before!.timelinePosition, before!.features.length);
}

function activeFirst(draft: Feature | null, active: number): Feature | null {
  if (draft?.type !== "fillet") return draft;
  const sets = filletSets(draft);
  const [set] = sets.splice(active, 1);
  return set ? withFilletSets(draft, [set, ...sets]) : draft;
}

export function SizeLimitHint({ draft: built }: { draft: Feature | null }) {
  const active = useStore((s) => Number(featureParams(s).activeSet ?? 0));
  const draft = activeFirst(built, active);
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
    const feature = draft as SizedFeature;
    const position = sizePosition(feature.id);
    const ask = window.setTimeout(() => {
      api.sizeLimit(projectId, feature, position).then(
        (limit) => current && setHint({ key, result: limit }),
        () =>
          current &&
          setHint({ key, result: "Could not check the usable size" }),
      );
    }, TIMING_MS.previewDebounce);
    return () => {
      current = false;
      window.clearTimeout(ask);
    };
  }, [projectId, key]);
  if (!key) return null;
  const text =
    hint?.key !== key
      ? "Checking the usable size"
      : typeof hint.result === "string"
        ? hint.result
        : sizeText(hint.result, draft as SizedFeature, units);
  return text && <div className="field-hint">{text}</div>;
}
