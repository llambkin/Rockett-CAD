/**
 * Revolve drag manipulator: a ring around the revolve axis, through the
 * profile, with a handle that drags the sweep angle — the rotational
 * counterpart of the extrude arrow. Angle snapping adapts to zoom (finer
 * steps when the ring is large on screen), and dragging tracks cumulative
 * rotation so you can sweep smoothly out to ±360°.
 */

import * as THREE from "three";
import { CadViewport } from "./CadViewport";

const RING_COLOR = 0x4da3ff;
const RING_HOVER = 0x8fd0ff;
const HANDLE_COLOR = 0xffd166;

export class RevolveGizmo {
  private group = new THREE.Group();
  private ring: THREE.Mesh;
  private handle: THREE.Mesh;
  private raycaster = new THREE.Raycaster();

  /** Ring basis: center on the axis, u = zero-angle direction, v = 90°. */
  private u: THREE.Vector3;
  private v: THREE.Vector3;

  angleDeg: number;
  private dragging = false;
  private prevRaw = 0;
  private cumulative = 0;

  constructor(
    private viewport: CadViewport,
    private center: THREE.Vector3,
    private dir: THREE.Vector3,
    zeroDir: THREE.Vector3,
    private radius: number,
    initialDeg: number
  ) {
    this.dir = dir.clone().normalize();
    this.u = zeroDir.clone().normalize();
    this.v = new THREE.Vector3().crossVectors(this.dir, this.u).normalize();
    this.angleDeg = initialDeg;

    const wpp = viewport.worldPerPixel();
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, wpp * 1.4, 8, 96),
      new THREE.MeshBasicMaterial({
        color: RING_COLOR,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      })
    );
    // torus lies around local Z — align local Z with the axis
    this.ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir);
    this.ring.position.copy(center);
    this.ring.renderOrder = 20;

    this.handle = new THREE.Mesh(
      new THREE.SphereGeometry(wpp * 5, 16, 12),
      new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false })
    );
    this.handle.renderOrder = 21;

    this.group.add(this.ring, this.handle);
    viewport.scene.add(this.group);
    this.update(initialDeg);
  }

  dispose() {
    this.viewport.scene.remove(this.group);
    this.group.traverse((o: any) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }

  private pointAt(deg: number): THREE.Vector3 {
    const a = THREE.MathUtils.degToRad(deg);
    return this.center
      .clone()
      .add(this.u.clone().multiplyScalar(this.radius * Math.cos(a)))
      .add(this.v.clone().multiplyScalar(this.radius * Math.sin(a)));
  }

  update(angleDeg: number) {
    this.angleDeg = angleDeg;
    this.handle.position.copy(this.pointAt(angleDeg));
  }

  setHover(hover: boolean) {
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(
      hover ? RING_HOVER : RING_COLOR
    );
  }

  /** Raw angle (radians, unsnapped, -π..π) of the pointer on the ring plane,
   * or null when the ray is parallel to the plane. */
  private rawAngle(clientX: number, clientY: number): number | null {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.viewport.camera);
    const ray = this.raycaster.ray;
    const denom = ray.direction.dot(this.dir);
    if (Math.abs(denom) < 1e-6) return null;
    const t = this.center.clone().sub(ray.origin).dot(this.dir) / denom;
    if (t < 0) return null;
    const hit = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    const w = hit.sub(this.center);
    return Math.atan2(w.dot(this.v), w.dot(this.u));
  }

  /** Is the pointer on the ring (within ~9px of its circle)? */
  hitTest(clientX: number, clientY: number): boolean {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.viewport.camera);
    // handle sphere: generous grab
    const wpp = this.viewport.worldPerPixel();
    const dHandle = this.raycaster.ray.distanceToPoint(this.handle.position);
    if (dHandle < wpp * 12) return true;
    // anywhere on the ring circle
    const ray = this.raycaster.ray;
    const denom = ray.direction.dot(this.dir);
    if (Math.abs(denom) < 1e-6) return false;
    const t = this.center.clone().sub(ray.origin).dot(this.dir) / denom;
    if (t < 0) return false;
    const hit = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    const distToCircle = Math.abs(hit.distanceTo(this.center) - this.radius);
    return distToCircle < wpp * 9;
  }

  beginDrag(clientX: number, clientY: number) {
    const raw = this.rawAngle(clientX, clientY);
    if (raw === null) return;
    this.dragging = true;
    this.prevRaw = raw;
    this.cumulative = this.angleDeg;
  }

  /** Snapped cumulative angle (degrees, clamped to ±360) for the pointer. */
  dragAngle(clientX: number, clientY: number): number {
    if (!this.dragging) return this.angleDeg;
    const raw = this.rawAngle(clientX, clientY);
    if (raw === null) return this.angleDeg;
    let delta = raw - this.prevRaw;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    this.prevRaw = raw;
    this.cumulative = Math.max(
      -360,
      Math.min(360, this.cumulative + THREE.MathUtils.radToDeg(delta))
    );
    // zoom-adaptive snap: pick the finest of 1/5/15/45° that is ≥ ~4px of arc
    const wpp = this.viewport.worldPerPixel();
    const pxPerDeg = ((Math.PI * 2 * this.radius) / 360) / wpp;
    const step = [1, 5, 15, 45].find((s) => s * pxPerDeg >= 4) ?? 45;
    return Math.max(-360, Math.min(360, Math.round(this.cumulative / step) * step));
  }

  endDrag() {
    this.dragging = false;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  /** Screen position of the handle (for the angle label). */
  handleScreenPosition(): { x: number; y: number } {
    const p = this.handle.position.clone().project(this.viewport.camera);
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }
}
