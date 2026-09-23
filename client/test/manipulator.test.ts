import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { clearGroup } from "../src/three/dispose";
import { ExtrudeGizmo, type GizmoSource } from "../src/three/ExtrudeGizmo";
import {
  Manipulator,
  snapStep,
  type ManipulatorHost,
} from "../src/three/Manipulator";
import { RevolveGizmo } from "../src/three/RevolveGizmo";
import { worldToClient } from "../src/three/screen";

const rect = { left: 20, top: 40, width: 800, height: 600 };

function stubHost(): ManipulatorHost {
  const camera = new THREE.OrthographicCamera(-40, 40, 30, -30, -1000, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return {
    scene: new THREE.Scene(),
    camera,
    worldPerPixel: () => 60 / rect.height,
    canvasRect: () => rect,
  };
}

const radius = 10;

function revolve(host: ManipulatorHost, initialDeg = 0) {
  return new RevolveGizmo(
    host,
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    radius,
    initialDeg,
  );
}

function ringPoint(deg: number, r = radius) {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), 0);
}

function geometries(root: THREE.Object3D) {
  const found: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) found.push(o.geometry);
  });
  return found.map((g) => vi.spyOn(g, "dispose"));
}

describe("revolve manipulator", () => {
  it("is a Manipulator", () => {
    expect(revolve(stubHost())).toBeInstanceOf(Manipulator);
  });

  it("hits its ring at a projected ring point and misses 20 px away", () => {
    const host = stubHost();
    const gizmo = revolve(host);
    const on = worldToClient(rect, host.camera, ringPoint(90));
    expect(gizmo.hitTest(on.x, on.y)).toBe(true);
    expect(gizmo.hitTest(on.x, on.y - 20)).toBe(false);
  });

  it("drags cumulative angle past 180 degrees", () => {
    const host = stubHost();
    const gizmo = revolve(host);
    const at = (deg: number) =>
      worldToClient(rect, host.camera, ringPoint(deg));
    const start = at(0);
    gizmo.beginDrag(start.x, start.y);
    expect(gizmo.isDragging).toBe(true);
    let angle = 0;
    for (let deg = 30; deg <= 270; deg += 30) {
      const p = at(deg);
      angle = gizmo.dragAngle(p.x, p.y);
    }
    expect(angle).toBe(270);
    gizmo.endDrag();
    expect(gizmo.isDragging).toBe(false);
  });

  it("labels the handle at its projected position", () => {
    const host = stubHost();
    const gizmo = revolve(host, 90);
    const expected = worldToClient(rect, host.camera, ringPoint(90));
    const label = gizmo.handleScreenPosition();
    expect(label.x).toBeCloseTo(expected.x, 9);
    expect(label.y).toBeCloseTo(expected.y, 9);
  });

  it("leaves the scene with every geometry disposed once", () => {
    const host = stubHost();
    const gizmo = revolve(host);
    const [group] = host.scene.children;
    const spies = geometries(group!);
    expect(spies.length).toBeGreaterThan(0);
    gizmo.dispose();
    gizmo.dispose();
    expect(group!.parent).toBeNull();
    expect(host.scene.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not dispose again after the host scene was cleared", () => {
    const host = stubHost();
    const gizmo = revolve(host);
    const spies = geometries(host.scene.children[0]!);
    clearGroup(host.scene);
    gizmo.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

const extrudeSource: GizmoSource = {
  frame: {
    origin: [0, 0, 0],
    xAxis: [0, 1, 0],
    yAxis: [0, 0, 1],
    normal: [1, 0, 0],
  },
  anchorUV: [0, 0],
  profile: {
    id: "p",
    outer: [],
    holes: [],
    polygon: [-2, -2, 2, -2, 2, 2, -2, 2],
    holePolygons: [],
    area: 16,
  },
};

describe("extrude manipulator", () => {
  it("is a Manipulator", () => {
    expect(new ExtrudeGizmo(stubHost(), extrudeSource, 5)).toBeInstanceOf(
      Manipulator,
    );
  });

  it("hits the arrow within 9 px and misses beyond it", () => {
    const host = stubHost();
    const gizmo = new ExtrudeGizmo(host, extrudeSource, 5);
    const on = worldToClient(rect, host.camera, new THREE.Vector3(3, 0, 0));
    expect(gizmo.hitTest(on.x, on.y)).toBe(true);
    expect(gizmo.hitTest(on.x, on.y - 8)).toBe(true);
    expect(gizmo.hitTest(on.x, on.y + 8)).toBe(true);
    expect(gizmo.hitTest(on.x, on.y - 10)).toBe(false);
    expect(gizmo.hitTest(on.x, on.y + 10)).toBe(false);
  });

  it("snaps dragValue to snapStep", () => {
    const host = stubHost();
    const gizmo = new ExtrudeGizmo(host, extrudeSource, 5);
    const step = snapStep(host.worldPerPixel());
    for (const x of [3.4, -7.8, 12.6]) {
      const p = worldToClient(rect, host.camera, new THREE.Vector3(x, 2, 0));
      expect(gizmo.dragValue(p.x, p.y)).toBeCloseTo(
        Math.round(x / step) * step,
        9,
      );
    }
  });

  it("labels the tip at its projected position", () => {
    const host = stubHost();
    const gizmo = new ExtrudeGizmo(host, extrudeSource, -6, false, 1.5);
    const expected = worldToClient(
      rect,
      host.camera,
      new THREE.Vector3(-4.5, 0, 0),
    );
    const label = gizmo.tipScreenPosition();
    expect(label.x).toBeCloseTo(expected.x, 9);
    expect(label.y).toBeCloseTo(expected.y, 9);
  });

  it("leaves the scene with every geometry disposed once", () => {
    const host = stubHost();
    const gizmo = new ExtrudeGizmo(host, extrudeSource, 5);
    const spies = geometries(host.scene);
    expect(spies.length).toBe(3);
    gizmo.dispose();
    gizmo.dispose();
    expect(host.scene.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not dispose again after the host scene was cleared", () => {
    const host = stubHost();
    const gizmo = new ExtrudeGizmo(host, extrudeSource, 5);
    const spies = geometries(host.scene);
    clearGroup(host.scene);
    gizmo.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
