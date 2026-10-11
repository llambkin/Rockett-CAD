import * as THREE from "three";
import { expect, it } from "vitest";
import type { MeshedBody, Vec3 } from "@rockett/shared";
import { boxPick, type BoxMode, type BoxScene } from "./boxPick";
import type { PickBody } from "./pickProviders";

const rect = { left: 0, top: 0, width: 100, height: 100 };
const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
ortho.position.set(0, 0, 100);
ortho.updateMatrixWorld();

const box = (x0: number, y0: number, x1: number, y1: number) => ({
  left: 50 + Math.min(x0, x1),
  right: 50 + Math.max(x0, x1),
  top: 50 - Math.max(y0, y1),
  bottom: 50 - Math.min(y0, y1),
});

const arc = (r: number, n = 16): number[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = (Math.PI * i) / n;
    return [r * Math.cos(t), r * Math.sin(t), 0];
  }).flat();

function body(
  positions: number[],
  indices: number[],
  polyline: number[],
): PickBody {
  const origin: Vec3 = [0, 0, 0];
  const payload: MeshedBody = {
    bodyId: "b",
    name: "Body1",
    meshKey: "m",
    positions,
    normals: positions.map(() => 0),
    indices,
    faces: [
      {
        name: "f",
        start: 0,
        count: indices.length,
        area: 1,
        surface: { type: "plane", origin, normal: [0, 0, 1] },
      },
    ],
    edges: polyline.length
      ? [
          {
            name: "e",
            polyline,
            length: 1,
            curve: { type: "line", a: origin, b: origin },
          },
        ]
      : [],
    vertices: polyline.length
      ? [{ name: "v", position: [polyline[0]!, polyline[1]!, 0] }]
      : [],
    bbox: { min: origin, max: origin },
  };
  const group = new THREE.Group();
  const mesh = new THREE.Mesh();
  const edges = new THREE.LineSegments();
  const vertices = new THREE.Points();
  group.add(mesh, edges, vertices);
  group.updateMatrixWorld();
  return {
    group,
    mesh,
    edges,
    edgeSegments: [],
    vertices,
    vertexNames: [],
    payload,
    shape: payload,
  };
}

function sketchObject(o: THREE.Line | THREE.Points, id: string, point = false) {
  Object.assign(o.userData, {
    sketchId: "s",
    sketchEntityId: id,
    ...(point ? { isPoint: true } : {}),
  });
  return o;
}

const geometry = (pts: number[]) =>
  new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(pts, 3),
  );

function scene(bodies: PickBody[], ...objects: THREE.Object3D[]): BoxScene {
  const sketches = new THREE.Group();
  sketches.add(...objects);
  sketches.updateMatrixWorld();
  return {
    bodies: new Map(bodies.map((b) => [b.payload.bodyId, b])),
    sketches,
    providerIds: [
      "design.face",
      "design.edge",
      "design.vertex",
      "sketch.entity",
      "sketch.point",
    ],
  };
}

const keys = (
  s: BoxScene,
  b: ReturnType<typeof box>,
  mode: BoxMode,
  camera: THREE.Camera = ortho,
) =>
  boxPick(s, b, mode, rect, camera).map((p) =>
    "edgeName" in p
      ? `edge:${p.edgeName}`
      : "faceName" in p
        ? `face:${p.faceName}`
        : "entityId" in p
          ? `sketch:${p.entityId}`
          : p.kind,
  );

it("rejects a window around an arc's ends when the curve bulges out", () => {
  const s = scene(
    [body([], [], arc(10))],
    sketchObject(new THREE.Line(geometry(arc(10))), "arc"),
  );
  const ends = box(-12, -2, 12, 5);
  expect(keys(s, ends, "window")).toEqual(["vertex"]);
  expect(keys(s, ends, "crossing")).toEqual(["edge:e", "vertex", "sketch:arc"]);
  expect(keys(s, box(-12, -2, 12, 12), "window")).toEqual([
    "edge:e",
    "vertex",
    "sketch:arc",
  ]);
});

it("ignores points behind a perspective camera", () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  const behind = sketchObject(
    new THREE.Points(geometry([0, 0, 20])),
    "behind",
    true,
  );
  const front = sketchObject(
    new THREE.Points(geometry([1, 1, 0])),
    "front",
    true,
  );
  const reaching = sketchObject(
    new THREE.Line(geometry([1, -1, 0, 1, -1, 20])),
    "reaching",
  );
  const s = scene([], behind, front, reaching);
  const all = box(-50, -50, 50, 50);
  expect(keys(s, all, "window", camera)).toEqual(["sketch:front"]);
  expect(keys(s, all, "crossing", camera)).toEqual([
    "sketch:front",
    "sketch:reaching",
  ]);
});

it("crosses a triangle the box sits inside or an edge passes through", () => {
  const triangle = body([-40, -40, 0, 40, -40, 0, 0, 40, 0], [0, 1, 2], []);
  const s = scene([triangle]);
  const within = box(-2, -2, 2, 2);
  expect(keys(s, within, "crossing")).toEqual(["face:f"]);
  expect(keys(s, within, "window")).toEqual([]);
  const across = box(-45, -42, 45, -38);
  expect(keys(s, across, "crossing")).toEqual(["face:f"]);
  expect(keys(s, box(-45, 45, 45, 41), "crossing")).toEqual([]);
  expect(keys(s, box(-45, -45, 45, 45), "window")).toEqual(["face:f"]);
});
