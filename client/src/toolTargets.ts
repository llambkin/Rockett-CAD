import type { Feature, NamingVersion } from "@rockett/shared";
import { createLivePreview } from "./livePreview";
import { useStore } from "./store";

export function several(operation: string, namingVersion?: NamingVersion) {
  return operation === "cut" || (operation === "join" && namingVersion === 2);
}

export function targetOperation(
  dialog: string,
  params: Record<string, any>,
): string {
  if (dialog === "emboss")
    return params.embossMode === "deboss" ? "cut" : "join";
  return params.operation ?? "join";
}

export function chosenTargets(
  operation: string,
  targets: string[] | undefined,
  namingVersion?: NamingVersion,
): string[] {
  if (operation === "newBody" || !targets) return [];
  return several(operation, namingVersion) ? targets : targets.slice(0, 1);
}

export function toolTargets(
  operation: string,
  targets: string[] | undefined,
  namingVersion?: NamingVersion,
): { targets?: string[] } {
  const ids = chosenTargets(operation, targets, namingVersion);
  return ids.length > 0 ? { targets: ids } : {};
}

export function dialogTargets(): { targets?: string[] } {
  const s = useStore.getState();
  if (s.active?.id !== "design.feature") return {};
  return toolTargets(
    targetOperation(s.active.state.type, s.dialogParams),
    s.dialogParams.targets,
    s.document?.namingVersion,
  );
}

export function previewEdit(fid: string, patch: object): Promise<void> {
  return useStore.getState().updateFeaturePreview(fid, {
    ...patch,
    ...dialogTargets(),
  } as Partial<Feature>);
}

export function storedTargets(feature: Feature): Partial<Feature> {
  const { targets } = feature as { targets?: string[] };
  return (targets?.length ? { targets } : {}) as Partial<Feature>;
}

export const dragPreview = createLivePreview({ send: previewEdit });
