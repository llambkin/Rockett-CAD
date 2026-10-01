import {
  arrow,
  edgeRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type FilletFeature } from "@rockett/shared";
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

export type FilletParams = InputParams<
  Pick<FilletFeature, "id" | "name" | "radius" | "tangentChain">
>;

const handle = {
  param: "radius",
  fallback: 2,
  signed: false,
  place: (input) => arrow(edgeRay(input.bodies, first(input, "edge"))),
} satisfies FeatureHandleDefinition<FilletParams>;

function FilletForm({ params, setParams }: FeatureFormProps<FilletParams>) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Edges" input="edges" hint="click model edges" />
      <TangentChainField params={params} setParams={setParams} />
      <LengthField
        label="Radius"
        units={units}
        autoFocus
        value={num(params, handle.param, handle.fallback)}
        onChange={(v) => setParams({ radius: v })}
      />
    </>
  );
}

export const fillet: FeatureUI<FilletFeature, FilletParams> = {
  type: "fillet",
  handle,
  initialParams: {},
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
      radius: num(params, handle.param, handle.fallback),
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
