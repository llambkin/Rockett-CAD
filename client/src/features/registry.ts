import { createElement, type ComponentType, type ReactNode } from "react";
import {
  createRegistry,
  type Feature,
  type CombineFeature,
  type ConstructionPlaneFeature,
  type EmbossFeature,
  type ExtrudeFeature,
  type FaceRef,
  type EdgeRef,
  type OriginAxis,
} from "@rockett/shared";
import type { PickInput } from "../commands/featureCommand";
import type { useStore, Selection } from "../store";

export type NumericInput = number | string;
export type InputParams<T> = {
  [K in keyof T]?:
    (NonNullable<T[K]> extends number ? NumericInput : T[K]) | undefined;
} & {
  id?: string | undefined;
  name?: string | undefined;
  repick?: FaceRef | EdgeRef | undefined;
};

export type SharedInputParams = InputParams<{
  targets: string[];
  pathSketchId: string;
  operation: ExtrudeFeature["operation"] | CombineFeature["operation"];
  autoOperation: boolean;
  embossMode: EmbossFeature["mode"];
  axisSource: "origin" | "edge";
  axis: OriginAxis;
  direction: ExtrudeFeature["direction"];
  tangentChain: boolean;
  method: ConstructionPlaneFeature["method"]["kind"];
  flip: boolean;
  distance: number;
  distance2: number;
  startOffset: number;
  radius: number;
  thickness: number;
  depth: number;
  spacing: number;
  totalAngle: number;
  angle: number;
  count: number;
  tx: number;
  ty: number;
  tz: number;
}>;

export type PickState = ReturnType<typeof useStore.getState>;

export interface FeatureFormProps<P> {
  params: P;
  setParams: (patch: Partial<P>) => void;
}

export interface FeaturePanelProps<P = SharedInputParams> {
  params: P;
  setParams: (patch: Partial<P>) => void;
  editId?: string | undefined;
  onClose: () => void;
  cancelPreview: () => void;
  update: (patch: Partial<Feature>) => Promise<void>;
}

type Build<F extends Feature, P> = (
  params: P,
  selection: Selection[],
) => F | { error: string };

interface FeatureUIBase<F extends Feature, P> {
  type: F["type"];
  icon: string;
  title: string;
  group: string;
  picks: readonly PickInput[];
  initialParams?: P;
  picksFor?: (params: P) => readonly PickInput[];
  onPick?(
    pick: Selection,
    s: PickState,
    params: P,
    setParams: (patch: Partial<P>) => void,
  ): Promise<void> | undefined;
  onParamsChange?(params: P): Partial<P> | undefined;
}

interface DialogUI<F extends Feature, P> {
  open?(f: F): Promise<void>;
  type: F["type"];
  prefill(f: F): { params: P; selection: Selection[] };
}

export type FeatureUI<
  F extends Feature,
  P extends SharedInputParams,
> = FeatureUIBase<F, P> &
  (
    | (DialogUI<F, P> & {
        Form: ComponentType<FeatureFormProps<P>>;
        build: Build<F, P>;
        Panel?: never;
      })
    | (DialogUI<F, P> & {
        Panel: ComponentType<FeaturePanelProps<P>>;
        build?: Build<F, P>;
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

export type FeatureInputs = Readonly<
  ReturnType<typeof createFeatureInputs<Feature, SharedInputParams>>
>;

export interface RegisteredFeatureUI {
  type: Feature["type"];
  icon: string;
  title: string;
  group: string;
  picks: readonly PickInput[];
  hasBuild: boolean;
  hasForm: boolean;
  hasPanel: boolean;
  open?: (f: Feature) => Promise<void>;
  create(): FeatureInputs;
  prefill?: (f: Feature) => { inputs: FeatureInputs; selection: Selection[] };
}

export type DialogFeatureUI = RegisteredFeatureUI;
const featureUIs = createRegistry<RegisteredFeatureUI>(
  "feature UI",
  (ui) => ui.type,
);
export const featureUI = featureUIs.get;

export function createFeatureInputs<
  F extends Feature,
  P extends SharedInputParams,
>(ui: FeatureUI<F, P>, params: P, lifetime: object = {}) {
  const state = {
    params,
    lifetime,
    belongsTo(type: string) {
      return type === ui.type;
    },
    build(selection: Selection[]) {
      return ui.build?.(state.params, selection);
    },
    renderForm(
      setParams: (patch: SharedInputParams, lifetime: object) => void,
    ): ReactNode {
      return (
        ui.Form &&
        createElement(ui.Form, {
          params: state.params,
          setParams: (patch: Partial<P>) => setParams(patch, lifetime),
        })
      );
    },
    renderPanel(
      props: Omit<FeaturePanelProps, "params" | "setParams">,
      setParams: (patch: SharedInputParams, lifetime: object) => void,
    ): ReactNode {
      return (
        ui.Panel &&
        createElement(ui.Panel, {
          ...props,
          params: state.params,
          setParams: (patch: Partial<P>) => setParams(patch, lifetime),
        })
      );
    },
    picks() {
      return ui.picksFor?.(state.params) ?? ui.picks;
    },
    onParamsChange() {
      return ui.onParamsChange?.(state.params);
    },
    onPick(
      pick: Selection,
      s: PickState,
      setParams: (patch: SharedInputParams, lifetime: object) => void,
    ) {
      return ui.onPick?.(pick, s, state.params, (patch) =>
        setParams(patch, lifetime),
      );
    },
    withParams(patch: SharedInputParams) {
      return createFeatureInputs(ui, { ...state.params, ...patch }, lifetime);
    },
  };
  return state;
}

export function registerFeatureUI<
  F extends Feature,
  P extends SharedInputParams,
>(ui: FeatureUI<F, P>) {
  const owns = (f: Feature): f is F => f.type === ui.type;
  const registered: RegisteredFeatureUI = {
    type: ui.type,
    icon: ui.icon,
    title: ui.title,
    group: ui.group,
    picks: ui.picks,
    hasBuild: !!ui.build,
    hasForm: !!ui.Form,
    hasPanel: !!ui.Panel,
    create() {
      if (!ui.initialParams)
        throw new Error(`Feature ${ui.type} has no input defaults`);
      return createFeatureInputs(ui, ui.initialParams);
    },
    ...(ui.open && {
      open: async (f: Feature) => {
        if (owns(f)) await ui.open?.(f);
      },
    }),
    ...(ui.prefill && {
      prefill: (f: Feature) => {
        if (!owns(f) || !ui.prefill)
          throw new Error(`Feature ${f.type} does not belong to ${ui.type}`);
        const { params, selection } = ui.prefill(f);
        return { inputs: createFeatureInputs(ui, params), selection };
      },
    }),
  };
  return featureUIs.register(registered);
}
