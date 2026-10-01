import type { FeatureHandleDefinition } from "../three/featureHandles";
import { newId, type ExtrudeFeature } from "@rockett/shared";
import {
  LengthField,
  OperationField,
  SelectField,
  SelInfo,
} from "../components/form/fields";
import { profilesOrFaces, targets } from "../commands/featureCommand";
import { autoOperation, extrudeOperation } from "../extrudeReach";
import { ExtrudeGizmo, extrudeGizmoSource } from "../three/ExtrudeGizmo";
import type { FeatureGizmoContext, GizmoPointer } from "../three/featureGizmos";
import { dragPreview } from "../toolTargets";
import { previewedFeature, useStore } from "../store";
import { formatLength } from "@rockett/shared";
import { getSetting, useSetting } from "../settings";
import {
  bodyTargets,
  facePicks,
  num,
  profilePicks,
  profileHint,
  profileSources,
  storedFeature,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type ExtrudeParams = InputParams<
  Pick<
    ExtrudeFeature,
    | "id"
    | "name"
    | "distance"
    | "distance2"
    | "startOffset"
    | "direction"
    | "operation"
    | "targets"
  >
> & { autoOperation?: boolean | undefined };

const handle = {
  param: "distance",
  fallback: 10,
} satisfies FeatureHandleDefinition<ExtrudeParams>;

const distance = (params: ExtrudeParams) =>
  num(params, handle.param, handle.fallback);

function ExtrudeForm({ params, setParams }: FeatureFormProps<ExtrudeParams>) {
  const units = useSetting("units.length");
  return (
    <>
      <SelInfo label="Profiles / faces" input="profiles" hint={profileHint} />
      <LengthField
        label="Start offset"
        units={units}
        value={num(params, "startOffset", 0)}
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
          value={num(params, "distance2", 5)}
          onChange={(v) => setParams({ distance2: v })}
        />
      )}
      <OperationField intersect />
    </>
  );
}

function extrudeEditPreview(current: ExtrudeParams) {
  const state = useStore.getState().active;
  if (
    state?.id !== "design.feature" ||
    state.state.type !== "extrude" ||
    !state.state.editFeatureId
  )
    return;
  const value = Number(current.distance);
  if (!Number.isFinite(value)) return;
  return {
    id: state.state.editFeatureId,
    patch:
      value === 0
        ? { suppressed: true }
        : {
            suppressed: false,
            distance: value,
            direction: current.direction ?? "normal",
            ...(current.operation && { operation: current.operation }),
          },
  };
}

function extrudeDragParams(
  params: ExtrudeParams,
  value: number,
  zeroed: boolean,
) {
  const direction = params.direction ?? "normal";
  const patch: Partial<ExtrudeParams> = { distance: Math.abs(value) };
  if (!zeroed && (direction === "normal" || direction === "reverse"))
    patch.direction = value < 0 ? "reverse" : "normal";
  const next = { ...params, ...patch };
  return { ...patch, ...extrude.onParamsChange?.(next) };
}

function extrudeGizmo({
  host,
  params,
  setParams,
  label,
}: FeatureGizmoContext<ExtrudeParams>) {
  const source = extrudeGizmoSource();
  if (!source) return;
  if (previewedFeature(useStore.getState())) {
    source.profile = undefined;
    source.faceGhost = undefined;
  }
  const sign = () => (params().direction === "reverse" ? -1 : 1);
  const gizmo = new ExtrudeGizmo(
    host,
    source,
    sign() * distance(params()),
    (params().operation ?? "join") === "cut",
    num(params(), "startOffset", 0),
  );
  let dragging = false;
  return {
    get dragging() {
      return dragging;
    },
    sync() {
      gizmo.setCut((params().operation ?? "join") === "cut");
      if (dragging) return;
      gizmo.setStartOffset(num(params(), "startOffset", 0));
      const value = Number(params().distance);
      if (Number.isFinite(value)) gizmo.update(sign() * value);
    },
    down(event: GizmoPointer) {
      if (!gizmo.hitTest(event.clientX, event.clientY)) return false;
      dragging = true;
      return true;
    },
    move(event: GizmoPointer) {
      if (!dragging) return false;
      const zeroed = event.ctrlKey || event.metaKey;
      const value = zeroed ? 0 : gizmo.dragValue(event.clientX, event.clientY);
      if (zeroed || Math.abs(value) > 1e-9) {
        gizmo.update(value);
        setParams(extrudeDragParams(params(), value, zeroed));
        const tip = gizmo.tipScreenPosition();
        label({
          ...tip,
          text: formatLength(
            zeroed ? 0 : Math.abs(value),
            getSetting("units.length"),
          ),
        });
        const edit = extrudeEditPreview(params());
        if (edit) dragPreview.during(edit.id, edit.patch);
      }
      return true;
    },
    up() {
      if (!dragging) return false;
      dragging = false;
      gizmo.endDrag();
      label(null);
      const edit = extrudeEditPreview(params());
      if (edit) dragPreview.commit(edit.id, edit.patch);
      return true;
    },
    cancel() {
      dragging = false;
      gizmo.endDrag();
      label(null);
    },
    hover(event: GizmoPointer) {
      gizmo.setHover(gizmo.hitTest(event.clientX, event.clientY));
    },
    dispose() {
      dragging = false;
      gizmo.dispose();
    },
  };
}

export const extrude: FeatureUI<ExtrudeFeature, ExtrudeParams> = {
  type: "extrude",
  handle,
  initialParams: {},
  gizmo: extrudeGizmo,
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
