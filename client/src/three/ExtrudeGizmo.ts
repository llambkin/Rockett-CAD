import * as THREE from "three";
import { findProfile, type PlaneFrame, type Profile } from "@rockett/shared";
import { useStore } from "../store";
import { baseBodies } from "../previewBase";
import { meshOf } from "./meshes";
import { faceCentroid, frameAlong, profileCentroid } from "./featureHandles";
import { disposeObject } from "./dispose";
import { Manipulator, snapStep, type ManipulatorHost } from "./Manipulator";
import { themeColor } from "../theme/tokens";
import { GIZMO_APPEARANCE, PREVIEW_APPEARANCE } from "../tunables";

export interface GizmoSource {
  frame: PlaneFrame;
  anchorUV: [number, number];
  profile?: Profile | undefined;
  faceGhost?:
    | {
        positions: number[];
        indices: number[];
        boundary: number[][];
      }
    | undefined;
}

export class ExtrudeGizmo extends Manipulator {
  private shaft: THREE.Mesh;
  private cone: THREE.Mesh;
  private previewMesh: THREE.Mesh | null = null;

  origin = new THREE.Vector3();
  axis = new THREE.Vector3(0, 0, 1);

  value = 0;
  private cut: boolean;
  private baseOrigin = new THREE.Vector3();
  private startOffset = 0;

  constructor(
    host: ManipulatorHost,
    private source: GizmoSource,
    initialValue: number,
    cut = false,
    startOffset = 0,
  ) {
    super(host);
    this.cut = cut;
    const f = source.frame;
    this.baseOrigin.set(
      ...([
        f.origin[0] +
          source.anchorUV[0] * f.xAxis[0] +
          source.anchorUV[1] * f.yAxis[0],
        f.origin[1] +
          source.anchorUV[0] * f.xAxis[1] +
          source.anchorUV[1] * f.yAxis[1],
        f.origin[2] +
          source.anchorUV[0] * f.xAxis[2] +
          source.anchorUV[1] * f.yAxis[2],
      ] as [number, number, number]),
    );
    this.axis.set(f.normal[0], f.normal[1], f.normal[2]).normalize();
    this.startOffset = startOffset;
    this.origin.copy(this.baseOrigin).addScaledVector(this.axis, startOffset);
    this.value = initialValue;

    const mat = new THREE.MeshBasicMaterial({
      color: themeColor("gizmo"),
      depthTest: false,
      transparent: true,
      opacity: GIZMO_APPEARANCE.shaftOpacity,
    });
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12), mat);
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 16), mat.clone());
    this.shaft.renderOrder = 20;
    this.cone.renderOrder = 20;
    this.shaft.userData.themeToken = "gizmo";
    this.cone.userData.themeToken = "gizmo";
    (this.shaft.userData as any).extrudeGizmo = true;
    (this.cone.userData as any).extrudeGizmo = true;
    for (const mesh of [this.shaft, this.cone]) {
      mesh.frustumCulled = false;
      mesh.onBeforeRender = () => this.layoutArrow();
      this.group.add(mesh);
    }
    this.update(initialValue);
  }

  setStartOffset(offset: number) {
    if (this.startOffset === offset) return;
    this.startOffset = offset;
    this.origin.copy(this.baseOrigin).addScaledVector(this.axis, offset);
    this.update(this.value);
  }

  setCut(cut: boolean) {
    if (this.cut === cut) return;
    this.cut = cut;
    if (this.previewMesh) {
      this.previewMesh.userData.themeToken = cut ? "gizmo-cut" : "gizmo";
      (this.previewMesh.material as THREE.MeshBasicMaterial).color.set(
        themeColor(cut ? "gizmo-cut" : "gizmo"),
      );
    }
    this.host.requestRender();
  }

  private previewMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: themeColor(this.cut ? "gizmo-cut" : "gizmo"),
      transparent: true,
      opacity: this.cut
        ? PREVIEW_APPEARANCE.gizmoCutOpacity
        : PREVIEW_APPEARANCE.gizmoAddOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.userData.themeToken = this.cut ? "gizmo-cut" : "gizmo";
    return material;
  }

  private removePreview() {
    if (this.previewMesh) {
      this.previewMesh.removeFromParent();
      disposeObject(this.previewMesh);
      this.previewMesh = null;
    }
  }

  update(value: number) {
    this.value = value;
    this.layoutArrow();
    this.updatePreview(value);
    this.host.requestRender();
  }

  private length(): number {
    return Math.max(Math.abs(this.value), this.host.worldPerPixel() * 4);
  }

  private layoutArrow() {
    const wpp = this.host.worldPerPixel();
    const shaftRadius = wpp * 1.6;
    const coneH = wpp * 16;
    const coneR = wpp * 5;
    const sign = this.value >= 0 ? 1 : -1;
    const len = this.length();

    const tip = this.origin
      .clone()
      .add(this.axis.clone().multiplyScalar(sign * len));
    const mid = this.origin
      .clone()
      .add(this.axis.clone().multiplyScalar((sign * len) / 2));

    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      this.axis.clone().multiplyScalar(sign),
    );
    this.shaft.position.copy(mid);
    this.shaft.quaternion.copy(quat);
    this.shaft.scale.set(shaftRadius, len, shaftRadius);
    this.cone.position.copy(tip);
    this.cone.quaternion.copy(quat);
    this.cone.scale.set(coneR, coneH, coneR);
    this.shaft.updateMatrixWorld();
    this.cone.updateMatrixWorld();
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
    for (let i = 0; i + 1 < p.polygon.length; i += 2) {
      if (i === 0) shape.moveTo(p.polygon[0]!, p.polygon[1]!);
      else shape.lineTo(p.polygon[i]!, p.polygon[i + 1]!);
    }
    for (const hp of p.holePolygons) {
      const hole = new THREE.Path();
      for (let i = 0; i + 1 < hp.length; i += 2) {
        if (i === 0) hole.moveTo(hp[0]!, hp[1]!);
        else hole.lineTo(hp[i]!, hp[i + 1]!);
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
      new THREE.Vector3(...f.normal),
    );
    basis.setPosition(
      new THREE.Vector3(...f.origin).addScaledVector(
        this.axis,
        this.startOffset,
      ),
    );
    if (value < 0) {
      basis.multiply(new THREE.Matrix4().makeTranslation(0, 0, value));
    }
    geom.applyMatrix4(basis);
    this.previewMesh = new THREE.Mesh(geom, this.previewMaterial());
    this.previewMesh.renderOrder = 4;
    this.group.add(this.previewMesh);
  }

  private updateFaceGhost(value: number) {
    const ghost = this.source.faceGhost;
    if (!ghost) return;
    const start = this.axis.clone().multiplyScalar(this.startOffset);
    const off = this.axis.clone().multiplyScalar(this.startOffset + value);
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i + 2 < ghost.positions.length; i += 3) {
      positions.push(
        ghost.positions[i]! + off.x,
        ghost.positions[i + 1]! + off.y,
        ghost.positions[i + 2]! + off.z,
      );
    }
    indices.push(...ghost.indices);

    for (const poly of ghost.boundary) {
      const base = positions.length / 3;
      const n = poly.length / 3;
      for (let i = 0; i * 3 + 2 < poly.length; i++) {
        positions.push(
          poly[i * 3]! + start.x,
          poly[i * 3 + 1]! + start.y,
          poly[i * 3 + 2]! + start.z,
        );
        positions.push(
          poly[i * 3]! + off.x,
          poly[i * 3 + 1]! + off.y,
          poly[i * 3 + 2]! + off.z,
        );
      }
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geom.setIndex(indices);
    this.previewMesh = new THREE.Mesh(geom, this.previewMaterial());
    this.previewMesh.renderOrder = 4;
    this.group.add(this.previewMesh);
  }

  private tip(extra = 0): THREE.Vector3 {
    const sign = this.value >= 0 ? 1 : -1;
    return this.origin
      .clone()
      .addScaledVector(this.axis, sign * (this.length() + extra));
  }

  hitTest(clientX: number, clientY: number): boolean {
    return this.hitSegment(
      this.rayAt(clientX, clientY),
      this.origin,
      this.tip(this.host.worldPerPixel() * 18),
    );
  }

  setHover(hover: boolean) {
    const token = hover ? "gizmo-hover" : "gizmo";
    this.shaft.userData.themeToken = token;
    this.cone.userData.themeToken = token;
    this.paint(themeColor(token), this.shaft, this.cone);
  }

  dragValue(clientX: number, clientY: number): number {
    const ray = this.rayAt(clientX, clientY);
    const w0 = this.origin.clone().sub(ray.origin);
    const b = this.axis.dot(ray.direction);
    const d = this.axis.dot(w0);
    const e = ray.direction.dot(w0);
    const denom = 1 - b * b;
    const t = Math.abs(denom) < 1e-9 ? 0 : (b * e - d) / denom;
    const step = snapStep(this.host.worldPerPixel());
    const snapped = Math.round(t / step) * step;
    return Math.round(snapped * 1e6) / 1e6;
  }

  tipScreenPosition(): { x: number; y: number } {
    return this.labelPosition(this.tip());
  }
}

