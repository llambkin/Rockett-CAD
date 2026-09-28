import { newId, type ChamferFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { edges } from "../dialogPicks";
import { edgePicks, edgeRefs, handleValue } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";
import { tangentChain, TangentChainField } from "./tangentChain";

function ChamferForm({ params, setParams }: FeatureFormProps) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Edges" input="edges" hint="click model edges" />
      <TangentChainField params={params} setParams={setParams} />
      <LengthField
        label="Distance"
        units={units}
        autoFocus
        value={params.distance ?? handleValue(params, "chamfer")}
        onChange={(v) => setParams({ distance: v })}
      />
    </>
  );
}

const chamfer: FeatureUI<ChamferFeature> = {
  type: "chamfer",
  icon: "◣",
  title: "Chamfer",
  group: "modify",
  picks: [edges],
  Form: ChamferForm,
  build: (params, selection) => {
    const edges = edgeRefs(selection);
    if (edges.length === 0) return { error: "Select at least one edge" };
    return {
      id: params.id ?? newId("chamfer"),
      type: "chamfer",
      name: params.name ?? "",
      suppressed: false,
      edges,
      distance: handleValue(params, "chamfer"),
      tangentChain: params.tangentChain ?? true,
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      distance: f.distance,
      tangentChain: f.tangentChain ?? false,
    },
    selection: edgePicks(f.edges),
  }),
  onPick: tangentChain,
};

registerFeatureUI(chamfer);
