import type { ComponentType } from "react";
import { createRegistry, type Feature } from "@rockett/shared";
import type { PickInput } from "../commands/featureCommand";
import type { useStore, Selection } from "../store";

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
  update: (patch: Partial<Feature>) => Promise<void>;
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
  open?(f: F): Promise<void>;
  type: F["type"];
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

const featureUIs = createRegistry<FeatureUI>("feature UI", (ui) => ui.type);

export const registerFeatureUI = featureUIs.register;
export const featureUI = featureUIs.get;
