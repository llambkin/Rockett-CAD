import { newId, type RevolveFeature } from "@rockett/shared";
import {
  AxisField,
  AngleField,
  OperationField,
  SelInfo,
} from "../components/form/fields";
import {
  axis,
  clearInput,
  profilesOrFaces,
  targets,
} from "../commands/featureCommand";
import {
  autoOperation,
  toolBase,
  toolOperation,
  turnedCells,
} from "../extrudeReach";
import { findProfile, formatAngle } from "@rockett/shared";
import { RevolveGizmo, ringThrough, featureAxis } from "../three/RevolveGizmo";
import { uv3 } from "../three/CadViewport";
import {
  profileCentroid,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { previewedFeature } from "../store";
import { dragPreview } from "../toolTargets";
import type { FeatureGizmoContext, GizmoPointer } from "../three/featureGizmos";
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
  profilePicks,
  profileHint,
  profileSources,
  storedFeature,
  type AxisParams,
  num,
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

const handle = {
  param: "angle",
  fallback: 360,
} satisfies FeatureHandleDefinition<RevolveParams>;

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
      <AngleField
        label="Angle"
        autoFocus
        value={num(params, handle.param, handle.fallback)}
        onChange={(v) => setParams({ angle: v })}
        bind="/angle"
      />
      <OperationField intersect />
    </>
  );
}

function revolveGizmo(context: FeatureGizmoContext<RevolveParams>) {
  const state = useStore.getState();
  const selected = state.selection.find((s) => s.kind === "profile");
  if (selected?.kind !== "profile") return;
  const sketch = state.evaluation?.sketches.find(
    (s) => s.featureId === selected.sketchId,
  );
  const profile = sketch && findProfile(sketch, selected.profileId);
  if (!sketch || !profile) return;
  return new RevolveLayer(context, sketch, profile, !!previewedFeature(state));
}

type RevolveSketch = NonNullable<
  ReturnType<typeof useStore.getState>["evaluation"]
>["sketches"][number];
type RevolveProfile = NonNullable<ReturnType<typeof findProfile>>;

class RevolveLayer {
  private gizmo: RevolveGizmo | undefined;
  private source:
    | {
        axis: RevolveParams["axis"];
        axisSource: RevolveParams["axisSource"];
        geometry: ReturnType<typeof featureAxis>;
      }
    | undefined;
  constructor(
    private readonly context: FeatureGizmoContext<RevolveParams>,
    private readonly sketch: RevolveSketch,
    private readonly profile: RevolveProfile,
    private readonly editing: boolean,
  ) {
    this.sync();
  }
  get dragging() {
    return this.gizmo?.isDragging ?? false;
  }
  sync() {
    if (this.dragging) return;
    const params = this.context.params();
    if (
      !this.source ||
      this.source.axis !== params.axis ||
      this.source.axisSource !== params.axisSource
    ) {
      this.gizmo?.dispose();
      this.gizmo = undefined;
      this.source = {
        axis: params.axis,
        axisSource: params.axisSource,
        geometry: featureAxis(params),
      };
      const resolvedAxis = this.source.geometry;
      if (resolvedAxis) {
        const [u, v] = profileCentroid(this.profile);
        const ring = ringThrough(
          uv3(this.sketch.frame, u, v),
          resolvedAxis.origin,
          resolvedAxis.dir,
          this.context.host.worldPerPixel(),
        );
        this.gizmo = new RevolveGizmo(
          this.context.host,
          ring.center,
          ring.dir,
          ring.zeroDir,
          ring.radius,
          num(params, handle.param, handle.fallback),
        );
      }
    }
    this.gizmo?.update(num(params, handle.param, handle.fallback));
    this.syncGhost();
  }
  private syncGhost() {
    const resolvedAxis = this.source?.geometry;
    this.gizmo?.updateGhost(
      this.editing || !resolvedAxis
        ? undefined
        : {
            sketch: this.sketch,
            profile: this.profile,
            axis: resolvedAxis,
            angle: num(this.context.params(), handle.param, handle.fallback),
          },
    );
  }
  down(event: GizmoPointer) {
    if (!this.gizmo?.hitTest(event.clientX, event.clientY)) return false;
    this.gizmo.beginDrag(event.clientX, event.clientY);
    return this.dragging;
  }
  move(event: GizmoPointer) {
    if (!this.dragging || !this.gizmo) return false;
    const angle = this.gizmo.dragAngle(event.clientX, event.clientY);
    this.gizmo.update(angle);
    this.context.setParams({ angle });
    this.context.label({
      ...this.gizmo.handleScreenPosition(),
      text: formatAngle(angle, 3),
    });
    this.syncGhost();
    this.preview("during");
    return true;
  }
  private preview(action: "during" | "commit") {
    const active = useStore.getState().active;
    const angle = Number(this.context.params().angle);
    if (
      active?.id === "design.feature" &&
      active.state.type === "revolve" &&
      active.state.editFeatureId &&
      Number.isFinite(angle) &&
      angle !== 0
    )
      dragPreview[action](active.state.editFeatureId, { angle });
  }
  up() {
    if (!this.dragging) return false;
    this.gizmo?.endDrag();
    this.context.label(null);
    this.preview("commit");
    this.sync();
    return true;
  }
  cancel() {
    this.gizmo?.endDrag();
    this.context.label(null);
    this.sync();
  }
  hover(event: GizmoPointer) {
    if (!this.dragging)
      this.gizmo?.setHover(this.gizmo.hitTest(event.clientX, event.clientY));
  }
  dispose() {
    this.gizmo?.dispose();
  }
}

function revolveCells(params: RevolveParams) {
  const resolved = featureAxis(params);
  if (!resolved) return [];
  const angle = num(params, handle.param, handle.fallback);
  const turn =
    (Math.sign(angle) * Math.min(Math.abs(angle), 360) * Math.PI) / 180;
  return turnedCells(
    useStore
      .getState()
      .selection.flatMap((sel) => toolBase(sel)?.triangles ?? []),
    resolved.origin.toArray(),
    resolved.dir.toArray(),
    turn,
  );
}

export const revolve: FeatureUI<RevolveFeature, RevolveParams> = {
  type: "revolve",
  handle,
  initialParams: {},
  gizmo: revolveGizmo,
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
      angle: num(params, handle.param, handle.fallback),
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
  onParamsChange: (params) =>
    autoOperation(params, () => toolOperation(revolveCells(params))),
};

registerFeatureUI(revolve);
