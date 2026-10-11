/**
 * Revolve drag manipulator: a ring around the revolve axis, through the
 * profile, with a handle that drags the sweep angle — the rotational
 * counterpart of the extrude arrow. Angle snapping adapts to zoom (finer
 * steps when the ring is large on screen), and dragging tracks cumulative
 * rotation so you can sweep smoothly out to ±360°.
 */

import * as THREE from "three";
import { Manipulator, type ManipulatorHost } from "./Manipulator";
import { themeColor } from "../theme/tokens";
import { GIZMO_APPEARANCE } from "../tunables";

import type { PlaneFrame } from "@rockett/shared";
import { axisRef, type AxisParams } from "../features/inputs";
import { previewBodies, useStore } from "../store";
import { meshOf } from "./meshes";
import { uv3 } from "./CadViewport";
import { buildRevolveGhost } from "./revolveGhost";
import { disposeGroup } from "./dispose";

export function ringThrough(
  point: THREE.Vector3,
  axisOrigin: THREE.Vector3,
  axisDir: THREE.Vector3,
  worldPerPixel: number,
) {
  const dir = axisDir.clone().normalize();
  const along = point.clone().sub(axisOrigin).dot(dir);
  const center = axisOrigin.clone().addScaledVector(dir, along);
  const zeroDir = point.clone().sub(center);
  const radius = zeroDir.length();
  if (radius >= worldPerPixel * 10) return { center, dir, zeroDir, radius };
  return {
    center,
    dir,
    zeroDir:
      Math.abs(dir.z) < 0.9
        ? new THREE.Vector3(0, 0, 1).cross(dir)
        : new THREE.Vector3(1, 0, 0).cross(dir),
    radius: worldPerPixel * 50,
  };
}

export class RevolveGizmo extends Manipulator {
  private ring: THREE.Mesh;
  private ghost: THREE.Group | undefined;
  private handle: THREE.Mesh;

  /** Ring basis: center on the axis, u = zero-angle direction, v = 90°. */
  private u: THREE.Vector3;
  private v: THREE.Vector3;

  angleDeg: number;
  private prevRaw = 0;
  private cumulative = 0;

