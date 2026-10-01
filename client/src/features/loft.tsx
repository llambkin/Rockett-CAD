import {
  newId,
  type LoftFeature,
  type ProfileRef,
  type FaceRef,
} from "@rockett/shared";
import { OperationField, SelInfo } from "../components/form/fields";
import { sections, targets } from "../commands/featureCommand";
import { autoOperation, toolOperation } from "../extrudeReach";
import {
  bodyTargets,
  facePicks,
  faceRefs,
  profilePicks,
  profileRefs,
} from "./inputs";
import { registerFeatureUI, type FeatureUI } from "./registry";

function LoftForm() {
  return (
    <>
      <SelInfo
        label="Sections (in order)"
        input="profiles"
        hint="click 2+ profiles or planar faces in order"
      />
      <OperationField />
    </>
  );
}

const loft: FeatureUI<LoftFeature> = {
  type: "loft",
  icon: "◆",
  title: "Loft",
  group: "create",
  picks: [sections, targets],
  Form: LoftForm,
  build: (params, selection) => {
    const sections: (ProfileRef | FaceRef)[] = selection.flatMap<
      ProfileRef | FaceRef
    >((pick) =>
      pick.kind === "face" ? faceRefs([pick]) : profileRefs([pick]),
    );
    if (sections.length < 2)
      return { error: "Select at least two profiles or planar faces" };
    const operation = params.operation ?? "join";
    return {
      id: params.id ?? newId("loft"),
      type: "loft",
      name: params.name ?? "",
      suppressed: false,
      sections,
      operation,
      ...bodyTargets(operation, params),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      targets: f.targets,
      operation: f.operation,
    },
    selection: f.sections.flatMap((section) =>
      "kind" in section ? facePicks([section]) : profilePicks([section]),
    ),
  }),
  onParamsChange: (params) => autoOperation(params, () => toolOperation()),
};

registerFeatureUI(loft);
