import {
  arrow,
  faceRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type ShellFeature } from "@rockett/shared";
import { LengthField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { facePicks, faceRefs, num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type ShellParams = InputParams<
  Pick<ShellFeature, "id" | "name" | "thickness">
>;

const handle = {
  param: "thickness",
  fallback: 2,
  signed: false,
  place: (input) => {
    const ray = faceRay(input.bodies, first(input, "face"));
    return arrow(ray && { origin: ray.origin, axis: ray.axis.negate() });
  },
} satisfies FeatureHandleDefinition<ShellParams>;

const thickness = (params: ShellParams) =>
  num(params, handle.param, handle.fallback);

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
  handle,
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
