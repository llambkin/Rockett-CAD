import * as THREE from "three";
import type { Vec3, ViewCamera } from "@rockett/shared";

export interface NamedView {
  label: string;
  dir: Vec3;
  up: Vec3;
}

export const ISO_VIEW: NamedView = {
  label: "Iso",
  dir: [1, -1, 1],
  up: [0, 0, 1],
};

export const NAMED_VIEWS: NamedView[] = [
  { label: "Front", dir: [0, -1, 0], up: [0, 0, 1] },
  { label: "Back", dir: [0, 1, 0], up: [0, 0, 1] },
  { label: "Left", dir: [-1, 0, 0], up: [0, 0, 1] },
  { label: "Right", dir: [1, 0, 0], up: [0, 0, 1] },
  { label: "Top", dir: [0, 0, 1], up: [0, 1, 0] },
  { label: "Bottom", dir: [0, 0, -1], up: [0, -1, 0] },
  ISO_VIEW,
];

export interface CameraPose {
  position: THREE.Vector3;
  up: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
}

export function halfHeightPerDistance(fov: number): number {
  return Math.tan((fov * Math.PI) / 360);
}

export function savedCamera(
  pose: CameraPose,
  projection: ViewCamera["projection"],
  fov: number,
): ViewCamera {
  const offset = pose.position.clone().sub(pose.target);
  if (projection === "orthographic")
    offset.setLength(pose.zoom / halfHeightPerDistance(fov));
  return {
    position: pose.target.clone().add(offset).toArray(),
    target: pose.target.toArray(),
    up: pose.up.toArray(),
    projection,
  };
}

export function restoredPose(camera: ViewCamera, fov: number): CameraPose {
  const position = new THREE.Vector3(...camera.position);
  const target = new THREE.Vector3(...camera.target);
  return {
    position,
    up: new THREE.Vector3(...camera.up),
    target,
    zoom: position.distanceTo(target) * halfHeightPerDistance(fov),
  };
}

const ORIGIN = new THREE.Vector3();

function orientation(offset: THREE.Vector3, up: THREE.Vector3) {
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(offset, ORIGIN, up),
  );
}

export function cameraTween(from: CameraPose, to: CameraPose) {
  const fromOffset = from.position.clone().sub(from.target);
  const toOffset = to.position.clone().sub(to.target);
  const fromTurn = orientation(fromOffset, from.up);
  const toTurn = orientation(toOffset, to.up);
  const fromDistance = fromOffset.length();
  const toDistance = toOffset.length();
  return (t: number): CameraPose => {
    if (t >= 1) {
      return {
        position: to.position.clone(),
        up: to.up.clone().normalize(),
        target: to.target.clone(),
        zoom: to.zoom,
      };
    }
    const e = 1 - Math.pow(1 - Math.max(0, t), 3);
    const turn = fromTurn.clone().slerp(toTurn, e);
    const target = from.target.clone().lerp(to.target, e);
    const distance = fromDistance + (toDistance - fromDistance) * e;
    return {
      position: new THREE.Vector3(0, 0, 1)
        .applyQuaternion(turn)
        .multiplyScalar(distance)
        .add(target),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(turn),
      target,
      zoom: from.zoom + (to.zoom - from.zoom) * e,
    };
  };
}

const ORBIT_RAD_PER_PX = 0.014;

export function orbitAbout(
  view: { position: THREE.Vector3; up: THREE.Vector3; target: THREE.Vector3 },
  pivot: THREE.Vector3,
  dx: number,
  dy: number,
) {
  const forward = view.target.clone().sub(view.position).normalize();
  const right = forward.clone().cross(view.up).normalize();
  const screenUp = right.clone().cross(forward).normalize();
  const turn = new THREE.Quaternion()
    .setFromAxisAngle(screenUp, dx * ORBIT_RAD_PER_PX)
    .multiply(
      new THREE.Quaternion().setFromAxisAngle(right, dy * ORBIT_RAD_PER_PX),
    )
    .invert();
  const depth = pivot.clone().sub(view.position).dot(forward);
  const target =
    depth > 0
      ? view.position.clone().addScaledVector(forward, depth)
      : view.target.clone();
  const about = (point: THREE.Vector3) =>
    point.clone().sub(pivot).applyQuaternion(turn).add(pivot);
  return {
    position: about(view.position),
    up: view.up.clone().applyQuaternion(turn).normalize(),
    target: about(target),
  };
}

export function turntableAbout(
  view: { position: THREE.Vector3; up: THREE.Vector3; target: THREE.Vector3 },
  pivot: THREE.Vector3,
  dx: number,
  dy: number,
) {
  const offset = view.position.clone().sub(pivot);
  const radius = offset.length();
  if (radius === 0) return view;
  const azimuth = Math.atan2(offset.y, offset.x) - dx * ORBIT_RAD_PER_PX;
  const polar = Math.max(
    0.01,
    Math.min(
      Math.PI - 0.01,
      Math.acos(offset.z / radius) + dy * ORBIT_RAD_PER_PX,
    ),
  );
  const next = new THREE.Vector3(
    radius * Math.sin(polar) * Math.cos(azimuth),
    radius * Math.sin(polar) * Math.sin(azimuth),
    radius * Math.cos(polar),
  );
  const turn = new THREE.Quaternion().setFromUnitVectors(
    offset.normalize(),
    next.clone().normalize(),
  );
  return {
    position: pivot.clone().add(next),
    up: new THREE.Vector3(0, 0, 1),
    target: view.target.clone().sub(pivot).applyQuaternion(turn).add(pivot),
  };
}
