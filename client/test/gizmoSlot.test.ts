import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GizmoSlot } from "../src/three/gizmoSlot";
import { Manipulator, type ManipulatorHost } from "../src/three/Manipulator";

const host: ManipulatorHost = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  worldPerPixel: () => 1,
  canvasRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  requestRender: () => {},
};

class StubGizmo extends Manipulator {}

function stub() {
  const gizmo = new StubGizmo(host);
  return Object.assign(gizmo, { disposeSpy: vi.spyOn(gizmo, "dispose") });
}

function slotWithGizmo() {
  const slot = new GizmoSlot<StubGizmo>();
  const gizmo = stub();
  slot.rebuild(() => gizmo);
  return { slot, gizmo };
}

describe("GizmoSlot", () => {
  it("keeps the dragged gizmo when rebuilt during a drag", () => {
    const { slot, gizmo } = slotWithGizmo();
    const build = vi.fn(stub);
    slot.beginDrag();
    slot.rebuild(build);
    expect(slot.isDragging).toBe(true);
    expect(slot.current).toBe(gizmo);
    expect(build).not.toHaveBeenCalled();
    expect(gizmo.disposeSpy).not.toHaveBeenCalled();
  });

  it("disposes the old gizmo exactly once when rebuilt after endDrag", () => {
    const { slot, gizmo } = slotWithGizmo();
    const next = stub();
    slot.beginDrag();
    slot.endDrag();
    slot.rebuild(() => next);
    expect(slot.isDragging).toBe(false);
    expect(gizmo.disposeSpy).toHaveBeenCalledTimes(1);
    expect(slot.current).toBe(next);
  });

  it("disposes the old gizmo before building the next", () => {
    const { slot, gizmo } = slotWithGizmo();
    let disposedFirst = false;
    slot.rebuild(() => {
      disposedFirst = gizmo.disposeSpy.mock.calls.length === 1;
      return null;
    });
    expect(disposedFirst).toBe(true);
    expect(slot.current).toBeNull();
  });

  it("disposes and clears current on release", () => {
    const { slot, gizmo } = slotWithGizmo();
    slot.release();
    expect(gizmo.disposeSpy).toHaveBeenCalledTimes(1);
    expect(slot.current).toBeNull();
  });
});
