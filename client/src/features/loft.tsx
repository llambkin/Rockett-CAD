import { newId, type LoftFeature } from "@rockett/shared";
import { OperationField, SelInfo } from "../components/form/fields";
import { profiles, targets } from "../dialogPicks";
import { autoOperation, toolOperation } from "../extrudeReach";
import { bodyTargets, profilePicks, profileRefs } from "./inputs";
import { registerFeatureUI, type FeatureUI } from "./registry";

function LoftForm() {
  return (
    <>
      <SelInfo
        label="Sections (in order)"
        input="profiles"
        hint="click 2+ profiles"
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
  picks: [profiles, targets],
  Form: LoftForm,
  build: (params, selection) => {
    const sections = profileRefs(selection);
    if (sections.length < 2)
      return { error: "Select at least two section profiles" };
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
    selection: profilePicks(f.sections),
  }),
  onParamsChange: (params) => autoOperation(params, () => toolOperation()),
};

registerFeatureUI(loft);
