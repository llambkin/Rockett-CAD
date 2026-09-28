import type { ComponentType } from "react";
import { createRegistry, type Feature } from "@rockett/shared";
import type { PickInput } from "../dialogPicks";
import type { Selection, useStore } from "../store";

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
  prefill(f: F): { params: DialogParams; selection: Selection[] };
  onPick?(pick: Selection, s: PickState): Promise<void> | undefined;
  onParamsChange?(params: DialogParams): DialogParams | undefined;
}

export type FeatureUI<F extends Feature = Feature> = FeatureUIBase<F> &
  (
    | { Form: ComponentType<FeatureFormProps>; build: Build<F>; Panel?: never }
    | {
        Panel: ComponentType<FeaturePanelProps>;
        build?: Build<F>;
        Form?: never;
      }
  );

const featureUIs = createRegistry<FeatureUI>("feature UI", (ui) => ui.type);

export const registerFeatureUI = featureUIs.register;
export const featureUI = featureUIs.get;
