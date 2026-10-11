import { newId, type SplitBodyFeature } from "@rockett/shared";
import { SelInfo } from "../components/form/fields";
import { planar } from "../commands/featureCommand";
import { bodyIds, bodyPicks, selectedPlane } from "./inputs";
import {
  registerFeatureUI,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type SplitBodyParams = InputParams<
  Pick<SplitBodyFeature, "id" | "name">
>;

function SplitBodyForm() {
  return (
    <>
      <SelInfo label="Body" input="body" hint="click the body to split" />
      <SelInfo
        label="Split plane"
        input="tool"
        hint="click an origin/construction plane or planar face"
      />
    </>
  );
}

export const splitBody: FeatureUI<SplitBodyFeature, SplitBodyParams> = {
  type: "splitBody",
  initialParams: {},
  icon: "∤",
  title: "Split Body",
  group: "modify",
  picks: [
    { key: "body", providers: ["design.body"], one: true },
    planar("tool", true),
  ],
  Form: SplitBodyForm,
  build: (params, selection) => {
    const [body] = bodyIds(selection);
    if (!body) return { error: "Select a body to split" };
    const tool = selectedPlane(selection);
    if (!tool) return { error: "Select a splitting plane" };
    return {
      id: params.id ?? newId("split"),
      type: "splitBody",
      name: params.name ?? "",
      suppressed: false,
      body,
      tool,
    };
  },
  prefill: (f) => ({
    params: { id: f.id, name: f.name },
    selection: [
      ...bodyPicks([f.body]),
      { kind: "plane", ref: f.tool, label: "Tool" },
    ],
  }),
};

registerFeatureUI(splitBody);
