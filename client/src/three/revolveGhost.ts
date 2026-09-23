/**
 * Translucent preview of a revolve: the selected profile's boundary swept
 * around the axis by the given angle, plus start/end caps for partial
 * revolves. Pure display — the kernel builds the real solid on OK.
 */

import * as THREE from "three";
import type { PlaneFrame } from "@rockett/shared";
import { themeColor } from "../theme/tokens";

function ghostMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: themeColor("gizmo"),
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** UV polygon (flat [u,v,...]) → world-space Vector3 ring. */
function polyTo3d(frame: PlaneFrame, poly: number[]): THREE.Vector3[] {
  const o = new THREE.Vector3(...frame.origin);
  const xa = new THREE.Vector3(...frame.xAxis);
  const ya = new THREE.Vector3(...frame.yAxis);
  const out: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    out.push(
      o
        .clone()
        .add(xa.clone().multiplyScalar(poly[i]!))
        .add(ya.clone().multiplyScalar(poly[i + 1]!)),
    );
  }
  return out;
}

export function buildRevolveGhost(
  frame: PlaneFrame,
  polygon: number[],
  holePolygons: number[][],
  axisOrigin: THREE.Vector3,
  axisDir: THREE.Vector3,
  angleDeg: number,
): THREE.Group {
  const group = new THREE.Group();
  const angle = THREE.MathUtils.degToRad(
    Math.max(-360, Math.min(360, angleDeg || 360)),
  );
  if (Math.abs(angle) < 1e-6) return group;
  const full = Math.abs(Math.abs(angleDeg) - 360) < 1e-9;
  const dir = axisDir.clone().normalize();
  const steps = Math.max(12, Math.ceil(Math.abs(angleDeg) / 7.5));

  const rotate = (p: THREE.Vector3, a: number) =>
    p.clone().sub(axisOrigin).applyAxisAngle(dir, a).add(axisOrigin);

  // swept side walls: one strip per boundary loop (outer + holes)
  const loops = [polygon, ...holePolygons].map((poly) => polyTo3d(frame, poly));
  for (const ring of loops) {
    if (ring.length < 2) continue;
    const n = ring.length;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let s = 0; s <= steps; s++) {
      const a = (angle * s) / steps;
      for (const p of ring) {
        const q = rotate(p, a);
        positions.push(q.x, q.y, q.z);
      }
    }
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0 = s * n + i;
        const a1 = s * n + j;
        const b0 = (s + 1) * n + i;
        const b1 = (s + 1) * n + j;
        indices.push(a0, b0, a1, a1, b0, b1);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geom.setIndex(indices);
    const mesh = new THREE.Mesh(geom, ghostMaterial());
    mesh.renderOrder = 4;
    group.add(mesh);
  }

  // start/end caps for partial revolves
  if (!full) {
    const shape = new THREE.Shape();
    for (let i = 0; i + 1 < polygon.length; i += 2) {
      if (i === 0) shape.moveTo(polygon[0]!, polygon[1]!);
      else shape.lineTo(polygon[i]!, polygon[i + 1]!);
    }
    for (const hp of holePolygons) {
      const hole = new THREE.Path();
      for (let i = 0; i + 1 < hp.length; i += 2) {
        if (i === 0) hole.moveTo(hp[0]!, hp[1]!);
        else hole.lineTo(hp[i]!, hp[i + 1]!);
      }
      shape.holes.push(hole);
    }
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...frame.xAxis),
      new THREE.Vector3(...frame.yAxis),
      new THREE.Vector3(...frame.normal),
    );
    basis.setPosition(new THREE.Vector3(...frame.origin));
    for (const a of [0, angle]) {
      const geom = new THREE.ShapeGeometry(shape);
      geom.applyMatrix4(basis);
      // rotate the cap into place around the axis
      const rot = new THREE.Matrix4()
        .makeTranslation(axisOrigin.x, axisOrigin.y, axisOrigin.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(dir, a))
        .multiply(
          new THREE.Matrix4().makeTranslation(
            -axisOrigin.x,
            -axisOrigin.y,
            -axisOrigin.z,
          ),
        );
      geom.applyMatrix4(rot);
      const mesh = new THREE.Mesh(geom, ghostMaterial());
      mesh.renderOrder = 4;
      group.add(mesh);
    }
  }

  return group;
}
