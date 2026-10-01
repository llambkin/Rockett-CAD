import { newId, type SweepFeature } from "@rockett/shared";
import {
  OperationField,
  SelInfo,
  SelectField,
} from "../components/form/fields";
import { profiles, targets, type PickInput } from "../commands/featureCommand";
import { autoOperation, toolOperation } from "../extrudeReach";
import { useStore, type Selection } from "../store";
import { bodyTargets, profilePicks, profileRefs } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

const sketchPicks = (sketchId: string | undefined): Selection[] =>
  sketchId ? [{ kind: "sketch", sketchId }] : [];

const path: PickInput = {
  key: "path",
  providers: ["sketch.entity"],
  wholeSketch: true,
  one: true,
  param: {
    read: (s) => sketchPicks(s.dialogParams.pathSketchId),
    write: (next, s) =>
      s.setDialogParams({
        pathSketchId: next.flatMap((x) =>
          "sketchId" in x ? [x.sketchId] : [],
        )[0],
      }),
  },
};

function SweepForm({ params, setParams }: FeatureFormProps) {
  const features = useStore((s) => s.document?.features);
  const sketches = (features ?? []).filter((f) => f.type === "sketch");
  return (
    <>
      <SelInfo label="Profile" input="profiles" hint="click a sketch region" />
      <SelectField
        label="Path sketch"
        value={params.pathSketchId ?? ""}
        options={[
          ["", "Choose"],
          ...sketches.map((s) => [s.id, s.name] as [string, string]),
        ]}
        onChange={(v) => setParams({ pathSketchId: v })}
      />
      <SelInfo
        label="Path sketch"
        input="path"
        hint="click a curve of the path sketch"
      />
      <OperationField />
    </>
  );
}

const sweep: FeatureUI<SweepFeature> = {
  type: "sweep",
  icon: "〰",
  title: "Sweep",
  group: "create",
  picks: [profiles, path, targets],
  Form: SweepForm,
  build: (params, selection) => {
    const refs = profileRefs(selection);
    if (refs.length === 0) return { error: "Select a profile" };
    const pathSketchId = params.pathSketchId ?? "";
    if (!pathSketchId) return { error: "Choose a path sketch" };
    const operation = params.operation ?? "join";
    return {
      id: params.id ?? newId("sweep"),
      type: "sweep",
      name: params.name ?? "",
      suppressed: false,
      profiles: refs,
      pathSketchId,
      operation,
      ...bodyTargets(operation, params),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      targets: f.targets,
      pathSketchId: f.pathSketchId,
      operation: f.operation,
    },
    selection: profilePicks(f.profiles),
  }),
  onParamsChange: (params) => autoOperation(params, () => toolOperation()),
};

registerFeatureUI(sweep);
