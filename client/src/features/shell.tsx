import { newId, type ShellFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { HANDLE_VALUES } from "../three/featureHandles";
import { facePicks, faceRefs } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type ShellParams = InputParams<
  Pick<ShellFeature, "id" | "name" | "thickness">
>;

const thickness = (params: ShellParams) => {
  const v = Number(params.thickness);
  return Number.isFinite(v) ? v : HANDLE_VALUES.shell.fallback;
};

function ShellForm({ params, setParams }: FeatureFormProps<ShellParams>) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo
        label="Faces to remove"
        input="faces"
        hint="click faces to open"
      />
      <LengthField
        label="Thickness"
        units={units}
        autoFocus
        value={thickness(params)}
        onChange={(v) => setParams({ thickness: v })}
      />
    </>
  );
}

export const shell: FeatureUI<ShellFeature, ShellParams> = {
  type: "shell",
  initialParams: {},
  icon: "▢",
  title: "Shell",
  group: "modify",
  picks: [{ key: "faces", providers: ["design.face"] }],
  Form: ShellForm,
  build: (params, selection) => ({
    id: params.id ?? newId("shell"),
    type: "shell",
    name: params.name ?? "",
    suppressed: false,
    openFaces: faceRefs(selection),
    thickness: thickness(params),
  }),
  prefill: (f) => ({
    params: { id: f.id, name: f.name, thickness: f.thickness },
    selection: facePicks(f.openFaces),
  }),
};

registerFeatureUI(shell);