export function extrudeGizmoSource(): GizmoSource | null {
  const s = useStore.getState();
  if (s.active?.id !== "design.feature" || s.active.state.type !== "extrude")
    return null;
  const profSel = s.selection.find((x) => x.kind === "profile");
  if (profSel) {
    const sk = s.evaluation?.sketches.find(
      (x) => x.featureId === profSel.sketchId,
    );
    const p = sk && findProfile(sk, profSel.profileId);
    if (sk && p && p.polygon.length >= 6)
      return { frame: sk.frame, anchorUV: profileCentroid(p), profile: p };
  }
  const faceSel = s.selection.find((x) => x.kind === "face");
  if (!faceSel) return null;
  const found = baseBodies(s).find((b) => b.bodyId === faceSel.bodyId);
  const body = found && meshOf(found);
  const face = body?.faces.find((f) => f.name === faceSel.faceName);
  if (!body || !face || face.surface.type !== "plane") return null;
  const centroid = faceCentroid(body, face);
  if (!centroid) return null;
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = face.start; i < face.start + face.count; i++) {
    const vi = body.indices[i]!;
    let ni = remap.get(vi);
    if (ni === undefined) {
      ni = positions.length / 3;
      remap.set(vi, ni);
      positions.push(...body.positions.slice(vi * 3, vi * 3 + 3));
    }
    indices.push(ni);
  }
  const boundary = body.edges
    .filter((ed) => ed.name.includes(faceSel.faceName))
    .map((ed) => ed.polyline);
  return {
    frame: frameAlong(centroid, new THREE.Vector3(...face.surface.normal)),
    anchorUV: [0, 0],
    faceGhost: { positions, indices, boundary },
  };
}
