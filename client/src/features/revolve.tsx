import { newId, type RevolveFeature } from "@rockett/shared";
import {
  AxisField,
  NumField,
  OperationField,
  SelInfo,
} from "../components/form/fields";
import {
  axis,
  clearInput,
  profilesOrFaces,
  targets,
} from "../commands/featureCommand";
import { autoOperation, toolOperation } from "../extrudeReach";
import { useStore } from "../store";
import {
  axisHint,
  axisMissing,
  axisParams,
  axisPicks,
  axisRef,
  axisSelection,
  bodyTargets,
  facePicks,
  handleValue,
  profilePicks,
  profileHint,
  profileSources,
  storedFeature,
  type AxisParams,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type RevolveParams = InputParams<
  Pick<RevolveFeature, "id" | "name" | "angle" | "operation" | "targets">
> &
  AxisParams & { autoOperation?: boolean | undefined };

function RevolveForm({ params, setParams }: FeatureFormProps<RevolveParams>) {
  const selection = useStore((s) => s.selection);
  const document = useStore((s) => s.document);
  return (
    <>
      <SelInfo label="Profiles / faces" input="profiles" hint={profileHint} />
      <SelInfo
        label="Axis"
        input="axis"
        picks={axisPicks(selection, document)}
        hint={axisHint(axisMissing(params, selection, document))}
      />
      <AxisField
        axisSource={params.axisSource}
        axis={params.axis}
        onChange={(patch) => {
          setParams(patch);
          clearInput("axis");
        }}
      />
      <NumField
        label="Angle (°)"
        autoFocus
        value={handleValue(params, "revolve")}
        onChange={(v) => setParams({ angle: v })}
      />
      <OperationField intersect />
    </>
  );
}

export const revolve: FeatureUI<RevolveFeature, RevolveParams> = {
  type: "revolve",
  initialParams: {},
  icon: "↻",
  title: "Revolve",
  group: "create",
  picks: [profilesOrFaces, axis, targets],
  Form: RevolveForm,
  build: (params, selection) => {
    const sources = profileSources(selection, storedFeature(params.id));
    if ("error" in sources) return sources;
    const axisOf = axisRef(params, selection, useStore.getState().document);
    if (!axisOf) return { error: "Pick an axis" };
    const operation = params.operation ?? "join";
    return {
      id: params.id ?? newId("revolve"),
      type: "revolve",
      name: params.name ?? "",
      suppressed: false,
      ...sources,
      axis: axisOf,
      angle: handleValue(params, "revolve"),
      operation,
      ...bodyTargets(operation, params),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      targets: f.targets,
      angle: f.angle,
      operation: f.operation,
      ...axisParams(f.axis),
    },
    selection: [
      ...profilePicks(f.profiles),
      ...facePicks(f.faces ?? []),
      ...axisSelection(f.axis),
    ],
  }),
  onParamsChange: (params) => autoOperation(params, () => toolOperation()),
};

registerFeatureUI(revolve);
