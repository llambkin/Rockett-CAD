import * as THREE from "three";
import type {
  BodyPayload,
  EdgeInfo,
  EvaluateResult,
  SketchPayload,
} from "@rockett/shared";
import { viewportHandle } from "../../src/viewportRef";
import { worldToClient } from "../../src/three/screen";

export type P = [number, number, number];
export const S = 10;

export function quad(corners: P[], name: string, into: BodyPayload) {
  const at = into.positions.length / 3;
  const start = into.indices.length;
  const [a, b, c] = corners.map((p) => new THREE.Vector3(...p));
  const n = b!.clone().sub(a!).cross(c!.clone().sub(a!)).normalize();
  for (const p of corners) {
    into.positions.push(...p);
    into.normals.push(n.x, n.y, n.z);
  }
  into.indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  into.faces.push({
    name,
    start,
    count: 6,
    surface: { type: "plane", origin: corners[0]!, normal: [n.x, n.y, n.z] },
    area: 0,
  });
}

export function edge(name: string, a: P, b: P): EdgeInfo {
  return {
    name,
    polyline: [...a, ...b],
    length: new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)),
    curve: { type: "line", a, b },
  };
}

export function box(meshKey: string, h = S, top = "top"): BodyPayload {
  const body: BodyPayload = {
    bodyId: "b1",
    name: "Body1",
    visible: true,
    meshKey,
    positions: [],
    normals: [],
    indices: [],
    faces: [],
    edges: [],
    vertices: [],
    bbox: { min: [0, 0, 0], max: [S, S, h] },
  };
  quad(
    [
      [0, 0, h],
      [S, 0, h],
      [S, S, h],
      [0, S, h],
    ],
    top,
    body,
  );
  quad(
    [
      [0, 0, 0],
      [0, S, 0],
      [S, S, 0],
      [S, 0, 0],
    ],
    "bottom",
    body,
  );
  quad(
    [
      [0, 0, 0],
      [S, 0, 0],
      [S, 0, h],
      [0, 0, h],
    ],
    "front",
    body,
  );
  quad(
    [
      [S, 0, 0],
      [S, S, 0],
      [S, S, h],
      [S, 0, h],
    ],
    "right",
    body,
  );
  for (const [x, y] of [
    [0, 0],
    [S, 0],
    [S, S],
    [0, S],
  ] as const)
    body.edges.push(edge(`z${x}${y}`, [x, y, 0], [x, y, h]));
  for (const z of [0, h]) {
    body.edges.push(edge(`x0${z}`, [0, 0, z], [S, 0, z]));
    body.edges.push(edge(`y${S}${z}`, [S, 0, z], [S, S, z]));
  }
  return body;
}

export const result = (
  bodies: BodyPayload[],
  sketches: SketchPayload[] = [],
): EvaluateResult => ({
  bodies,
  planes: [],
  sketches,
  featureStatuses: [],
  kernelMs: 0,
});

export function sizeViewport(): () => void {
  const size = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 600 },
  });
  return () =>
    Object.defineProperties(HTMLElement.prototype, {
      clientWidth: size.clientWidth!,
      clientHeight: size.clientHeight!,
    });
}

export function pointer(type: string, world: THREE.Vector3) {
  const vp = viewportHandle.current!;
  const at = worldToClient(vp.canvasRect(), vp.camera, world);
  const canvas = vp.renderer.domElement;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}
