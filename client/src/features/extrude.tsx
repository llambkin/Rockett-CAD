import { newId, type ExtrudeFeature } from "@rockett/shared";
import {
  LengthField,
  OperationField,
  SelectField,
  SelInfo,
} from "../components/form/fields";
import { profilesOrFaces, targets } from "../dialogPicks";
import { autoOperation, extrudeOperation } from "../extrudeReach";
import { useSetting } from "../settings";
import {
  bodyTargets,
  facePicks,
  handleValue,
  num,
  profilePicks,
  profileHint,
  profileSources,
  storedFeature,
} from "./inputs";
import {
  registerFeatureUI,
  type DialogParams,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

const distance = (params: DialogParams) => handleValue(params, "extrude");

function ExtrudeForm({ params, setParams }: FeatureFormProps) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Profiles / faces" input="profiles" hint={profileHint} />
      <LengthField
        label="Start offset"
        units={units}
        value={params.startOffset ?? 0}
        onChange={(v) => setParams({ startOffset: v })}
      />
      <div className="field-hint">
        0 = start on the sketch / face; ± moves the start plane along its normal
      </div>
      <LengthField
        label="Distance"
        units={units}
        autoFocus
        value={distance(params)}
        onChange={(v) => setParams({ distance: v })}
      />
      <div className="field-hint">
        Negative = the other side (Cut when it meets a body)
      </div>
      <SelectField
        label="Direction"
        value={params.direction ?? "normal"}
        options={[
          ["normal", "One side"],
          ["reverse", "Reversed"],
          ["symmetric", "Symmetric"],
          ["twoSided", "Two sided"],
        ]}
        onChange={(v) => setParams({ direction: v })}
      />
      {(params.direction ?? "normal") === "twoSided" && (
        <LengthField
          label="Distance 2"
          units={units}
          value={params.distance2 ?? 5}
          onChange={(v) => setParams({ distance2: v })}
        />
      )}
      <OperationField intersect />
    </>
  );
}

const extrude: FeatureUI<ExtrudeFeature> = {
  type: "extrude",
  icon: "⬆",
  title: "Extrude",
  group: "create",
  picks: [profilesOrFaces, targets],
  Form: ExtrudeForm,
  build: (params, selection) => {
    const stored = storedFeature(params.id);
    const sources = profileSources(selection, stored);
    if ("error" in sources) return sources;
    if (distance(params) === 0)
      return { error: "Extrude distance must be non-zero" };
    const direction = params.direction ?? "normal";
    const startOffset = num(params, "startOffset", 0);
    const operation = params.operation ?? "join";
    return {
      id: params.id ?? newId("extrude"),
      type: "extrude",
      name: params.name ?? "",
      suppressed: false,
      ...sources,
      distance: distance(params),
      ...((direction === "twoSided" || "distance2" in stored) && {
        distance2: num(params, "distance2", 5),
      }),
      ...((startOffset !== 0 || "startOffset" in stored) && { startOffset }),
      direction,
      operation,
      ...bodyTargets(operation, params),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      targets: f.targets,
      distance: f.distance,
      distance2: f.distance2,
      startOffset: f.startOffset ?? 0,
      direction: f.direction,
      operation: f.operation,
    },
    selection: [...profilePicks(f.profiles), ...facePicks(f.faces ?? [])],
  }),
  onParamsChange: (params) =>
    distance(params) === 0
      ? undefined
      : autoOperation(params, () =>
          extrudeOperation(
            params.direction ?? "normal",
            distance(params),
            num(params, "startOffset", 0),
            num(params, "distance2", 5),
          ),
        ),
};

registerFeatureUI(extrude);
