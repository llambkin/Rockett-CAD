import type {
  FeatureHandleDefinition,
  FeatureHandle,
  HandleInput,
} from "../three/featureHandles";
import type { ViewportRef } from "../viewportRef";
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
  type ShellFeature,
} from "@rockett/shared";
import type { PickInput } from "../commands/featureCommand";
import { resolvedFeature, type FieldExpressions } from "./bindings";
import type { useStore, Selection } from "../store";

import type {
  FeatureGizmo,
  FeatureGizmoContext,
  GizmoLabel,
} from "../three/featureGizmos";
import type { ManipulatorHost } from "../three/Manipulator";

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
  shellDirection: ShellFeature["direction"];
  tangentChain: boolean;
  method: ConstructionPlaneFeature["method"]["kind"];
  flip: boolean;
  distance: number;
  distance2: number;
  startOffset: number;
  radius: number;
  activeSet: number;
  between: Selection[];
  start: "profile" | "offset" | "object";
  startObject: Selection[];
  extent: "distance" | "toObject" | "all";
  extentObject: Selection[];
  thickness: number;
  outsideThickness: number;
  depth: number;
  spacing: number;
  totalAngle: number;
  angle: number;
  count: number;
  tx: number;
  ty: number;
  tz: number;
  expressions: FieldExpressions;
  invalid: string[];
}>;

export const num = <P extends object>(
  params: P,
  key: keyof P,
  dflt: number,
) => {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : dflt;
};

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
  handle?: FeatureHandleDefinition<P>;
  gizmo?(context: FeatureGizmoContext<P>): FeatureGizmo | undefined;
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
  open?(f: F, viewport?: ViewportRef): Promise<void>;
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
        open(f: F, viewport?: ViewportRef): Promise<void>;
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
  handle?: Pick<
    FeatureHandleDefinition<SharedInputParams>,
    "fallback" | "signed"
  > & {
    param: string;
  };
  hasBuild: boolean;
  hasForm: boolean;
  hasPanel: boolean;
  open?: (f: Feature, viewport?: ViewportRef) => Promise<void>;
  create(params?: SharedInputParams): FeatureInputs;
  prefill?: (f: Feature) => { inputs: FeatureInputs; selection: Selection[] };
}

export type DialogFeatureUI = RegisteredFeatureUI;
const featureUIs = createRegistry<RegisteredFeatureUI>(
  "feature UI",
  (ui) => ui.type,
);
export const featureUI = featureUIs.get;

function placeHandle<P extends object>(
  definition: FeatureHandleDefinition<P> | undefined,
  params: P,
  input: Omit<HandleInput, "params">,
): FeatureHandle | null {
  if (!definition?.place) return null;
  const placement = definition.place({ ...input, params });
  return (
    placement && {
      ...placement,
      param: definition.param,
      value: num(params, definition.param, definition.fallback),
      signed: definition.signed ?? false,
    }
  );
}

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
    gizmo(
      host: ManipulatorHost,
      label: (value: GizmoLabel) => void,
      readParams: () => SharedInputParams,
      setParams: (patch: SharedInputParams) => void,
    ) {
      return ui.gizmo?.({
        host,
        label,
        params: () => ({ ...state.params, ...readParams() }),
        setParams: (patch) => setParams(patch),
      });
    },
    handle(input: Omit<HandleInput, "params">) {
      return placeHandle(ui.handle, state.params, input);
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
    ...(ui.handle && { handle: ui.handle }),
    hasBuild: !!ui.build,
    hasForm: !!ui.Form,
    hasPanel: !!ui.Panel,
    create(params?: SharedInputParams) {
      if (!ui.initialParams)
        throw new Error(`Feature ${ui.type} has no input defaults`);
      return createFeatureInputs(ui, { ...ui.initialParams, ...params });
    },
    ...(ui.open && {
      open: async (f: Feature, viewport?: ViewportRef) => {
        if (!owns(f)) return;
        if (viewport) await ui.open?.(f, viewport);
        else await ui.open?.(f);
      },
    }),
    ...(ui.prefill && {
      prefill: (f: Feature) => {
        if (!owns(f) || !ui.prefill)
          throw new Error(`Feature ${f.type} does not belong to ${ui.type}`);
        const { params, selection } = ui.prefill(resolvedFeature(f));
        return { inputs: createFeatureInputs(ui, params), selection };
      },
    }),
  };
  return featureUIs.register(registered);
}
