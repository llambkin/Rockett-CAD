/**
 * Sketch/construction plane frames.
 *
 * A PlaneFrame is an origin + orthonormal (xAxis, yAxis, normal) triple.
 * Sketch (u,v) coordinates map to 3D as: origin + u·xAxis + v·yAxis.
 *
 * Frame conventions (see docs/CAD_MODEL.md):
 * - Origin planes have fixed canonical frames.
 * - Face frames: origin = closest point on the face plane to the global
 *   origin (stable under lateral model edits), axes derived deterministically
 *   from the plane normal.
 */

import type { OriginPlaneName, PlaneFrame, Vec3 } from "@rockett/shared";

export const V = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  normalize: (a: Vec3): Vec3 => {
    const n = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / n, a[1] / n, a[2] / n];
  },
};

export const ORIGIN_FRAMES: Record<OriginPlaneName, PlaneFrame> = {
  XY: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  },
  XZ: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 0, 1],
    normal: [0, -1, 0],
  },
  YZ: {
    origin: [0, 0, 0],
    xAxis: [0, 1, 0],
    yAxis: [0, 0, 1],
    normal: [1, 0, 0],
  },
};

/** Map sketch (u, v) to 3D. */
export function uvTo3d(frame: PlaneFrame, u: number, v: number): Vec3 {
  return [
    frame.origin[0] + u * frame.xAxis[0] + v * frame.yAxis[0],
    frame.origin[1] + u * frame.xAxis[1] + v * frame.yAxis[1],
    frame.origin[2] + u * frame.xAxis[2] + v * frame.yAxis[2],
  ];
}

/** Project a 3D point into sketch (u, v[, w]) coordinates. */
export function pointToUV(
  frame: PlaneFrame,
  p: Vec3,
): { u: number; v: number; w: number } {
  const d = V.sub(p, frame.origin);
  return {
    u: V.dot(d, frame.xAxis),
    v: V.dot(d, frame.yAxis),
    w: V.dot(d, frame.normal),
  };
}

/**
 * Deterministic frame for an arbitrary plane (point + normal):
 * - origin: closest point on the plane to the global origin
 * - xAxis: projection of global X (or Y when normal ≈ ±X) onto the plane
 */
export function frameFromPlane(pointOnPlane: Vec3, normal: Vec3): PlaneFrame {
  const n = V.normalize(normal);
  // closest point on plane to global origin
  const dist = V.dot(pointOnPlane, n);
  const origin = V.scale(n, dist);
  let seed: Vec3 = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  let x = V.sub(seed, V.scale(n, V.dot(seed, n)));
  x = V.normalize(x);
  const y = V.normalize(V.cross(n, x));
  return { origin, xAxis: x, yAxis: y, normal: n };
}

/** Translate a frame along its normal. */
export function offsetFrame(frame: PlaneFrame, distance: number): PlaneFrame {
  return {
    origin: V.add(frame.origin, V.scale(frame.normal, distance)),
    xAxis: frame.xAxis,
    yAxis: frame.yAxis,
    normal: frame.normal,
  };
}
