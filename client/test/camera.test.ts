import * as THREE from "three";
import { expect, it } from "vitest";
import { cameraTween, NAMED_VIEWS, orbitAbout } from "../src/three/camera";

const target = new THREE.Vector3(12, -7, 3);
const distance = 240;

function pose(label: string) {
  const view = NAMED_VIEWS.find((v) => v.label === label);
  if (!view) throw new Error(`no ${label} view`);
  return {
    position: new THREE.Vector3(...view.dir)
      .normalize()
      .multiplyScalar(distance)
      .add(target),
    up: new THREE.Vector3(...view.up),
    target: target.clone(),
    zoom: 90,
  };
}

it.each([
  ["Front", "Back"],
  ["Left", "Right"],
  ["Top", "Bottom"],
  ["Front", "Top"],
  ["Iso", "Bottom"],
])("turns from %s to %s around the model", (fromLabel, toLabel) => {
  const from = pose(fromLabel);
  const to = pose(toLabel);
  const poseAt = cameraTween(from, to);
  for (let frame = 0; frame <= 120; frame++) {
    const p = poseAt(frame / 120);
    expect(p.position.distanceTo(p.target)).toBeGreaterThanOrEqual(
      0.99 * distance,
    );
    expect(p.up.toArray().some(Number.isNaN)).toBe(false);
    expect(p.up.length()).toBeCloseTo(1, 6);
  }
  const end = poseAt(1);
  expect(end.position.distanceTo(to.position)).toBeLessThan(1e-9 * distance);
  expect(end.up.toArray()).toEqual(to.up.toArray());
  expect(end.target.toArray()).toEqual(to.target.toArray());
});

it("keeps the up axis while turning between opposite side views", () => {
  const poseAt = cameraTween(pose("Front"), pose("Back"));
  for (let frame = 0; frame <= 20; frame++) {
    expect(poseAt(frame / 20).up.z).toBeCloseTo(1, 9);
  }
});

it("moves target, distance and zoom together for a fit", () => {
  const from = pose("Iso");
  const dir = from.position.clone().sub(target).normalize();
  const to = {
    position: dir.clone().multiplyScalar(80),
    up: from.up.clone(),
    target: new THREE.Vector3(),
    zoom: 20,
  };
  const poseAt = cameraTween(from, to);
  const mid = poseAt(0.5);
  expect(mid.position.clone().sub(mid.target).normalize().dot(dir)).toBeCloseTo(
    1,
    9,
  );
  expect(poseAt(1).zoom).toBe(20);
  expect(poseAt(1).position.distanceTo(to.position)).toBeLessThan(1e-9);
});

function cameras(): [string, THREE.Camera][] {
  const ortho = new THREE.OrthographicCamera(-80, 80, 60, -60, -1000, 1000);
  const persp = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 1000);
  return [
    ["orthographic", ortho],
    ["perspective", persp],
  ];
}

function place(
  camera: THREE.Camera,
  view: { position: THREE.Vector3; up: THREE.Vector3; target: THREE.Vector3 },
) {
  camera.up.copy(view.up);
  camera.position.copy(view.position);
  camera.lookAt(view.target);
  camera.updateMatrixWorld();
}

it.each(cameras())(
  "keeps the pivot under the cursor in the %s camera",
  (_, camera) => {
    const pivot = new THREE.Vector3(25, 10, 12);
    let view = {
      position: new THREE.Vector3(150, -110, 90),
      up: new THREE.Vector3(0, 0, 1),
      target: new THREE.Vector3(),
    };
    place(camera, view);
    const onScreen = pivot.clone().project(camera);
    const distance = view.position.distanceTo(pivot);
    for (const [dx, dy] of [
      [40, -15],
      [-120, 60],
      [0, 260],
      [300, 0],
    ] as const) {
      view = orbitAbout(view, pivot, dx, dy);
      place(camera, view);
      const now = pivot.clone().project(camera);
      expect(now.x).toBeCloseTo(onScreen.x, 9);
      expect(now.y).toBeCloseTo(onScreen.y, 9);
      expect(view.position.distanceTo(pivot)).toBeCloseTo(distance, 9);
      expect(view.up.toArray().some(Number.isNaN)).toBe(false);
    }
  },
);

it("turns at the view cube rate about the target", () => {
  const view = {
    position: new THREE.Vector3(0, -200, 0),
    up: new THREE.Vector3(0, 0, 1),
    target: new THREE.Vector3(),
  };
  const next = orbitAbout(view, view.target, 100, 0);
  expect(next.position.angleTo(view.position)).toBeCloseTo(1.4, 9);
  expect(next.target.toArray()).toEqual([0, 0, 0]);
});
