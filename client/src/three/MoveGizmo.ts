/**
 * Move manipulator: three world-axis arrows at the selected bodies' center.
 * Dragging an arrow shifts the move offset along that axis with the same
 * zoom-dependent snapping as the extrude gizmo, and shows a translucent
 * ghost of the bodies at the offset position (new moves) — edits update the
 * real geometry via live preview instead.
 */

import * as THREE from "three";
import { Manipulator, snapStep, type ManipulatorHost } from "./Manipulator";

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

export class MoveGizmo extends Manipulator {
  private arrows: {
    shaft: THREE.Mesh;
    cone: THREE.Mesh;
    dir: THREE.Vector3;
    color: number;
  }[] = [];
  private ghosts: THREE.Mesh[] = [];

  /** Base point (bodies' center before the move). */
  origin = new THREE.Vector3();
  /** Current translation. */
  offset = new THREE.Vector3();
  private dragAxis = 0;
  private grabDelta = 0;

  constructor(
    host: ManipulatorHost,
    origin: THREE.Vector3,
    initial: [number, number, number],
    ghostSources: MoveGhostSource[],
  ) {
    super(host);
    this.origin.copy(origin);
    this.offset.set(...initial);

    for (let i = 0; i < 3; i++) {
      const color = AXIS_COLORS[i]!;
      const mat = new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        transparent: true,
        opacity: 0.95,
      });
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 12),
        mat,
      );
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(1, 1, 16),
        mat.clone(),
      );
      shaft.renderOrder = 20;
      cone.renderOrder = 20;
      this.group.add(shaft, cone);
      this.arrows.push({ shaft, cone, dir: AXES[i]!, color });
    }

    for (const src of ghostSources) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(src.positions, 3),
      );
      geom.setIndex(src.indices);
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshBasicMaterial({
          color: 0x4da3ff,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.renderOrder = 4;
      this.ghosts.push(mesh);
      this.group.add(mesh);
    }

    this.update(this.offset.toArray() as [number, number, number]);
  }

  /** Re-position arrows + ghost for a translation offset. */
  update(offset: [number, number, number]) {
    this.offset.set(...offset);
    const wpp = this.host.worldPerPixel();
    const base = this.origin.clone().add(this.offset);
    const len = wpp * 60;
    const shaftR = wpp * 1.6;
    const coneH = wpp * 14;
    const coneR = wpp * 4.5;
    for (const { shaft, cone, dir } of this.arrows) {
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir,
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

  hitTest(clientX: number, clientY: number): number {
    const ray = this.rayAt(clientX, clientY);
    const base = this.origin.clone().add(this.offset);
    const len = this.host.worldPerPixel() * 76;
    let best = -1;
    let bestD = this.hitTolerance() ** 2;
    for (const [i, dir] of AXES.entries()) {
      const tip = base.clone().addScaledVector(dir, len);
      const d = ray.distanceSqToSegment(base, tip);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  setHover(axis: number) {
    this.arrows.forEach(({ shaft, cone, color }, i) =>
      this.paint(i === axis ? AXIS_HOVER : color, shaft, cone),
    );
  }

  /** Begin a drag on the given axis at the pointer position. */
  beginDrag(axis: number, clientX: number, clientY: number) {
    this.dragging = true;
    this.dragAxis = axis;
    this.grabDelta =
      this.offset.getComponent(axis) - this.rawParam(axis, clientX, clientY);
  }

  private rawParam(axis: number, clientX: number, clientY: number): number {
    const ray = this.rayAt(clientX, clientY);
    const a = AXES[axis];
    if (!a) return this.offset.getComponent(axis);
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
    if (!this.dragging)
      return this.offset.toArray() as [number, number, number];
    const t = this.rawParam(this.dragAxis, clientX, clientY) + this.grabDelta;
    const step = snapStep(this.host.worldPerPixel());
    const snapped = Math.round(Math.round(t / step) * step * 1e6) / 1e6;
    const out = this.offset.clone();
    out.setComponent(this.dragAxis, snapped);
    return out.toArray() as [number, number, number];
  }

  get draggingAxis(): number {
    return this.dragging ? this.dragAxis : -1;
  }

  tipScreenPosition(): { x: number; y: number } | null {
    const dir = AXES[this.dragAxis];
    if (!this.dragging || !dir) return null;
    return this.labelPosition(
      this.origin
        .clone()
        .add(this.offset)
        .addScaledVector(dir, this.host.worldPerPixel() * 60),
    );
  }
}
