/**
 * Extrude drag manipulator: a Fusion-style arrow at the profile/face that
 * drags the extrude distance along its normal, with zoom-dependent snapping
 * and a live translucent preview of the resulting solid.
 */

import * as THREE from "three";
import type { PlaneFrame, Profile } from "@rockett/shared";
import { CadViewport } from "./CadViewport";

const ARROW_COLOR = 0x4da3ff;
const ARROW_HOVER = 0x8fd0ff;
/** Preview tint: blue for material being added, red for a cut. */
const PREVIEW_ADD = 0x4da3ff;
const PREVIEW_CUT = 0xff5a5a;

/** 1-2.5-5 series step chosen from how many mm one pixel covers. */
export function snapStep(worldPerPixel: number): number {
  const target = worldPerPixel * 6; // ~6px per increment feels right
  const series = [
    0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100,
  ];
  for (const s of series) {
    if (s >= target) return s;
  }
  return 100;
}

export interface GizmoSource {
  /** Base plane frame; the arrow points along frame.normal. */
  frame: PlaneFrame;
  /** Anchor point (u,v) on the plane. */
  anchorUV: [number, number];
  /** Profile outline for the drag preview (sketch-profile extrudes). */
  profile?: Profile;
  /** Face triangles + boundary polylines for face-extrude previews. */
  faceGhost?: {
    positions: number[];
    indices: number[];
    /** world-space boundary polylines [x,y,z,...] */
    boundary: number[][];
  };
}

export class ExtrudeGizmo {
  private group = new THREE.Group();
  private shaft: THREE.Mesh;
  private cone: THREE.Mesh;
  private previewMesh: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();

  origin = new THREE.Vector3();
  axis = new THREE.Vector3(0, 0, 1);

  dragging = false;
  /** Signed distance along the axis (negative = reversed). */
  value = 0;
  onChange: ((value: number) => void) | null = null;
  /** Whether the preview shows a cut (red) rather than added material (blue). */
  private cut: boolean;
  /** Anchor on the profile plane itself (before any start offset). */
  private baseOrigin = new THREE.Vector3();
  /** Start offset along the axis: the arrow and preview begin this far from the plane. */
  private startOffset = 0;

