import type { FeatureHandleDefinition } from "../three/featureHandles";
import {
  newId,
  type BodyRef,
  type ExtrudeFeature,
  type PlaneRef,
} from "@rockett/shared";
import {
  AngleField,
  LengthField,
  OperationField,
  SelectField,
  SelInfo,
} from "../components/form/fields";
import {
  featureParams,
  planar,
  profilesOrFaces,
  setFeatureParams,
  targets,
  type PickInput,
} from "../commands/featureCommand";
import { fromRef, refsOf } from "../selection/kinds";
import { autoOperation, extrudeOperation } from "../extrudeReach";
import { ExtrudeGizmo, extrudeGizmoSource } from "../three/ExtrudeGizmo";
import type { FeatureGizmoContext, GizmoPointer } from "../three/featureGizmos";
import { dragPreview } from "../toolTargets";
import {
  curves,
  thinPart,
  thinPrefill,
  ThinFields,
  ThinToggle,
  type ThinParams,
} from "./extrudeThin";
import { previewedFeature, useStore, type Selection } from "../store";
import { formatLength } from "@rockett/shared";
import { getSetting, useSetting } from "../settings";
import {
  bodyTargets,
  facePicks,
  num,
  profilePicks,
  profileHint,
  profileSources,
  selectedPlane,
  storedFeature,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
  type SharedInputParams,
} from "./registry";

export type ExtrudeParams = InputParams<
  Pick<
    ExtrudeFeature,
    | "id"
    | "name"
    | "distance"
    | "distance2"
    | "startOffset"
    | "taper"
    | "taper2"
    | "direction"
    | "operation"
    | "targets"
  >
> &
  Pick<SharedInputParams, "start" | "startObject" | "extent" | "extentObject"> &
  ThinParams & {
    autoOperation?: boolean | undefined;
  };

const objectInput = (
  key: "startObject" | "extentObject",
  more: readonly string[],
): PickInput => {
  const plane = planar(key, true);
  return {
    ...plane,
    providers: [...plane.providers, ...more],
    optional: true,
    param: {
      read: (s) => featureParams(s)[key] ?? [],
      write: (next) => setFeatureParams({ [key]: next }),
    },
  };
};

const startObject = objectInput("startObject", []);
const extentObject = objectInput("extentObject", ["design.body"]);

const planePicks = (ref: PlaneRef): Selection[] =>
  ref.kind === "face" ? [fromRef("face", ref.face)] : [fromRef("plane", ref)];

const objectRef = (picks: Selection[]): PlaneRef | BodyRef | null => {
  const [bodyId] = refsOf(picks, "body");
  return bodyId ? { kind: "body", bodyId } : selectedPlane(picks);
};

const objectPicks = (extent: ExtrudeFeature["extent"]): Selection[] =>
  extent?.kind !== "toObject"
    ? []
    : extent.object.kind === "body"
      ? [fromRef("body", extent.object.bodyId)]
      : planePicks(extent.object);

const handle = {
  param: "distance",
  fallback: 10,
} satisfies FeatureHandleDefinition<ExtrudeParams>;

const byDistanceFromPlane = (params: ExtrudeParams) =>
  (params.extent ?? "distance") === "distance" && startOf(params) !== "object";

const distance = (params: ExtrudeParams) =>
  num(params, handle.param, handle.fallback);

const startOf = (params: ExtrudeParams) =>
  params.start ?? (num(params, "startOffset", 0) !== 0 ? "offset" : "profile");

const offsetOf = (params: ExtrudeParams) =>
  startOf(params) === "offset" ? num(params, "startOffset", 0) : 0;

function StartFields({ params, setParams }: FeatureFormProps<ExtrudeParams>) {
  const units = useSetting("units.length");
  const start = startOf(params);
  return (
    <>
      <SelectField
        label="Start"
        value={start}
        options={[
          ["profile", "Profile plane"],
          ["offset", "Offset"],
          ["object", "Object"],
        ]}
        onChange={(v) => setParams({ start: v })}
      />
      {start === "offset" && (
        <>
          <LengthField
            label="Start offset"
            units={units}
            value={num(params, "startOffset", 0)}
            onChange={(v) => setParams({ startOffset: v })}
            bind="/startOffset"
          />
          <div className="field-hint">
            ± moves the start plane along the profile normal
          </div>
        </>
      )}
      {start === "object" && (
        <SelInfo
          label="Start object"
          input="startObject"
          hint="click a plane or planar face to start on"
        />
      )}
    </>
  );
}

const twoSided = (params: ExtrudeParams) =>
  params.extent !== "toObject" && (params.direction ?? "normal") === "twoSided";

function TaperFields({ params, setParams }: FeatureFormProps<ExtrudeParams>) {
  return (
    <>
      <AngleField
        label="Taper angle"
        value={num(params, "taper", 0)}
        onChange={(v) => setParams({ taper: v })}
        bind="/taper"
      />
      {twoSided(params) && (
        <AngleField
          label="Taper angle 2"
          value={num(params, "taper2", 0)}
          onChange={(v) => setParams({ taper2: v })}
          bind="/taper2"
        />
      )}
      <div className="field-hint">
        Negative narrows the solid, positive widens it
      </div>
    </>
  );
}

