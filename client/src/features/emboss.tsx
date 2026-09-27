import { newId, type EmbossFeature } from "@rockett/shared";
import {
  LengthField,
  SelInfo,
  SelectField,
  TargetField,
} from "../components/form/fields";
import { profiles, targets } from "../dialogPicks";
import { targetOperation } from "../toolTargets";
import { useSetting } from "../settings";
import { bodyTargets, handleValue, profilePicks, profileRefs } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

function EmbossForm({ params, setParams }: FeatureFormProps) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo
        label="Profiles"
        input="profiles"
        hint="sketch on a face, then pick regions"
      />
      <LengthField
        label="Depth"
        units={units}
        autoFocus
        value={params.depth ?? handleValue(params, "emboss")}
        onChange={(v) => setParams({ depth: v })}
      />
      <SelectField
        label="Mode"
        value={params.embossMode ?? "emboss"}
        options={[
          ["emboss", "Emboss (raise)"],
          ["deboss", "Deboss (engrave)"],
        ]}
        onChange={(v) => setParams({ embossMode: v })}
      />
      <TargetField operation={targetOperation("emboss", params)} />
    </>
  );
}

const emboss: FeatureUI<EmbossFeature> = {
  type: "emboss",
  icon: "℘",
  title: "Emboss",
  group: "create",
  picks: [profiles, targets],
  Form: EmbossForm,
  build: (params, selection) => {
    const refs = profileRefs(selection);
    if (refs.length === 0) return { error: "Select profiles" };
    return {
      id: params.id ?? newId("emboss"),
      type: "emboss",
      name: params.name ?? "",
      suppressed: false,
      profiles: refs,
      depth: handleValue(params, "emboss"),
      mode: params.embossMode ?? "emboss",
      ...bodyTargets(targetOperation("emboss", params), params),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      targets: f.targets,
      depth: f.depth,
      embossMode: f.mode,
    },
    selection: profilePicks(f.profiles),
  }),
};

registerFeatureUI(emboss);
