import * as THREE from "three";
import { uv3 } from "../three/CadViewport";
import {
  arrow,
  sketchOf,
  first,
  profileCentroid,
  type HandleInput,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type EmbossFeature } from "@rockett/shared";
import {
  LengthField,
  SelInfo,
  SelectField,
  TargetField,
} from "../components/form/fields";
import { profiles, targets } from "../commands/featureCommand";
import { targetOperation } from "../toolTargets";
import { useSetting } from "../settings";
import { bodyTargets, profilePicks, profileRefs, num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type EmbossParams = InputParams<
  Pick<EmbossFeature, "id" | "name" | "depth" | "targets">
> &
  InputParams<{ embossMode: EmbossFeature["mode"] }>;

function embossRay(input: HandleInput) {
  const found = sketchOf(input.evaluation, first(input, "profile"));
  if (!found) return null;
  const [u, v] = profileCentroid(found.profile);
  const sign = input.params.embossMode === "deboss" ? -1 : 1;
  return {
    origin: uv3(found.sketch.frame, u, v),
    axis: new THREE.Vector3(...found.sketch.frame.normal).multiplyScalar(sign),
  };
}

const handle = {
  param: "depth",
  fallback: 1,
  signed: false,
  place: (input) => arrow(embossRay(input)),
} satisfies FeatureHandleDefinition<EmbossParams>;

function EmbossForm({ params, setParams }: FeatureFormProps<EmbossParams>) {
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
        value={num(params, handle.param, handle.fallback)}
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

export const emboss: FeatureUI<EmbossFeature, EmbossParams> = {
  type: "emboss",
  handle,
  initialParams: {},
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
      depth: num(params, handle.param, handle.fallback),
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
