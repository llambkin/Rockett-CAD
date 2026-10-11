import {
  arrow,
  edgeRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { CHAMFER_TYPES, newId, type ChamferFeature } from "@rockett/shared";
import { SelInfo } from "../components/form/fields";
import { blendPicks } from "../commands/featureCommand";
import { num } from "./inputs";
import {
  blendHint,
  blendSelection,
  blendSources,
  refuseVertex,
} from "./blendPicks";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";
import { TangentChainField } from "./tangentChain";
import { BlendSizeFields } from "./blendSize";

export type ChamferParams = InputParams<
  Pick<
    ChamferFeature,
    | "id"
    | "name"
    | "tangentChain"
    | "chamferType"
    | "distance"
    | "distance2"
    | "angle"
    | "flip"
  >
>;

const handle = {
  param: "distance",
  fallback: 1,
  signed: false,
  place: (input) => arrow(edgeRay(input.bodies, first(input, "edge"))),
} satisfies FeatureHandleDefinition<ChamferParams>;

const ANGLE_FALLBACK = 45;

function sizes(params: ChamferParams) {
  const chamferType = params.chamferType ?? "equalDistance";
  const distance = num(params, handle.param, handle.fallback);
  const flip = params.flip ?? false;
  switch (chamferType) {
    case "equalDistance":
      return { chamferType, distance };
    case "twoDistances":
      return {
        chamferType,
        distance,
        distance2: num(params, "distance2", distance),
        flip,
      };
    case "distanceAngle":
      return {
        chamferType,
        distance,
        angle: num(params, "angle", ANGLE_FALLBACK),
        flip,
      };
  }
}

function ChamferForm({ params, setParams }: FeatureFormProps<ChamferParams>) {
  const { chamferType, distance, ...second } = sizes(params);
  return (
    <>
      <SelInfo label="Edges" input="edges" hint={blendHint} />
      <TangentChainField params={params} setParams={setParams} />
      <BlendSizeFields
        types={CHAMFER_TYPES}
        size={{ type: chamferType, size: distance, ...second }}
        label="Distance"
        bind="/distance"
        onType={(v) => setParams({ chamferType: v })}
        onSize={(v) => setParams({ distance: v })}
        setParams={setParams}
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
  picks: [blendPicks],
  initialParams: {},
  Form: ChamferForm,
  build: (params, selection) => {
    const picks = blendSources(params.id, selection);
    if ("error" in picks) return picks;
    return {
      id: params.id ?? newId("chamfer"),
      type: "chamfer",
      name: params.name ?? "",
      suppressed: false,
      ...picks,
      ...sizes(params),
      tangentChain: params.tangentChain ?? true,
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      chamferType: f.chamferType,
      distance: f.distance,
      distance2: f.distance2,
      angle: f.angle,
      flip: f.flip,
      tangentChain: f.tangentChain ?? false,
    },
    selection: blendSelection(f),
  }),
  onPick: refuseVertex(
    "Chamfer bevels edges: pick the edges or faces at this corner",
  ),
};

registerFeatureUI(chamfer);
