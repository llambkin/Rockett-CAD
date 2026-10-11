import {
  newId,
  type LoftFeature,
  type ProfileRef,
  type FaceRef,
} from "@rockett/shared";
import { OperationField, SelInfo } from "../components/form/fields";
import { sections, targets } from "../commands/featureCommand";
import { autoOperation, toolBase, toolOperation } from "../extrudeReach";
import { useStore } from "../store";
import {
  bodyTargets,
  facePicks,
  faceRefs,
  profilePicks,
  profileRefs,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type LoftParams = InputParams<
  Pick<LoftFeature, "id" | "name" | "operation" | "targets">
> & { autoOperation?: boolean | undefined };

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

function loftCells() {
  const picked = useStore
    .getState()
    .selection.filter((sel) => sel.kind === "face" || sel.kind === "profile")
    .map((sel) => toolBase(sel)?.triangles.flat());
  return picked.flatMap((section, i) => {
    const next = picked[i + 1];
    return section && next ? [[...section, ...next]] : [];
  });
}

export const loft: FeatureUI<LoftFeature, LoftParams> = {
  type: "loft",
  initialParams: {},
  icon: "◆",
  title: "Loft",
  group: "create",
  picks: [sections, targets],
  Form: LoftForm,
  build: (params, selection) => {
    const refs: (ProfileRef | FaceRef)[] = selection.flatMap<
      ProfileRef | FaceRef
    >((pick) =>
      pick.kind === "face" ? faceRefs([pick]) : profileRefs([pick]),
    );
    if (refs.length < 2)
      return { error: "Select at least two profiles or planar faces" };
    const operation = params.operation ?? "join";
    return {
      id: params.id ?? newId("loft"),
      type: "loft",
      name: params.name ?? "",
      suppressed: false,
      sections: refs,
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
  onParamsChange: (params) =>
    autoOperation(params, () => toolOperation(loftCells())),
};

registerFeatureUI(loft);
