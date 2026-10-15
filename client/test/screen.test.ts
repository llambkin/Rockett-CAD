import * as THREE from "three";
import { expect, it } from "vitest";
import { clientToNdc, worldToClient } from "../src/three/screen";

const rect = { left: 37, top: 91, width: 800, height: 600 };

function cameras(): [string, THREE.Camera][] {
  const ortho = new THREE.OrthographicCamera(-40, 40, 30, -30, -1000, 1000);
  const persp = new THREE.PerspectiveCamera(
    40,
    rect.width / rect.height,
    0.1,
    1000,
  );
  for (const cam of [ortho, persp]) {
    cam.position.set(120, -80, 60);
    cam.up.set(0, 0, 1);
    cam.lookAt(3, 5, -2);
    cam.updateMatrixWorld();
  }
  return [
    ["orthographic", ortho],
    ["perspective", persp],
  ];
}

it.each(cameras())("round trips a pixel through the %s camera", (_, cam) => {
  for (const [px, py] of [
    [37, 91],
    [412.25, 333.5],
    [836, 690],
  ] as const) {
    const ndc = clientToNdc(rect, px, py);
    const world = new THREE.Vector3(ndc.x, ndc.y, 0.3).unproject(cam);
    const back = worldToClient(rect, cam, world);
    expect(Math.abs(back.x - px)).toBeLessThan(1e-9);
    expect(Math.abs(back.y - py)).toBeLessThan(1e-9);
    expect(back.inFront).toBe(true);
  }
});

it("reports a point behind the perspective camera as not in front", () => {
  const cam = cameras()[1]![1];
  const forward = cam.getWorldDirection(new THREE.Vector3());
  const behind = cam.position.clone().addScaledVector(forward, -50);
  expect(worldToClient(rect, cam, behind).inFront).toBe(false);
});
