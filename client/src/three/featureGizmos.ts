import type { SharedInputParams } from "../features/registry";
import { setFeatureParams } from "../commands/featureCommand";
import { useStore } from "../store";
import type { ManipulatorHost } from "./Manipulator";
import type { LayerHandle } from "./sceneLayers";

export type GizmoPointer = Pick<
  PointerEvent,
  "clientX" | "clientY" | "ctrlKey" | "metaKey"
>;

export type GizmoLabel = { x: number; y: number; text: string } | null;

export interface FeatureGizmoContext<P> {
  host: ManipulatorHost;
  params: () => P;
  setParams(patch: Partial<P>): void;
  label(value: GizmoLabel): void;
}

export interface FeatureGizmo {
  readonly dragging: boolean;
  sync(): void;
  down(event: GizmoPointer): boolean;
  move(event: GizmoPointer): boolean;
  up(): boolean;
  cancel(): void;
  hover(event: GizmoPointer): void;
  dispose(): void;
}

export class FeatureGizmos {
  private readonly layer: LayerHandle;
  private readonly host: ManipulatorHost;
  private readonly unsubscribe: () => void;
  private current: FeatureGizmo | undefined;
  private previous = useStore.getState();
  private lifetime: object | undefined;
  private invalidated = false;
  private gesture: { target: FeatureGizmo | undefined } | undefined;
  private live = true;

  constructor(
    viewport: ManipulatorHost & { addLayer(id: string): LayerHandle },
    private readonly label: (value: GizmoLabel) => void,
  ) {
    this.layer = viewport.addLayer("featureGizmo");
    this.host = {
      scene: this.layer.group,
      get camera() {
        return viewport.camera;
      },
      worldPerPixel: () => viewport.worldPerPixel(),
      canvasRect: () => viewport.canvasRect(),
      requestRender: () => viewport.requestRender(),
    };
    this.refresh();
    this.unsubscribe = useStore.subscribe(() => this.refresh());
  }

  refresh(force = false) {
    if (!this.live) return;
    const state = useStore.getState();
    const inputs =
      state.active?.id === "design.feature" && state.active.state.inputs;
    const nextLifetime = inputs ? inputs.lifetime : undefined;
    this.invalidated ||=
      force ||
      state.selection !== this.previous.selection ||
      state.evaluation !== this.previous.evaluation;
    if (
      nextLifetime !== this.lifetime ||
      (!this.current?.dragging && this.invalidated)
    ) {
      if (this.gesture?.target === this.current && this.gesture)
        this.gesture.target = undefined;
      this.current?.dispose();
      this.current = undefined;
      this.label(null);
      this.lifetime = nextLifetime;
      this.invalidated = false;
    }
    const oldParams =
      this.previous.active?.id === "design.feature"
        ? this.previous.active.state.inputs.params
        : undefined;
    const created = !this.current;
    if (!this.current && inputs) {
      this.current = inputs.gizmo(
        this.host,
        this.label,
        () => {
          const active = useStore.getState().active;
          return active?.id === "design.feature" &&
            active.state.inputs.lifetime === this.lifetime
            ? active.state.inputs.params
            : {};
        },
        (patch: SharedInputParams) => setFeatureParams(patch, inputs.lifetime),
      );
    }
    if (created || (inputs && inputs.params !== oldParams))
      this.current?.sync();
    this.previous = state;
  }

  down(event: GizmoPointer) {
    if (!this.current?.down(event)) return false;
    this.gesture = { target: this.current };
    return true;
  }

  move(event: GizmoPointer) {
    if (!this.gesture) return false;
    this.gesture.target?.move(event);
    return true;
  }

  private finishGesture(action: "up" | "cancel") {
    if (!this.gesture) return false;
    const target = this.gesture.target;
    this.gesture = undefined;
    target?.[action]();
    this.refresh();
    return true;
  }

  up() {
    return this.finishGesture("up");
  }
  cancel() {
    return this.finishGesture("cancel");
  }
  hover(event: GizmoPointer) {
    this.current?.hover(event);
  }

  dispose = () => {
    this.live = false;
    this.gesture = undefined;
    this.unsubscribe();
    this.current?.dispose();
    this.current = undefined;
    this.label(null);
    this.layer.dispose();
  };
}
