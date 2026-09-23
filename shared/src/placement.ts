import type { PlaneFrame, Vec3 } from "./api.js";
import { LINEAR_TOL } from "./tolerance.js";

export type Quat = [number, number, number, number];

export interface Placement {
  rotation: Quat;
  translation: Vec3;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const multiply = ([ax, ay, az, aw]: Quat, [bx, by, bz, bw]: Quat): Quat => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];

const rotate = ([x, y, z, w]: Quat, v: Vec3): Vec3 => {
  const u: Vec3 = [x, y, z];
  const [tx, ty, tz] = cross(u, v);
  const t: Vec3 = [2 * tx, 2 * ty, 2 * tz];
  return add(add(v, [w * t[0], w * t[1], w * t[2]]), cross(u, t));
};

const identity = (): Placement => ({
  rotation: [0, 0, 0, 1],
  translation: [0, 0, 0],
});

const fromTranslation = (translation: Vec3): Placement => ({
  rotation: [0, 0, 0, 1],
  translation: [...translation],
});

const fromAxisAngle = (
  axis: Vec3,
  angleRad: number,
  origin: Vec3 = [0, 0, 0],
): Placement => {
  const length = Math.hypot(...axis);
  if (!(length > LINEAR_TOL)) throw new Error("rotation axis has no direction");
  const s = Math.sin(angleRad / 2) / length;
  const rotation: Quat = [
    axis[0] * s,
    axis[1] * s,
    axis[2] * s,
    Math.cos(angleRad / 2),
  ];
  const turned = rotate(rotation, origin);
  return {
    rotation,
    translation: [
      origin[0] - turned[0],
      origin[1] - turned[1],
      origin[2] - turned[2],
    ],
  };
};

const compose = (outer: Placement, inner: Placement): Placement => ({
  rotation: multiply(outer.rotation, inner.rotation),
  translation: add(
    rotate(outer.rotation, inner.translation),
    outer.translation,
  ),
});

const invert = ({
  rotation: [x, y, z, w],
  translation,
}: Placement): Placement => {
  const rotation: Quat = [-x, -y, -z, w];
  const [tx, ty, tz] = rotate(rotation, translation);
  return { rotation, translation: [-tx, -ty, -tz] };
};

const applyToDirection = (p: Placement, v: Vec3): Vec3 => rotate(p.rotation, v);

const applyToPoint = (p: Placement, point: Vec3): Vec3 =>
  add(rotate(p.rotation, point), p.translation);

const applyToFrame = (p: Placement, frame: PlaneFrame): PlaneFrame => ({
  origin: applyToPoint(p, frame.origin),
  xAxis: applyToDirection(p, frame.xAxis),
  yAxis: applyToDirection(p, frame.yAxis),
  normal: applyToDirection(p, frame.normal),
});

export const Placement = {
  identity,
  fromTranslation,
  fromAxisAngle,
  compose,
  invert,
  applyToPoint,
  applyToDirection,
  applyToFrame,
};
