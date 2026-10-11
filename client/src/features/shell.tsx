import {
  arrow,
  faceRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type ShellDirection, type ShellFeature } from "@rockett/shared";
import { LengthField, SelectField, SelInfo } from "../components/form/fields";
import { useSetting } from "../settings";
import { bodyIds, bodyPicks, facePicks, faceRefs, num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type ShellParams = InputParams<
  Pick<ShellFeature, "id" | "name" | "thickness" | "outsideThickness"> & {
    shellDirection: ShellDirection;
  }
>;

const handle = {
  param: "thickness",
  fallback: 2,
  signed: false,
  place: (input) => {
    const ray = faceRay(input.bodies, first(input, "face"));
    const outward = input.params.shellDirection === "outside";
    return arrow(
      ray && {
        origin: ray.origin,
        axis: outward ? ray.axis : ray.axis.negate(),
      },
    );
  },
} satisfies FeatureHandleDefinition<ShellParams>;

const thickness = (params: ShellParams) =>
  num(params, handle.param, handle.fallback);
const outsideThickness = (params: ShellParams) =>
  num(params, "outsideThickness", handle.fallback);

function ShellForm({ params, setParams }: FeatureFormProps<ShellParams>) {
  const units = useSetting("units.length");
  const direction = params.shellDirection ?? "inside";
  return (
    <>
      <SelInfo
        label="Faces to remove"
        input="faces"
        hint="click faces to open"
      />
      <SelInfo label="Body" input="body" hint="click the body to hollow" />
      <SelectField
        label="Direction"
        value={direction}
        options={[
          ["inside", "Inside"],
          ["outside", "Outside"],
          ["both", "Both sides"],
        ]}
        onChange={(v) => setParams({ shellDirection: v })}
      />
      <LengthField
        label={direction === "both" ? "Inside thickness" : "Thickness"}
        units={units}
        autoFocus
        value={thickness(params)}
        onChange={(v) => setParams({ thickness: v })}
        bind="/thickness"
      />
      {direction === "both" && (
        <LengthField
          label="Outside thickness"
          units={units}
          value={outsideThickness(params)}
          onChange={(v) => setParams({ outsideThickness: v })}
          bind="/outsideThickness"
        />
      )}
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
  picks: [
    { key: "faces", providers: ["design.face"] },
    { key: "body", providers: ["design.body"], one: true, optional: true },
  ],
  Form: ShellForm,
  build: (params, selection) => {
    const [body] = bodyIds(selection);
    const direction = params.shellDirection ?? "inside";
    return {
      id: params.id ?? newId("shell"),
      type: "shell",
      name: params.name ?? "",
      suppressed: false,
      openFaces: faceRefs(selection),
      direction,
      thickness: thickness(params),
      ...(direction === "both" && {
        outsideThickness: outsideThickness(params),
      }),
      ...(body !== undefined && { body }),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      shellDirection: f.direction,
      thickness: f.thickness,
      outsideThickness: f.outsideThickness,
    },
    selection: [
      ...facePicks(f.openFaces),
      ...bodyPicks(f.body === undefined ? [] : [f.body]),
    ],
  }),
};

registerFeatureUI(shell);
