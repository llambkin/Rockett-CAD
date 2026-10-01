import { newId, type OffsetFaceFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { facePicks, faceRefs, handleValue } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type OffsetFaceParams = InputParams<
  Pick<OffsetFaceFeature, "id" | "name" | "distance">
>;

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
        value={handleValue(params, "offsetFace")}
        onChange={(v) => setParams({ distance: v })}
      />
    </>
  );
}

export const offsetFace: FeatureUI<OffsetFaceFeature, OffsetFaceParams> = {
  type: "offsetFace",
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
      distance: handleValue(params, "offsetFace"),
    };
  },
  prefill: (f) => ({
    params: { id: f.id, name: f.name, distance: f.distance },
    selection: facePicks(f.faces),
  }),
};

registerFeatureUI(offsetFace);
