import { newId, type LinearPatternFeature } from "@rockett/shared";
import {
  AxisField,
  CheckField,
  LengthField,
  NumField,
  SelInfo,
} from "../components/form/fields";
import { bodies, clearInput, type PickInput } from "../commands/featureCommand";
import { useSetting } from "../settings";
import { useStore } from "../store";
import {
  axisMissing,
  axisParams,
  axisSelection,
  bodyIds,
  bodyPicks,
  edgeRefs,
  handleValue,
  num,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

const direction: PickInput = {
  key: "direction",
  providers: ["design.edge", "design.originAxis"],
  one: true,
  straight: true,
};

function LinearPatternForm({ params, setParams }: FeatureFormProps) {
  const units = useSetting("units.length");
  const selection = useStore((s) => s.selection);
  const document = useStore((s) => s.document);
  return (
    <>
      <SelInfo label="Bodies" input="bodies" hint="click bodies" />
      <SelInfo
        label="Direction edge"
        input="direction"
        picks={selection.filter((x) => x.kind === "edge")}
        hint={
          axisMissing(params, selection, document)
            ? "Pick a direction"
            : "click a body edge, or pick X/Y/Z"
        }
      />
      <AxisField
        label="Direction"
        defaultAxis="X"
        edgeLabel="Selected edge"
        axisSource={params.axisSource}
        axis={params.axis}
        onChange={(patch) => {
          setParams(patch);
          clearInput("direction");
        }}
      />
      <NumField
        label="Quantity"
        value={params.count ?? 3}
        onChange={(v) => setParams({ count: v })}
        int
      />
      <LengthField
        label="Spacing"
        units={units}
        autoFocus
        value={params.spacing ?? handleValue(params, "linearPattern")}
        onChange={(v) => setParams({ spacing: v })}
      />
      <CheckField
        label="Join instances"
        value={!!(params.combine ?? false)}
        onChange={(v) => setParams({ combine: v })}
      />
    </>
  );
}

const linearPattern: FeatureUI<LinearPatternFeature> = {
  type: "linearPattern",
  icon: "⋮⋮",
  title: "Rectangular Pattern",
  group: "pattern",
  picks: [bodies, direction],
  Form: LinearPatternForm,
  build: (params, selection) => {
    const ids = bodyIds(selection);
    if (ids.length === 0) return { error: "Select bodies to pattern" };
    const [edge] = edgeRefs(selection);
    const onEdge = params.axisSource === "edge";
    if (onEdge && !edge) return { error: "Pick a direction" };
    return {
      id: params.id ?? newId("lpat"),
      type: "linearPattern",
      name: params.name ?? "",
      suppressed: false,
      bodies: ids,
      direction:
        onEdge && edge
          ? { kind: "edge", edge }
          : { kind: "axis", axis: params.axis ?? "X" },
      count: Math.round(num(params, "count", 3)),
      spacing: handleValue(params, "linearPattern"),
      combine: !!(params.combine ?? false),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      count: f.count,
      spacing: f.spacing,
      combine: f.combine,
      ...axisParams(f.direction, "X"),
    },
    selection: [...bodyPicks(f.bodies), ...axisSelection(f.direction)],
  }),
};

registerFeatureUI(linearPattern);
