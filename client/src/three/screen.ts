import * as THREE from "three";

type ScreenRect = Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;

export function clientToNdc(
  rect: ScreenRect,
  clientX: number,
  clientY: number,
): THREE.Vector2 {
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    (-(clientY - rect.top) / rect.height) * 2 + 1,
  );
}

export function worldToClient(
  rect: ScreenRect,
  camera: THREE.Camera,
  point: THREE.Vector3,
): { x: number; y: number; inFront: boolean } {
  const p = point.clone().project(camera);
  return {
    x: rect.left + ((p.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - p.y) / 2) * rect.height,
    inFront: p.z >= -1 && p.z <= 1,
  };
}