  constructor(
    host: ManipulatorHost,
    private center: THREE.Vector3,
    private dir: THREE.Vector3,
    zeroDir: THREE.Vector3,
    private radius: number,
    initialDeg: number,
  ) {
    super(host);
    this.dir = dir.clone().normalize();
    this.u = zeroDir.clone().normalize();
    this.v = new THREE.Vector3().crossVectors(this.dir, this.u).normalize();
    this.angleDeg = initialDeg;

    const wpp = host.worldPerPixel();
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, wpp * 1.4, 8, 96),
      new THREE.MeshBasicMaterial({
        color: themeColor("gizmo"),
        depthTest: false,
        transparent: true,
        opacity: GIZMO_APPEARANCE.ringOpacity,
      }),
    );
    // torus lies around local Z — align local Z with the axis
    this.ring.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      this.dir,
    );
    this.ring.position.copy(center);
    this.ring.renderOrder = 20;
    this.ring.userData.themeToken = "gizmo";

    this.handle = new THREE.Mesh(
      new THREE.SphereGeometry(wpp * 5, 16, 12),
      new THREE.MeshBasicMaterial({
        color: themeColor("gizmo-handle"),
        depthTest: false,
      }),
    );
    this.handle.renderOrder = 21;
    this.handle.userData.themeToken = "gizmo-handle";

    this.group.add(this.ring, this.handle);
    this.update(initialDeg);
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
    this.host.requestRender();
  }

  updateGhost(
    source:
      | {
          sketch: { frame: PlaneFrame };
          profile: { polygon: number[]; holePolygons: number[][] };
          axis: { origin: THREE.Vector3; dir: THREE.Vector3 };
          angle: number;
        }
      | undefined,
  ) {
    if (this.ghost) {
      this.ghost.removeFromParent();
      disposeGroup(this.ghost);
      this.ghost = undefined;
    }
    if (source) {
      this.ghost = buildRevolveGhost(
        source.sketch.frame,
        source.profile.polygon,
        source.profile.holePolygons,
        source.axis.origin,
        source.axis.dir,
        source.angle,
      );
      this.group.add(this.ghost);
    }
    this.host.requestRender();
  }

  setHover(hover: boolean) {
    const token = hover ? "gizmo-hover" : "gizmo";
    this.ring.userData.themeToken = token;
    this.paint(themeColor(token), this.ring);
  }

  private ringPlaneHit(ray: THREE.Ray): THREE.Vector3 | null {
    const denom = ray.direction.dot(this.dir);
    if (Math.abs(denom) < 1e-6) return null;
    const t = this.center.clone().sub(ray.origin).dot(this.dir) / denom;
    if (t < 0) return null;
    return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
  }

  private rawAngle(clientX: number, clientY: number): number | null {
    const hit = this.ringPlaneHit(this.rayAt(clientX, clientY));
    if (!hit) return null;
    const w = hit.sub(this.center);
    return Math.atan2(w.dot(this.v), w.dot(this.u));
  }

  hitTest(clientX: number, clientY: number): boolean {
    const ray = this.rayAt(clientX, clientY);
    const wpp = this.host.worldPerPixel();
    if (ray.distanceToPoint(this.handle.position) < wpp * 12) return true;
    const hit = this.ringPlaneHit(ray);
    if (!hit) return false;
    const distToCircle = Math.abs(hit.distanceTo(this.center) - this.radius);
    return distToCircle < this.hitTolerance();
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
      Math.min(360, this.cumulative + THREE.MathUtils.radToDeg(delta)),
    );
    // zoom-adaptive snap: pick the finest of 1/5/15/45° that is ≥ ~4px of arc
    const wpp = this.host.worldPerPixel();
    const pxPerDeg = (Math.PI * 2 * this.radius) / 360 / wpp;
    const step = [1, 5, 15, 45].find((s) => s * pxPerDeg >= 4) ?? 45;
    return Math.max(
      -360,
      Math.min(360, Math.round(this.cumulative / step) * step),
    );
  }

  handleScreenPosition(): { x: number; y: number } {
    return this.labelPosition(this.handle.position);
  }
}

export function featureAxis(params: AxisParams) {
  const state = useStore.getState();
  const ref = axisRef(params, state.selection, state.document);
  if (!ref) return;
  if (ref.kind === "originAxis")
    return {
      origin: new THREE.Vector3(),
      dir: new THREE.Vector3(
        ref.axis === "X" ? 1 : 0,
        ref.axis === "Y" ? 1 : 0,
        ref.axis === "Z" ? 1 : 0,
      ),
    };
  let origin: THREE.Vector3 | undefined;
  let end: THREE.Vector3 | undefined;
  if (ref.kind === "sketchLine") {
    const sketch = state.evaluation?.sketches.find(
      (s) => s.featureId === ref.sketchId,
    );
    const line = sketch?.entities.find((e) => e.id === ref.entityId);
    if (line?.kind !== "line") return;
    const a = sketch?.entities.find((e) => e.id === line.p1);
    const b = sketch?.entities.find((e) => e.id === line.p2);
    if (!sketch || a?.kind !== "point" || b?.kind !== "point") return;
    origin = uv3(sketch.frame, a.x, a.y);
    end = uv3(sketch.frame, b.x, b.y);
  } else {
    const body = previewBodies(state).find((b) => b.bodyId === ref.edge.bodyId);
    const polyline = (body && meshOf(body))?.edges.find(
      (edge) => edge.name === ref.edge.edgeName,
    )?.polyline;
    if (!polyline || polyline.length < 6) return;
    origin = new THREE.Vector3(polyline[0], polyline[1], polyline[2]);
    end = new THREE.Vector3(polyline.at(-3), polyline.at(-2), polyline.at(-1));
  }
  const dir = end.sub(origin);
  return dir.lengthSq() < 1e-12 ? undefined : { origin, dir };
}
