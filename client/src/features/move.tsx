import { formatLength, newId, type MoveFeature } from "@rockett/shared";
import {
  AngleField,
  AxisField,
  CheckField,
  LengthField,
  SelInfo,
} from "../components/form/fields";
import { getSetting, useSetting } from "../settings";
import { axis, bodies, clearInput } from "../commands/featureCommand";
import * as THREE from "three";
import { MoveGizmo } from "../three/MoveGizmo";
import { baseBodies } from "../previewBase";
import { previewedFeature, useStore } from "../store";
import { dragPreview } from "../toolTargets";
import type { FeatureGizmoContext, GizmoPointer } from "../three/featureGizmos";
import {
  axisHint,
  axisMissing,
  axisParams,
  axisPicks,
  axisRef,
  axisSelection,
  bodyIds,
  bodyPicks,
  num,
  type AxisParams,
} from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";

export type MoveParams = InputParams<
  Pick<MoveFeature, "id" | "name" | "angle" | "copy">
> &
  AxisParams &
  InputParams<{
    tx: MoveFeature["translation"][0];
    ty: MoveFeature["translation"][1];
    tz: MoveFeature["translation"][2];
  }>;

function MoveForm({ params, setParams }: FeatureFormProps<MoveParams>) {
  const units = useSetting("units.length");
  const selection = useStore((s) => s.selection);
  const document = useStore((s) => s.document);
  return (
    <>
      <SelInfo label="Bodies" input="bodies" hint="click bodies" />
      <LengthField
        label="X"
        units={units}
        autoFocus
        value={num(params, "tx", 0)}
        onChange={(v) => setParams({ tx: v })}
        bind="/translation/0"
      />
      <LengthField
        label="Y"
        units={units}
        value={num(params, "ty", 0)}
        onChange={(v) => setParams({ ty: v })}
        bind="/translation/1"
      />
      <LengthField
        label="Z"
        units={units}
        value={num(params, "tz", 0)}
        onChange={(v) => setParams({ tz: v })}
        bind="/translation/2"
      />
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
        value={num(params, "angle", 0)}
        onChange={(v) => setParams({ angle: v })}
        bind="/angle"
      />
      <CheckField
        label="Create copy"
        value={!!(params.copy ?? false)}
        onChange={(v) => setParams({ copy: v })}
      />
    </>
  );
}

function translation(params: MoveParams): [number, number, number] {
  return [num(params, "tx", 0), num(params, "ty", 0), num(params, "tz", 0)];
}

function moveGizmo(context: FeatureGizmoContext<MoveParams>) {
  const state = useStore.getState();
  const ids = new Set(bodyIds(state.selection));
  const selectedBodies = baseBodies(state).filter((body) =>
    ids.has(body.bodyId),
  );
  if (!selectedBodies.length) return;
  const center = new THREE.Vector3();
  for (const body of selectedBodies)
    center.add(
      new THREE.Vector3(...body.bbox.min)
        .add(new THREE.Vector3(...body.bbox.max))
        .multiplyScalar(0.5),
    );
  center.divideScalar(selectedBodies.length);
  return new MoveLayer(
    context,
    new MoveGizmo(
      context.host,
      center,
      translation(context.params()),
      previewedFeature(state) ? [] : selectedBodies,
    ),
  );
}

class MoveLayer {
  constructor(
    private readonly context: FeatureGizmoContext<MoveParams>,
    private readonly gizmo: MoveGizmo,
  ) {}
  get dragging() {
    return this.gizmo.isDragging;
  }
  sync() {
    if (!this.dragging) this.gizmo.update(translation(this.context.params()));
  }
  down(event: GizmoPointer) {
    const hit = this.gizmo.hitTest(event.clientX, event.clientY);
    if (hit < 0) return false;
    this.gizmo.beginDrag(hit, event.clientX, event.clientY);
    return true;
  }
  move(event: GizmoPointer) {
    if (!this.dragging) return false;
    const offset = this.gizmo.dragOffset(event.clientX, event.clientY);
    this.gizmo.update(offset);
    this.context.setParams({ tx: offset[0], ty: offset[1], tz: offset[2] });
    const tip = this.gizmo.tipScreenPosition();
    if (tip)
      this.context.label({
        ...tip,
        text: `${["X", "Y", "Z"][this.gizmo.draggingAxis] ?? ""}: ${formatLength(offset[this.gizmo.draggingAxis] ?? 0, getSetting("units.length"))}`,
      });
    const edit = this.edit();
    if (edit) dragPreview.during(edit, { translation: offset });
    return true;
  }
  private edit() {
    const active = useStore.getState().active;
    return active?.id === "design.feature" && active.state.type === "move"
      ? active.state.editFeatureId
      : undefined;
  }
  up() {
    if (!this.dragging) return false;
    this.gizmo.endDrag();
    this.context.label(null);
    const edit = this.edit();
    if (edit)
      dragPreview.commit(edit, {
        translation: translation(this.context.params()),
      });
    return true;
  }
  cancel() {
    this.gizmo.endDrag();
    this.context.label(null);
  }
  hover(event: GizmoPointer) {
    if (!this.dragging)
      this.gizmo.setHover(this.gizmo.hitTest(event.clientX, event.clientY));
  }
  dispose() {
    this.gizmo.dispose();
  }
}

export const move: FeatureUI<MoveFeature, MoveParams> = {
  type: "move",
  initialParams: {},
  gizmo: moveGizmo,
  icon: "✥",
  title: "Move",
  group: "modify",
  picks: [bodies, axis],
  Form: MoveForm,
  build: (params, selection) => {
    const ids = bodyIds(selection);
    if (ids.length === 0) return { error: "Select at least one body" };
    const axisOf = axisRef(params, selection, useStore.getState().document);
    if (!axisOf) return { error: "Pick an axis" };
    return {
      id: params.id ?? newId("move"),
      type: "move",
      name: params.name ?? "",
      suppressed: false,
      bodies: ids,
      translation: [
        num(params, "tx", 0),
        num(params, "ty", 0),
        num(params, "tz", 0),
      ],
      axis: axisOf,
      angle: num(params, "angle", 0),
      copy: !!(params.copy ?? false),
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      tx: f.translation[0],
      ty: f.translation[1],
      tz: f.translation[2],
      angle: f.angle,
      copy: f.copy,
      ...axisParams(f.axis),
    },
    selection: [...bodyPicks(f.bodies), ...axisSelection(f.axis)],
  }),
};

registerFeatureUI(move);
