import { newId, type CombineFeature } from "@rockett/shared";
import { CheckField, SelectField, SelInfo } from "../components/form/fields";
import { bodies } from "../commands/featureCommand";
import { bodyIds, bodyPicks } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

function CombineForm({ params, setParams }: FeatureFormProps) {
  return (
    <>
      <SelInfo
        label="Bodies (first = target)"
        input="bodies"
        hint="click bodies: first is the target"
      />
      <SelectField
        label="Operation"
        value={params.operation ?? "join"}
        options={[
          ["join", "Join"],
          ["cut", "Cut"],
          ["intersect", "Intersect"],
        ]}
        onChange={(v) => setParams({ operation: v })}
      />
      <CheckField
        label="Keep tools"
        value={!!params.keepTools}
        onChange={(v) => setParams({ keepTools: v })}
      />
    </>
  );
}

const combine: FeatureUI<CombineFeature> = {
  type: "combine",
  icon: "∪",
  title: "Combine",
  group: "modify",
  picks: [bodies],
  Form: CombineForm,
  build: (params, selection) => {
    const [targetBody, ...toolBodies] = bodyIds(selection);
    if (!targetBody || toolBodies.length === 0)
      return { error: "Select a target body then tool bodies" };
    return {
      id: params.id ?? newId("combine"),
      type: "combine",
      name: params.name ?? "",
      suppressed: false,
      operation: params.operation ?? "join",
      targetBody,
      toolBodies,
      keepTools: !!params.keepTools,
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      operation: f.operation,
      keepTools: f.keepTools,
    },
    selection: bodyPicks([f.targetBody, ...f.toolBodies]),
  }),
};

registerFeatureUI(combine);
