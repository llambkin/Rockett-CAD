import {
  arrow,
  faceRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type OffsetFaceFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { facePicks, faceRefs, num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type OffsetFaceParams = InputParams<
  Pick<OffsetFaceFeature, "id" | "name" | "distance">
>;

const handle = {
  param: "distance",
  fallback: 5,
  signed: true,
  place: (input) => arrow(faceRay(input.bodies, first(input, "face"))),
} satisfies FeatureHandleDefinition<OffsetFaceParams>;

function OffsetFaceForm({
  params,
  setParams,
}: FeatureFormProps<OffsetFaceParams>) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Faces" input="faces" hint="click planar faces" />
      <LengthField
        label="Distance, − = inward"
        units={units}
        autoFocus
        value={num(params, handle.param, handle.fallback)}
        onChange={(v) => setParams({ distance: v })}
      />
    </>
  );
}

export const offsetFace: FeatureUI<OffsetFaceFeature, OffsetFaceParams> = {
  type: "offsetFace",
  handle,
  initialParams: {},
  icon: "⇱",
  title: "Press / Pull",
  group: "modify",
  picks: [{ key: "faces", providers: ["design.face"], planar: true }],
  Form: OffsetFaceForm,
  build: (params, selection) => {
    const faces = faceRefs(selection);
    if (faces.length === 0) return { error: "Select faces" };
    return {
      id: params.id ?? newId("offsetf"),
      type: "offsetFace",
      name: params.name ?? "",
      suppressed: false,
      faces,
      distance: num(params, handle.param, handle.fallback),
    };
  },
  prefill: (f) => ({
    params: { id: f.id, name: f.name, distance: f.distance },
    selection: facePicks(f.faces),
  }),
};

registerFeatureUI(offsetFace);
