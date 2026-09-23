import type { Manipulator } from "./Manipulator";

export class GizmoSlot<T extends Manipulator> {
  private gizmo: T | null = null;
  private dragging = false;

  get current(): T | null {
    return this.gizmo;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  rebuild(build: () => T | null) {
    if (this.dragging) return;
    this.release();
    this.gizmo = build();
  }

  release() {
    this.gizmo?.dispose();
    this.gizmo = null;
  }

  beginDrag() {
    this.dragging = true;
  }

  endDrag() {
    this.dragging = false;
    this.gizmo?.endDrag();
  }
}
