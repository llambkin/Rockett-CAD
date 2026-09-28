import type { ComponentType } from "react";
import {
  createRegistry,
  type Feature,
  type FeatureType,
} from "@rockett/shared";
import type { PickInput } from "../dialogPicks";
import { useStore, type Selection } from "../store";

export type DialogParams = Record<string, any>;
export type PickState = ReturnType<typeof useStore.getState>;

export interface FeatureFormProps {
  params: DialogParams;
  setParams: (patch: DialogParams) => void;
}

export interface FeaturePanelProps {
  editId?: string | undefined;
  onClose: () => void;
  cancelPreview: () => void;
}

type Build<F extends Feature> = (
  params: DialogParams,
  selection: Selection[],
) => F | { error: string };

interface FeatureUIBase<F extends Feature> {
  type: F["type"];
  icon: string;
  title: string;
  group: string;
  picks: readonly PickInput[];
  picksFor?: (params: DialogParams) => readonly PickInput[];
  onPick?(pick: Selection, s: PickState): Promise<void> | undefined;
  onParamsChange?(params: DialogParams): DialogParams | undefined;
}

interface DialogUI<F extends Feature> {
  type: F["type"] & FeatureType;
  prefill(f: F): { params: DialogParams; selection: Selection[] };
}

export type FeatureUI<F extends Feature = Feature> = FeatureUIBase<F> &
  (
    | (DialogUI<F> & {
        Form: ComponentType<FeatureFormProps>;
        build: Build<F>;
        Panel?: never;
      })
    | (DialogUI<F> & {
        Panel: ComponentType<FeaturePanelProps>;
        build?: Build<F>;
        Form?: never;
      })
    | {
        open(f: F): Promise<void>;
        prefill?: never;
        Form?: never;
        Panel?: never;
        build?: never;
      }
  );

export type DialogFeatureUI = Extract<FeatureUI, { prefill: unknown }>;

async function openInDialog(ui: DialogFeatureUI, f: Feature): Promise<void> {
  if (useStore.getState().mode.name === "sketch") {
    await useStore.getState().finishSketch();
    if (useStore.getState().mode.name === "sketch") return;
  }
  const s = useStore.getState();
  const { params, selection } = ui.prefill(f);
  s.setMode({ name: "dialog", dialog: ui.type, editFeatureId: f.id });
  s.setDialogParams(params);
  s.setSelection(selection);
}

const featureUIs = createRegistry<
  FeatureUI & { open(f: Feature): Promise<void> }
>("feature UI", (ui) => ui.type);

export function registerFeatureUI(ui: FeatureUI): () => void {
  if (!ui.prefill) return featureUIs.register(ui);
  return featureUIs.register({ ...ui, open: (f) => openInDialog(ui, f) });
}

export const featureUI = featureUIs.get;