function ExtrudeForm({ params, setParams }: FeatureFormProps<ExtrudeParams>) {
  const units = useSetting("units.length");
  const extent = params.extent ?? "distance";
  return (
    <>
      <SelInfo label="Profiles / faces" input="profiles" hint={profileHint} />
      <ThinToggle params={params} setParams={setParams} />
      <StartFields params={params} setParams={setParams} />
      <SelectField
        label="Extent"
        value={extent}
        options={[
          ["distance", "Distance"],
          ["toObject", "To object"],
          ["all", "All"],
        ]}
        onChange={(v) => setParams({ extent: v })}
      />
      {extent === "distance" && (
        <>
          <LengthField
            label="Distance"
            units={units}
            autoFocus
            value={distance(params)}
            onChange={(v) => setParams({ distance: v })}
            bind="/distance"
          />
          <div className="field-hint">
            Negative = the other side (Cut when it meets a body)
          </div>
        </>
      )}
      {extent === "toObject" && (
        <SelInfo
          label="Object"
          input="extentObject"
          hint="click a plane, planar face or body to stop on"
        />
      )}
      {extent !== "toObject" && (
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
      )}
      {twoSided(params) && (
        <LengthField
          label="Distance 2"
          units={units}
          value={num(params, "distance2", 5)}
          onChange={(v) => setParams({ distance2: v })}
          bind="/distance2"
        />
      )}
      <TaperFields params={params} setParams={setParams} />
      <ThinFields params={params} setParams={setParams} />
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
  if (!source || !byDistanceFromPlane(params())) return;
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
    offsetOf(params()),
  );
  let dragging = false;
  return {
    get dragging() {
      return dragging;
    },
    sync() {
      gizmo.setCut((params().operation ?? "join") === "cut");
      if (dragging) return;
      gizmo.setStartOffset(offsetOf(params()));
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
  picks: [profilesOrFaces, curves, targets, startObject, extentObject],
  picksFor: (params) =>
    extrude.picks.filter((input) => params.thin || input !== curves),
  Form: ExtrudeForm,
  build: (params, selection) => {
    const stored = storedFeature(params.id);
    const thin = thinPart(params, selection, stored);
    if ("error" in thin) return thin;
    const sources = profileSources(selection, stored);
    if ("error" in sources && !thin.curves?.length) return sources;
    if (distance(params) === 0)
      return { error: "Extrude distance must be non-zero" };
    const extent = params.extent ?? "distance";
    const start = startOf(params);
    const startPlane = selectedPlane(params.startObject ?? []);
    if (start === "object" && !startPlane)
      return { error: "Select a plane or planar face to start on" };
    const object = objectRef(params.extentObject ?? []);
    if (extent === "toObject" && !object)
      return { error: "Select a plane, planar face or body to extrude to" };
    const chosen = params.direction ?? "normal";
    const direction =
      extent === "toObject" && (chosen === "symmetric" || chosen === "twoSided")
        ? "normal"
        : chosen;
    const startOffset = offsetOf(params);
    const taper = num(params, "taper", 0);
    const taper2 = num(params, "taper2", 0);
    const operation = params.operation ?? "join";
    return {
      id: params.id ?? newId("extrude"),
      type: "extrude",
      name: params.name ?? "",
      suppressed: false,
      ...("error" in sources ? { profiles: [] } : sources),
      ...thin,
      distance: distance(params),
      ...((direction === "twoSided" || "distance2" in stored) && {
        distance2: num(params, "distance2", 5),
      }),
      ...((startOffset !== 0 || "startOffset" in stored) && { startOffset }),
      ...((taper !== 0 || "taper" in stored) && { taper }),
      ...(((direction === "twoSided" && taper2 !== 0) ||
        "taper2" in stored) && {
        taper2,
      }),
      ...(start === "object" && startPlane && { startObject: startPlane }),
      ...(extent === "all" && { extent: { kind: "all" as const } }),
      ...(extent === "toObject" &&
        object && { extent: { kind: "toObject" as const, object } }),
      direction,
      operation,
      ...bodyTargets(operation, params),
    };
  },
  prefill: (f) => ({
    params: {
      ...thinPrefill(f).params,
      id: f.id,
      name: f.name,
      targets: f.targets,
      distance: f.distance,
      distance2: f.distance2,
      startOffset: f.startOffset ?? 0,
      taper: f.taper ?? 0,
      taper2: f.taper2 ?? 0,
      start: f.startObject ? "object" : f.startOffset ? "offset" : "profile",
      startObject: f.startObject ? planePicks(f.startObject) : [],
      extent: f.extent?.kind,
      extentObject: objectPicks(f.extent),
      direction: f.direction,
      operation: f.operation,
    },
    selection: [
      ...profilePicks(f.profiles),
      ...facePicks(f.faces ?? []),
      ...thinPrefill(f).picks,
    ],
  }),
  onParamsChange: (params) =>
    distance(params) === 0
      ? undefined
      : autoOperation(params, () =>
          extrudeOperation(
            params.direction ?? "normal",
            distance(params),
            offsetOf(params),
            num(params, "distance2", 5),
          ),
        ),
};

registerFeatureUI(extrude);
