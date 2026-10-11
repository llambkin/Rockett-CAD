import {
  featureParams,
  targets as targetInput,
} from "./commands/featureCommand";
import {
  autoTargetsAt,
  type AutoTargets,
  type CadDocument,
  type Feature,
  type NamingVersion,
} from "@rockett/shared";
import { createLivePreview } from "./livePreview";
import { previewBodies, useStore } from "./store";

type State = ReturnType<typeof useStore.getState>;
type ToolTargets = { targets?: string[]; autoTargets?: AutoTargets };

export function several(operation: string, namingVersion?: NamingVersion) {
  return operation === "cut" || (operation === "join" && namingVersion === 2);
}

export function targetOperation(
  dialog: string,
  params: { operation?: string | undefined; embossMode?: string | undefined },
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

type Params = { id?: string | undefined; targets?: string[] | undefined };

function edited(document: CadDocument | null, id: string | undefined) {
  const features = document?.features ?? [];
  const at = features.findIndex((f) => f.id === id);
  return at < 0
    ? { earlier: features }
    : { feature: features[at] as ToolTargets, earlier: features.slice(0, at) };
}

export const storedAuto = (document: CadDocument | null, id?: string) =>
  edited(document, id).feature?.autoTargets;

function autoForm(s: State, id: string | undefined): ToolTargets {
  const { feature, earlier } = edited(s.document, id);
  if (feature?.autoTargets) return { autoTargets: feature.autoTargets };
  if (feature && !feature.targets?.length) return {};
  const bodyIds = previewBodies(s).map((b) => b.bodyId);
  return { autoTargets: autoTargetsAt(bodyIds, s.view.hidden.bodies, earlier) };
}

export function toolTargets(
  operation: string,
  params: Params,
  namingVersion?: NamingVersion,
): ToolTargets {
  const ids = chosenTargets(operation, params.targets, namingVersion);
  if (ids.length > 0) return { targets: ids };
  if (operation === "newBody" || namingVersion !== 2) return {};
  return autoForm(useStore.getState(), params.id);
}

export function dialogTargets(): ToolTargets {
  const s = useStore.getState();
  if (s.active?.id !== "design.feature") return {};
  if (!s.active.state.inputs.picks().includes(targetInput)) return {};
  return toolTargets(
    targetOperation(s.active.state.type, featureParams(s)),
    featureParams(s),
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
  const { targets, autoTargets } = feature as ToolTargets;
  if (targets?.length) return { targets } as Partial<Feature>;
  return (autoTargets ? { autoTargets } : {}) as Partial<Feature>;
}

export const dragPreview = createLivePreview({ send: previewEdit });
