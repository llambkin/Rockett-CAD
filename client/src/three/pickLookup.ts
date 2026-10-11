import * as THREE from "three";
import type { FaceInfo } from "@rockett/shared";
import type { PickBody } from "./pickProviders";

const bounds = new WeakMap<THREE.Object3D, THREE.Box3>();
const sorted = new WeakMap<readonly FaceInfo[], FaceInfo[]>();
const reach = new THREE.Box3();

export function bodiesNearRay<T extends PickBody>(
  bodies: ReadonlyMap<string, T>,
  ray: THREE.Ray,
  tolerance: number,
): Map<string, T> {
  const near = new Map<string, T>();
  for (const [id, body] of bodies) {
    if (!body.group.visible) continue;
    let box = bounds.get(body.group);
    if (!box) {
      box = new THREE.Box3().setFromObject(body.group);
      bounds.set(body.group, box);
    }
    if (ray.intersectsBox(reach.copy(box).expandByScalar(tolerance)))
      near.set(id, body);
  }
  return near;
}

export function faceAt(
  faces: readonly FaceInfo[],
  index: number,
): FaceInfo | undefined {
  let ranges = sorted.get(faces);
  if (!ranges) {
    ranges = faces
      .filter((f) => f.count > 0)
      .toSorted((a, b) => a.start - b.start);
    sorted.set(faces, ranges);
  }
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const face = ranges[mid]!;
    if (index < face.start) hi = mid - 1;
    else if (index >= face.start + face.count) lo = mid + 1;
    else return face;
  }
  return undefined;
}
