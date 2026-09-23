import * as THREE from "three";
import { disposeGroup } from "./dispose";
import { clientToNdc, worldToClient } from "./screen";

const HIT_PX = 9;
const SNAP_SERIES = [
  0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100,
];

export function snapStep(worldPerPixel: number): number {
  const target = worldPerPixel * 6;
  return SNAP_SERIES.find((s) => s >= target) ?? 100;
}

export interface ManipulatorHost {
  readonly scene: THREE.Object3D;
  readonly camera: THREE.Camera;
  worldPerPixel(): number;
  canvasRect(): Parameters<typeof clientToNdc>[0];
  requestRender(): void;
}

export abstract class Manipulator {
  protected readonly group = new THREE.Group();
  protected dragging = false;
  private readonly raycaster = new THREE.Raycaster();

  constructor(protected readonly host: ManipulatorHost) {
    host.scene.add(this.group);
    host.requestRender();
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  endDrag() {
    this.dragging = false;
  }

  dispose() {
    if (!this.group.parent) return;
    this.group.removeFromParent();
    disposeGroup(this.group);
    this.host.requestRender();
  }

  protected rayAt(clientX: number, clientY: number): THREE.Ray {
    this.raycaster.setFromCamera(
      clientToNdc(this.host.canvasRect(), clientX, clientY),
      this.host.camera,
    );
    return this.raycaster.ray;
  }

  protected hitTolerance(): number {
    return this.host.worldPerPixel() * HIT_PX;
  }

  protected hitSegment(
    ray: THREE.Ray,
    a: THREE.Vector3,
    b: THREE.Vector3,
  ): boolean {
    const tol = this.hitTolerance();
    return ray.distanceSqToSegment(a, b) < tol * tol;
  }

  protected paint(color: THREE.ColorRepresentation, ...meshes: THREE.Mesh[]) {
    const next = new THREE.Color(color);
    let changed = false;
    for (const m of meshes) {
      const current = (m.material as THREE.MeshBasicMaterial).color;
      if (current.equals(next)) continue;
      current.copy(next);
      changed = true;
    }
    if (changed) this.host.requestRender();
  }

  protected labelPosition(point: THREE.Vector3): { x: number; y: number } {
    const { x, y } = worldToClient(
      this.host.canvasRect(),
      this.host.camera,
      point,
    );
    return { x, y };
  }
}
