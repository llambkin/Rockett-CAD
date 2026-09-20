/**
 * Move manipulator: three world-axis arrows at the selected bodies' center.
 * Dragging an arrow shifts the move offset along that axis with the same
 * zoom-dependent snapping as the extrude gizmo, and shows a translucent
 * ghost of the bodies at the offset position (new moves) — edits update the
 * real geometry via live preview instead.
 */

import * as THREE from "three";
import { CadViewport } from "./CadViewport";
import { snapStep } from "./ExtrudeGizmo";

const AXIS_COLORS = [0xe05c5c, 0x62c162, 0x4da3ff]; // X red, Y green, Z blue
const AXIS_HOVER = 0xffd166;
const AXES: THREE.Vector3[] = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
];

export interface MoveGhostSource {
  positions: number[];
  indices: number[];
}

export class MoveGizmo {
  private group = new THREE.Group();
  private arrows: { shaft: THREE.Mesh; cone: THREE.Mesh }[] = [];
  private ghosts: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();

  /** Base point (bodies' center before the move). */
  origin = new THREE.Vector3();
  /** Current translation. */
  offset = new THREE.Vector3();
  /** While dragging: which axis, and the grab offset along it. */
  private dragAxis = -1;
  private grabDelta = 0;

  constructor(
    private viewport: CadViewport,
    origin: THREE.Vector3,
    initial: [number, number, number],
    ghostSources: MoveGhostSource[]
  ) {
    this.origin.copy(origin);
    this.offset.set(...initial);

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: AXIS_COLORS[i],
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), mat);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), mat.clone());
      shaft.renderOrder = 20;
      cone.renderOrder = 20;
      this.group.add(shaft, cone);
      this.arrows.push({ shaft, cone });
    }

    for (const src of ghostSources) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.Float32BufferAttribute(src.positions, 3));
      geom.setIndex(src.indices);
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshBasicMaterial({
          color: 0x4da3ff,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      mesh.renderOrder = 4;
      this.ghosts.push(mesh);
      this.group.add(mesh);
    }

    viewport.scene.add(this.group);
    this.update(this.offset.toArray() as [number, number, number]);
  }

  dispose() {
    this.viewport.scene.remove(this.group);
    this.group.traverse((o: any) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }

  /** Re-position arrows + ghost for a translation offset. */
  update(offset: [number, number, number]) {
    this.offset.set(...offset);
    const wpp = this.viewport.worldPerPixel();
    const base = this.origin.clone().add(this.offset);
    const len = wpp * 60;
    const shaftR = wpp * 1.6;
    const coneH = wpp * 14;
    const coneR = wpp * 4.5;
    for (let i = 0; i < 3; i++) {
      const { shaft, cone } = this.arrows[i];
      const dir = AXES[i];
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir
      );
      shaft.position.copy(base).add(dir.clone().multiplyScalar(len / 2));
      shaft.quaternion.copy(quat);
      shaft.scale.set(shaftR, len, shaftR);
      cone.position.copy(base).add(dir.clone().multiplyScalar(len));
      cone.quaternion.copy(quat);
      cone.scale.set(coneR, coneH, coneR);
    }
    for (const g of this.ghosts) {
      g.position.copy(this.offset);
      g.visible = this.offset.lengthSq() > 1e-12;
    }
  }

  /** Hide the ghost meshes (edit mode: real geometry live-updates). */
  hideGhosts() {
    for (const g of this.ghosts) g.visible = false;
    this.ghosts = [];
  }

  /** Which axis arrow is under the pointer (-1 = none). */
  hitTest(clientX: number, clientY: number): number {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.viewport.camera);
    const wpp = this.viewport.worldPerPixel();
    const base = this.origin.clone().add(this.offset);
    const len = wpp * 60 + wpp * 16;
    const tol = wpp * 9;
    let best = -1;
    let bestD = tol * tol;
    for (let i = 0; i < 3; i++) {
      const tip = base.clone().add(AXES[i].clone().multiplyScalar(len));
      const d = this.raycaster.ray.distanceSqToSegment(base, tip);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  setHover(axis: number) {
    for (let i = 0; i < 3; i++) {
      const c = i === axis ? AXIS_HOVER : AXIS_COLORS[i];
      (this.arrows[i].shaft.material as THREE.MeshBasicMaterial).color.setHex(c);
      (this.arrows[i].cone.material as THREE.MeshBasicMaterial).color.setHex(c);
    }
  }

  /** Begin a drag on the given axis at the pointer position. */
  beginDrag(axis: number, clientX: number, clientY: number) {
    this.dragAxis = axis;
    this.grabDelta = this.offset.getComponent(axis) - this.rawParam(axis, clientX, clientY);
  }

  private rawParam(axis: number, clientX: number, clientY: number): number {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.viewport.camera);
    const ray = this.raycaster.ray;
    const a = AXES[axis];
    const w0 = this.origin.clone().sub(ray.origin);
    const b = a.dot(ray.direction);
    const d = a.dot(w0);
    const e = ray.direction.dot(w0);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-9) return this.offset.getComponent(axis);
    return (b * e - d) / denom;
  }

  /** New offset for the current drag; snapped to the zoom step. */
  dragOffset(clientX: number, clientY: number): [number, number, number] {
    if (this.dragAxis < 0) return this.offset.toArray() as [number, number, number];
    const t = this.rawParam(this.dragAxis, clientX, clientY) + this.grabDelta;
    const step = snapStep(this.viewport.worldPerPixel());
    const snapped = Math.round((Math.round(t / step) * step) * 1e6) / 1e6;
    const out = this.offset.clone();
    out.setComponent(this.dragAxis, snapped);
    return out.toArray() as [number, number, number];
  }

  endDrag() {
    this.dragAxis = -1;
  }

  get draggingAxis(): number {
    return this.dragAxis;
  }

  /** Screen position of the dragged arrow tip (for the value label). */
  tipScreenPosition(): { x: number; y: number } | null {
    if (this.dragAxis < 0) return null;
    const wpp = this.viewport.worldPerPixel();
    const tip = this.origin
      .clone()
      .add(this.offset)
      .add(AXES[this.dragAxis].clone().multiplyScalar(wpp * 60))
      .project(this.viewport.camera);
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((tip.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - tip.y) / 2) * rect.height,
    };
  }
}
