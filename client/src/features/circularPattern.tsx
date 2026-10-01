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
  handleValue,
  num,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

function CircularPatternForm({ params, setParams }: FeatureFormProps) {
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
        value={params.count ?? 6}
        onChange={(v) => setParams({ count: v })}
        int
      />
      <NumField
        label="Total angle (°)"
        value={params.totalAngle ?? handleValue(params, "circularPattern")}
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

const circularPattern: FeatureUI<CircularPatternFeature> = {
  type: "circularPattern",
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
      totalAngle: handleValue(params, "circularPattern"),
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
