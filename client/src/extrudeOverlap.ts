import { Plane, Ray, Vector3 } from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import {
  LINEAR_TOL,
  type BodyPayload,
  type MeshPayload,
  type Vec3,
} from "@rockett/shared";
import { meshOf } from "./three/meshes";

interface Solid {
  corners: Float64Array;
  boxes: Float64Array;
  shadows: Float64Array;
  min: Vec3;
  max: Vec3;
}

interface Cell {
  min: Vec3;
  max: Vec3;
  planes: Plane[];
  center: Vector3;
}

const solids = new WeakMap<MeshPayload, Solid>();

const RAY = new Vector3(1, 0.371, 0.529).normalize();
const ACROSS = [
  new Vector3(0, 0, 1).cross(RAY).normalize(),
  RAY.clone()
    .cross(new Vector3(0, 0, 1).cross(RAY))
    .normalize(),
];

const shadow = (p: Vector3) => ACROSS.map((axis) => p.dot(axis));

const scratch = [new Vector3(), new Vector3(), new Vector3()];

function triangle({ corners }: Pick<Solid, "corners">, t: number): Vector3[] {
  for (const [k, v] of scratch.entries()) v.fromArray(corners, t * 9 + k * 3);
  return scratch;
}

function solid(body: BodyPayload, mesh: MeshPayload): Solid {
  const known = solids.get(mesh);
  if (known) return known;
  const count = Math.floor(mesh.indices.length / 3);
  const corners = new Float64Array(count * 9);
  const boxes = new Float64Array(count * 6).fill(Infinity, 0, count * 6);
  for (let t = 0; t < count; t++)
    for (let k = 0; k < 3; k++)
      for (let axis = 0; axis < 3; axis++) {
        const v = mesh.positions[mesh.indices[t * 3 + k]! * 3 + axis]!;
        corners[t * 9 + k * 3 + axis] = v;
        boxes[t * 6 + axis] = Math.min(boxes[t * 6 + axis]!, v);
        boxes[t * 6 + 3 + axis] =
          k === 0 ? v : Math.max(boxes[t * 6 + 3 + axis]!, v);
      }
  const shadows = new Float64Array(count * 4);
  for (let t = 0; t < count; t++) {
    const flat = triangle({ corners }, t).map(shadow);
    for (const i of [0, 1]) {
      const along = flat.map((q) => q[i]!);
      shadows[t * 4 + i * 2] = Math.min(...along) - LINEAR_TOL;
      shadows[t * 4 + i * 2 + 1] = Math.max(...along) + LINEAR_TOL;
    }
  }
  const made = {
    corners,
    boxes,
    shadows,
    min: body.bbox.min,
    max: body.bbox.max,
  };
  solids.set(mesh, made);
  return made;
}

function triangleInCell(polygon: Vector3[], planes: Plane[]): boolean {
  for (const plane of planes) {
    const clipped: Vector3[] = [];
    for (const [j, a] of polygon.entries()) {
      const b = polygon[(j + 1) % polygon.length]!;
      const da = plane.distanceToPoint(a);
      const db = plane.distanceToPoint(b);
      if (da >= 0) clipped.push(a);
      if (da < 0 !== db < 0) clipped.push(a.clone().lerp(b, da / (da - db)));
    }
    polygon = clipped;
    if (!polygon.length) break;
  }
  return polygon.length > 0;
}

function cellNear(points: Vec3[], body: Solid, margin: number): Cell | null {
  const min = [0, 1, 2].map(
    (i) => Math.min(...points.map((p) => p[i]!)) - LINEAR_TOL,
  ) as Vec3;
  const max = [0, 1, 2].map(
    (i) => Math.max(...points.map((p) => p[i]!)) + LINEAR_TOL,
  ) as Vec3;
  if ([0, 1, 2].some((i) => max[i]! < body.min[i]! || min[i]! > body.max[i]!))
    return null;
  const hull = new ConvexHull().setFromPoints(
    points.map((p) => new Vector3(...p)),
  );
  if (
    hull.faces.length < 4 ||
    hull.faces.some((face) => face.normal.lengthSq() < 0.5)
  )
    return null;
  const planes = hull.faces.map(
    (face) => new Plane(face.normal.clone().negate(), face.constant + margin),
  );
  const center = points
    .reduce((sum, p) => sum.add(new Vector3(...p)), new Vector3())
    .multiplyScalar(1 / points.length);
  return { min, max, planes, center };
}

function touches({ min, max, planes }: Cell, body: Solid): boolean {
  const { boxes } = body;
  for (let t = 0; t * 6 < boxes.length; t++) {
    let near = true;
    for (let i = 0; i < 3 && near; i++)
      near = boxes[t * 6 + 3 + i]! >= min[i]! && boxes[t * 6 + i]! <= max[i]!;
    if (near && triangleInCell(triangle(body, t), planes)) return true;
  }
  return false;
}

function inside(center: Vector3, body: Solid): boolean {
  const c = center.toArray();
  if ([0, 1, 2].some((i) => c[i]! < body.min[i]! || c[i]! > body.max[i]!))
    return false;
  const ray = new Ray(center, RAY);
  const hits: { distance: number; facing: number }[] = [];
  const target = new Vector3();
  const edge = new Vector3();
  const side = new Vector3();
  const [u, v] = shadow(center) as [number, number];
  const { shadows } = body;
  for (let t = 0; t * 4 < shadows.length; t++) {
    if (
      u < shadows[t * 4]! ||
      u > shadows[t * 4 + 1]! ||
      v < shadows[t * 4 + 2]! ||
      v > shadows[t * 4 + 3]!
    )
      continue;
    const [a, b, d] = triangle(body, t) as [Vector3, Vector3, Vector3];
    if (!ray.intersectTriangle(a, b, d, false, target)) continue;
    const facing = Math.sign(
      edge.subVectors(b, a).cross(side.subVectors(d, a)).dot(RAY),
    );
    hits.push({ distance: center.distanceTo(target), facing });
  }
  hits.sort((x, y) => x.distance - y.distance);
  const crossings = hits.filter((hit, i) => {
    const prior = hits[i - 1];
    return (
      !prior ||
      hit.facing !== prior.facing ||
      Math.abs(hit.distance - prior.distance) >
        Number.EPSILON * Math.max(1, hit.distance) * 8
    );
  });
  return crossings.reduce((total, hit) => total + hit.facing, 0) !== 0;
}

export function cellsMeetSolid(
  cells: Vec3[][],
  body: BodyPayload,
  margin: number,
): boolean {
  const mesh = meshOf(body);
  if (!mesh) return false;
  const prepared = solid(body, mesh);
  const near = cells.flatMap((points) => {
    const cell = cellNear(points, prepared, margin);
    return cell ? [cell] : [];
  });
  return (
    near.some((cell) => touches(cell, prepared)) ||
    near.some((cell) => inside(cell.center, prepared))
  );
}
