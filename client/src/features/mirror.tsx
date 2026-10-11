import { newId, type MirrorFeature } from "@rockett/shared";
import { CheckField, SelInfo } from "../components/form/fields";
import { bodies, planar } from "../commands/featureCommand";
import { bodyIds, bodyPicks, selectedPlane } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type MirrorParams = InputParams<
  Pick<MirrorFeature, "id" | "name" | "combine">
>;

function MirrorForm({ params, setParams }: FeatureFormProps<MirrorParams>) {
  return (
    <>
      <SelInfo label="Bodies" input="bodies" hint="click bodies" />
      <SelInfo
        label="Mirror plane"
        input="plane"
        hint="origin/construction plane or planar face"
      />
      <CheckField
        label="Join with source"
        value={!!(params.combine ?? true)}
        onChange={(v) => setParams({ combine: v })}
      />
    </>
  );
}

export const mirror: FeatureUI<MirrorFeature, MirrorParams> = {
  type: "mirror",
  initialParams: {},
  icon: "⧉",
  title: "Mirror",
  group: "pattern",
  picks: [bodies, planar("plane", true)],
  Form: MirrorForm,
  build: (params, selection) => {
    const ids = bodyIds(selection);
    if (ids.length === 0) return { error: "Select bodies to mirror" };
    const plane = selectedPlane(selection);
    if (!plane) return { error: "Select a mirror plane" };
    return {
      id: params.id ?? newId("mirror"),
      type: "mirror",
      name: params.name ?? "",
      suppressed: false,
      bodies: ids,
      plane,
      combine: params.combine ?? true,
    };
  },
  prefill: (f) => ({
    params: { id: f.id, name: f.name, combine: f.combine },
    selection: [
      ...bodyPicks(f.bodies),
      { kind: "plane", ref: f.plane, label: "Plane" },
    ],
  }),
};

registerFeatureUI(mirror);
