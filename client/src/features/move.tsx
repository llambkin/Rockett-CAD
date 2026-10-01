import { newId, type MoveFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { bodies } from "../commands/featureCommand";
import { bodyIds, bodyPicks, num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type MoveParams = InputParams<Pick<MoveFeature, "id" | "name">> &
  InputParams<{
    tx: MoveFeature["translation"][0];
    ty: MoveFeature["translation"][1];
    tz: MoveFeature["translation"][2];
  }>;

function MoveForm({ params, setParams }: FeatureFormProps<MoveParams>) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Bodies" input="bodies" hint="click bodies" />
      <LengthField
        label="X"
        units={units}
        autoFocus
        value={num(params, "tx", 0)}
        onChange={(v) => setParams({ tx: v })}
      />
      <LengthField
        label="Y"
        units={units}
        value={num(params, "ty", 0)}
        onChange={(v) => setParams({ ty: v })}
      />
      <LengthField
        label="Z"
        units={units}
        value={num(params, "tz", 0)}
        onChange={(v) => setParams({ tz: v })}
      />
    </>
  );
}

export const move: FeatureUI<MoveFeature, MoveParams> = {
  type: "move",
  initialParams: {},
  icon: "✥",
  title: "Move",
  group: "modify",
  picks: [bodies],
  Form: MoveForm,
  build: (params, selection) => {
    const ids = bodyIds(selection);
    if (ids.length === 0) return { error: "Select at least one body" };
    return {
      id: params.id ?? newId("move"),
      type: "move",
      name: params.name ?? "",
      suppressed: false,
      bodies: ids,
      translation: [
        num(params, "tx", 0),
        num(params, "ty", 0),
        num(params, "tz", 0),
      ],
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      tx: f.translation[0],
      ty: f.translation[1],
      tz: f.translation[2],
    },
    selection: bodyPicks(f.bodies),
  }),
};

registerFeatureUI(move);
