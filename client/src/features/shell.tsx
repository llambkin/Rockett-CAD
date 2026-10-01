import { newId, type ShellFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { HANDLE_VALUES } from "../three/featureHandles";
import { facePicks, faceRefs } from "./inputs";
import {
  registerFeatureUI,
  type DialogParams,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

const thickness = (params: DialogParams) => {
  const v = Number(params.thickness);
  return Number.isFinite(v) ? v : HANDLE_VALUES.shell.fallback;
};

function ShellForm({ params, setParams }: FeatureFormProps) {
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
        value={params.thickness ?? thickness(params)}
        onChange={(v) => setParams({ thickness: v })}
      />
    </>
  );
}

const shell: FeatureUI<ShellFeature> = {
  type: "shell",
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
