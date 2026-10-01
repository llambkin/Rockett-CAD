import { newId, type FilletFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { edges } from "../commands/featureCommand";
import { edgePicks, edgeRefs, handleValue } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";
import { tangentChain, TangentChainField } from "./tangentChain";

function FilletForm({ params, setParams }: FeatureFormProps) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Edges" input="edges" hint="click model edges" />
      <TangentChainField params={params} setParams={setParams} />
      <LengthField
        label="Radius"
        units={units}
        autoFocus
        value={params.radius ?? handleValue(params, "fillet")}
        onChange={(v) => setParams({ radius: v })}
      />
    </>
  );
}

const fillet: FeatureUI<FilletFeature> = {
  type: "fillet",
  icon: "◠",
  title: "Fillet",
  group: "modify",
  picks: [edges],
  Form: FilletForm,
  build: (params, selection) => {
    const edges = edgeRefs(selection);
    if (edges.length === 0) return { error: "Select at least one edge" };
    return {
      id: params.id ?? newId("fillet"),
      type: "fillet",
      name: params.name ?? "",
      suppressed: false,
      edges,
      radius: handleValue(params, "fillet"),
      tangentChain: params.tangentChain ?? true,
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      radius: f.radius,
      tangentChain: f.tangentChain ?? false,
    },
    selection: edgePicks(f.edges),
  }),
  onPick: tangentChain,
};

registerFeatureUI(fillet);
