import {
  arrow,
  edgeRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type ChamferFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { edges } from "../commands/featureCommand";
import { edgePicks, edgeRefs, num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";
import { tangentChain, TangentChainField } from "./tangentChain";

export type ChamferParams = InputParams<
  Pick<ChamferFeature, "id" | "name" | "tangentChain" | "distance">
>;

const handle = {
  param: "distance",
  fallback: 1,
  signed: false,
  place: (input) => arrow(edgeRay(input.bodies, first(input, "edge"))),
} satisfies FeatureHandleDefinition<ChamferParams>;

function ChamferForm({ params, setParams }: FeatureFormProps<ChamferParams>) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Edges" input="edges" hint="click model edges" />
      <TangentChainField params={params} setParams={setParams} />
      <LengthField
        label="Distance"
        units={units}
        autoFocus
        value={num(params, handle.param, handle.fallback)}
        onChange={(v) => setParams({ distance: v })}
      />
    </>
  );
}

export const chamfer: FeatureUI<ChamferFeature, ChamferParams> = {
  type: "chamfer",
  handle,
  icon: "◣",
  title: "Chamfer",
  group: "modify",
  picks: [edges],
  initialParams: {},
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
      distance: num(params, handle.param, handle.fallback),
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