  constructor(
    private viewport: CadViewport,
    private source: GizmoSource,
    initialValue: number,
    cut = false,
    startOffset = 0
  ) {
    this.cut = cut;
    const f = source.frame;
    this.baseOrigin.set(
      ...([
        f.origin[0] + source.anchorUV[0] * f.xAxis[0] + source.anchorUV[1] * f.yAxis[0],
        f.origin[1] + source.anchorUV[0] * f.xAxis[1] + source.anchorUV[1] * f.yAxis[1],
        f.origin[2] + source.anchorUV[0] * f.xAxis[2] + source.anchorUV[1] * f.yAxis[2],
      ] as [number, number, number])
    );
    this.axis.set(f.normal[0], f.normal[1], f.normal[2]).normalize();
    this.startOffset = startOffset;
    this.origin.copy(this.baseOrigin).addScaledVector(this.axis, startOffset);
    this.value = initialValue;

    const mat = new THREE.MeshBasicMaterial({
      color: ARROW_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), mat);
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), mat.clone());
    this.shaft.renderOrder = 20;
    this.cone.renderOrder = 20;
    (this.shaft.userData as any).extrudeGizmo = true;
    (this.cone.userData as any).extrudeGizmo = true;
    this.group.add(this.shaft);
    this.group.add(this.cone);
    viewport.scene.add(this.group);
    this.update(initialValue);
  }

  dispose() {
    this.viewport.scene.remove(this.group);
    this.group.traverse((o: any) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.removePreview();
  }

  /** Move the start plane: arrow base and preview shift along the axis. */
  setStartOffset(offset: number) {
    if (this.startOffset === offset) return;
    this.startOffset = offset;
    this.origin.copy(this.baseOrigin).addScaledVector(this.axis, offset);
    this.update(this.value);
  }

  /** Switch the preview between add (blue) and cut (red) without rebuilding. */
  setCut(cut: boolean) {
    if (this.cut === cut) return;
    this.cut = cut;
    if (this.previewMesh) {
      (this.previewMesh.material as THREE.MeshBasicMaterial).color.setHex(
        cut ? PREVIEW_CUT : PREVIEW_ADD
      );
    }
  }

  private previewMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: this.cut ? PREVIEW_CUT : PREVIEW_ADD,
      transparent: true,
      opacity: this.cut ? 0.3 : 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  private removePreview() {
    if (this.previewMesh) {
      this.viewport.scene.remove(this.previewMesh);
      (this.previewMesh.geometry as THREE.BufferGeometry).dispose();
      (this.previewMesh.material as THREE.Material).dispose();
      this.previewMesh = null;
    }
  }

  /** Re-position arrow + preview for a (signed) distance value. */
  update(value: number) {
    this.value = value;
    const wpp = this.viewport.worldPerPixel();
    const shaftRadius = wpp * 1.6;
    const coneH = wpp * 16;
    const coneR = wpp * 5;
    const sign = value >= 0 ? 1 : -1;
    const len = Math.max(Math.abs(value), wpp * 4);

    const tip = this.origin
      .clone()
      .add(this.axis.clone().multiplyScalar(sign * len));
    const mid = this.origin
      .clone()
      .add(this.axis.clone().multiplyScalar((sign * len) / 2));

    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      this.axis.clone().multiplyScalar(sign)
    );
    this.shaft.position.copy(mid);
    this.shaft.quaternion.copy(quat);
    this.shaft.scale.set(shaftRadius, len, shaftRadius);
    this.cone.position.copy(tip);
    this.cone.quaternion.copy(quat);
    this.cone.scale.set(coneR, coneH, coneR);

    this.updatePreview(value);
  }

  private updatePreview(value: number) {
    this.removePreview();
    if (Math.abs(value) < 1e-6) return;
    if (!this.source.profile) {
      this.updateFaceGhost(value);
      return;
    }
    const p = this.source.profile;
    const shape = new THREE.Shape();
    for (let i = 0; i < p.polygon.length; i += 2) {
      if (i === 0) shape.moveTo(p.polygon[0], p.polygon[1]);
      else shape.lineTo(p.polygon[i], p.polygon[i + 1]);
    }
    for (const hp of p.holePolygons) {
      const hole = new THREE.Path();
      for (let i = 0; i < hp.length; i += 2) {
        if (i === 0) hole.moveTo(hp[0], hp[1]);
        else hole.lineTo(hp[i], hp[i + 1]);
      }
      shape.holes.push(hole);
    }
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: Math.abs(value),
      bevelEnabled: false,
    });
    const f = this.source.frame;
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...f.xAxis),
      new THREE.Vector3(...f.yAxis),
      new THREE.Vector3(...f.normal)
    );
    basis.setPosition(
      new THREE.Vector3(...f.origin).addScaledVector(this.axis, this.startOffset)
    );
    if (value < 0) {
      // extrude backwards along the normal
      basis.multiply(new THREE.Matrix4().makeTranslation(0, 0, value));
    }
    geom.applyMatrix4(basis);
    this.previewMesh = new THREE.Mesh(geom, this.previewMaterial());
    this.previewMesh.renderOrder = 4;
    this.viewport.scene.add(this.previewMesh);
  }

  /** Translucent prism ghost for a face extrude: offset cap + side walls. */
  private updateFaceGhost(value: number) {
    const ghost = this.source.faceGhost;
    if (!ghost) return;
    // the prism runs from the start plane (face + startOffset) to start + value
    const start = this.axis.clone().multiplyScalar(this.startOffset);
    const off = this.axis.clone().multiplyScalar(this.startOffset + value);
    const positions: number[] = [];
    const indices: number[] = [];

    // cap: the face's triangles offset along the extrude axis
    for (let i = 0; i < ghost.positions.length; i += 3) {
      positions.push(
        ghost.positions[i] + off.x,
        ghost.positions[i + 1] + off.y,
        ghost.positions[i + 2] + off.z
      );
    }
    indices.push(...ghost.indices);

    // side walls: quad strips between each boundary polyline (at the start
    // plane) and its offset
    for (const poly of ghost.boundary) {
      const base = positions.length / 3;
      const n = poly.length / 3;
      for (let i = 0; i < n; i++) {
        positions.push(poly[i * 3] + start.x, poly[i * 3 + 1] + start.y, poly[i * 3 + 2] + start.z);
        positions.push(
          poly[i * 3] + off.x,
          poly[i * 3 + 1] + off.y,
          poly[i * 3 + 2] + off.z
        );
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    this.previewMesh = new THREE.Mesh(geom, this.previewMaterial());
    this.previewMesh.renderOrder = 4;
    this.viewport.scene.add(this.previewMesh);
  }

  /** Does a pointer event hit the arrow? (distance to the arrow's axis,
   * with a ~9px pick tolerance so the thin shaft is easy to grab) */
  hitTest(clientX: number, clientY: number): boolean {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.viewport.camera);
    const wpp = this.viewport.worldPerPixel();
    const sign = this.value >= 0 ? 1 : -1;
    const len = Math.max(Math.abs(this.value), wpp * 4) + wpp * 18; // + cone
    const tip = this.origin
      .clone()
      .add(this.axis.clone().multiplyScalar(sign * len));
    const distSq = this.raycaster.ray.distanceSqToSegment(this.origin, tip);
    const tol = wpp * 9;
    return distSq < tol * tol;
  }

  setHover(hover: boolean) {
    for (const m of [this.shaft, this.cone]) {
      (m.material as THREE.MeshBasicMaterial).color.setHex(
        hover ? ARROW_HOVER : ARROW_COLOR
      );
    }
  }

  /**
   * Signed axis distance under the cursor, snapped to a zoom-dependent step.
   */
  dragValue(clientX: number, clientY: number): number {
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.viewport.camera);
    const ray = this.raycaster.ray;
    // closest point parameter on the gizmo axis to the mouse ray
    const w0 = this.origin.clone().sub(ray.origin);
    const a = 1; // axis·axis
    const b = this.axis.dot(ray.direction);
    const c = 1; // dir·dir
    const d = this.axis.dot(w0);
    const e = ray.direction.dot(w0);
    const denom = a * c - b * b;
    let t: number;
    if (Math.abs(denom) < 1e-9) {
      t = 0;
    } else {
      t = (b * e - c * d) / denom;
    }
    const step = snapStep(this.viewport.worldPerPixel());
    const snapped = Math.round(t / step) * step;
    return Math.round(snapped * 1e6) / 1e6;
  }

  /** Screen position of the arrow tip (for the value label). */
  tipScreenPosition(): { x: number; y: number } {
    const sign = this.value >= 0 ? 1 : -1;
    const len = Math.max(Math.abs(this.value), this.viewport.worldPerPixel() * 4);
    const tip = this.origin
      .clone()
      .add(this.axis.clone().multiplyScalar(sign * len))
      .project(this.viewport.camera);
    const rect = this.viewport.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((tip.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - tip.y) / 2) * rect.height,
    };
  }
}
