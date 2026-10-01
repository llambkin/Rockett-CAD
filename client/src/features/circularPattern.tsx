import {
  bodyCenter,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type CircularPatternFeature } from "@rockett/shared";
import {
  AxisField,
  CheckField,
  NumField,
  SelInfo,
} from "../components/form/fields";
import { axis, bodies, clearInput } from "../commands/featureCommand";
import { useStore } from "../store";
import {
  axisHint,
  axisMissing,
  axisParams,
  axisPicks,
  axisRef,
  axisSelection,
  bodyIds,
  bodyPicks,
  num,
  type AxisParams,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type CircularPatternParams = InputParams<
  Pick<
    CircularPatternFeature,
    "id" | "name" | "count" | "totalAngle" | "combine"
  >
> &
  AxisParams;

const handle = {
  param: "totalAngle",
  fallback: 360,
  signed: true,
  place: (input) => {
    const through = bodyCenter(input);
    return through && { kind: "arc", through };
  },
} satisfies FeatureHandleDefinition<CircularPatternParams>;

function CircularPatternForm({
  params,
  setParams,
}: FeatureFormProps<CircularPatternParams>) {
  const selection = useStore((s) => s.selection);
  const document = useStore((s) => s.document);
  return (
    <>
      <SelInfo label="Bodies" input="bodies" hint="click bodies" />
      <SelInfo
        label="Axis"
        input="axis"
        picks={axisPicks(selection, document)}
        hint={axisHint(axisMissing(params, selection, document))}
      />
      <AxisField
        axisSource={params.axisSource}
        axis={params.axis}
        onChange={(patch) => {
          setParams(patch);
          clearInput("axis");
        }}
      />
      <NumField
        label="Quantity"
        autoFocus
        value={num(params, "count", 6)}
        onChange={(v) => setParams({ count: v })}
        int
      />
      <NumField
        label="Total angle (°)"
        value={num(params, handle.param, handle.fallback)}
        onChange={(v) => setParams({ totalAngle: v })}
      />
      <CheckField
        label="Join instances"
        value={!!(params.combine ?? false)}
        onChange={(v) => setParams({ combine: v })}
      />
    </>
  );
}

export const circularPattern: FeatureUI<
  CircularPatternFeature,
  CircularPatternParams
> = {
  type: "circularPattern",
  handle,
  initialParams: {},
  icon: "❋",
  title: "Circular Pattern",
  group: "pattern",
  picks: [bodies, axis],
  Form: CircularPatternForm,
  build: (params, selection) => {
    const ids = bodyIds(selection);
    if (ids.length === 0) return { error: "Select bodies to pattern" };
    const axisOf = axisRef(params, selection, useStore.getState().document);
    if (!axisOf) return { error: "Pick an axis" };
    return {
      id: params.id ?? newId("cpat"),
      type: "circularPattern",
      name: params.name ?? "",
      suppressed: false,
      bodies: ids,
      axis: axisOf,
      count: Math.round(num(params, "count", 6)),
      totalAngle: num(params, handle.param, handle.fallback),
      combine: !!(params.combine ?? false),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      count: f.count,
      totalAngle: f.totalAngle,
      combine: f.combine,
      ...axisParams(f.axis),
    },
    selection: [...bodyPicks(f.bodies), ...axisSelection(f.axis)],
  }),
};

registerFeatureUI(circularPattern);
