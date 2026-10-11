import * as THREE from "three";
import type { Selection } from "../selection/kinds";
import type { PickBody } from "./pickProviders";
import { worldToClient } from "./screen";

export type BoxMode = "window" | "crossing";
export interface ClientBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface BoxScene {
  bodies: ReadonlyMap<string, PickBody>;
  sketches: THREE.Object3D;
  providerIds: readonly string[];
}
type XY = { x: number; y: number } | null;
type Project = (positions: ArrayLike<number>, matrix: THREE.Matrix4) => XY[];

const inside = (b: ClientBox, p: XY) =>
  !!p && p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;

function segmentTouches(b: ClientBox, p: XY, q: XY): boolean {
  if (inside(b, p) || inside(b, q)) return true;
  if (!p || !q) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: [number, number][] = [
    [-dx, p.x - b.left],
    [dx, b.right - p.x],
    [-dy, p.y - b.top],
    [dy, b.bottom - p.y],
  ];
  for (const [d, n] of edges) {
    if (d === 0) {
      if (n < 0) return false;
      continue;
    }
    const t = n / d;
    if (d < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function cornerInTriangle(b: ClientBox, p: XY, q: XY, r: XY): boolean {
  if (!p || !q || !r) return false;
  const side = (a: NonNullable<XY>, c: NonNullable<XY>) =>
    (c.x - a.x) * (b.top - a.y) - (c.y - a.y) * (b.left - a.x);
  const s = [side(p, q), side(q, r), side(r, p)];
  return s.every((v) => v >= 0) || s.every((v) => v <= 0);
}

function curveMeets(b: ClientBox, mode: BoxMode, pts: XY[]): boolean {
  if (pts.length === 0) return false;
  if (mode === "window") return pts.every((p) => inside(b, p));
  if (pts.length === 1) return inside(b, pts[0]!);
  return pts.some((p, i) => i > 0 && segmentTouches(b, pts[i - 1]!, p));
}

function trianglesMeet(
  b: ClientBox,
  mode: BoxMode,
  pts: XY[],
  index: ArrayLike<number>,
  start: number,
  count: number,
): boolean {
  const at = (i: number) => pts[index[i]!] ?? null;
  for (let i = start; i + 2 < start + count; i += 3) {
    const [p, q, r] = [at(i), at(i + 1), at(i + 2)];
    if (mode === "window") {
      if (![p, q, r].every((v) => inside(b, v))) return false;
    } else if (
      segmentTouches(b, p, q) ||
      segmentTouches(b, q, r) ||
      segmentTouches(b, r, p) ||
      cornerInTriangle(b, p, q, r)
    )
      return true;
  }
  return mode === "window" && count > 0;
}

function bodyPicks(
  scene: BoxScene,
  b: ClientBox,
  mode: BoxMode,
  project: Project,
): Selection[] {
  const wants = (id: string) => scene.providerIds.includes(id);
  const out: Selection[] = [];
  for (const body of scene.bodies.values()) {
    if (!body.group.visible) continue;
    const { bodyId } = body.payload;
    const { faces, edges, vertices, positions, indices } = body.shape;
    const matrix = body.mesh.matrixWorld;
    const corners = wants("design.face") ? project(positions, matrix) : [];
    for (const f of wants("design.face") ? faces : [])
      if (trianglesMeet(b, mode, corners, indices, f.start, f.count))
        out.push({ kind: "face", bodyId, faceName: f.name });
    for (const e of wants("design.edge") ? edges : [])
      if (curveMeets(b, mode, project(e.polyline, matrix)))
        out.push({ kind: "edge", bodyId, edgeName: e.name });
    for (const v of wants("design.vertex") ? vertices : [])
      if (inside(b, project(v.position, matrix)[0] ?? null))
        out.push({ kind: "vertex", bodyId, vertexName: v.name });
  }
  return out;
}

const shown = (o: THREE.Object3D | null): boolean =>
  !o || (o.visible && shown(o.parent));

function sketchPick(
  o: THREE.Object3D,
  wants: (id: string) => boolean,
  meets: (o: THREE.Object3D, geometry: THREE.BufferGeometry) => boolean,
): Selection | null {
  const ud = o.userData;
  const geometry = (o as THREE.Mesh).geometry;
  if (!geometry || !shown(o)) return null;
  const id = ud.profileId
    ? "sketch.profile"
    : ud.isPoint
      ? "sketch.point"
      : ud.sketchEntityId && "sketch.entity";
  if (!id || !wants(id) || !meets(o, geometry)) return null;
  if (ud.profileId)
    return { kind: "profile", sketchId: ud.sketchId, profileId: ud.profileId };
  return {
    kind: ud.isPoint ? "sketchPoint" : "sketchEntity",
    sketchId: ud.sketchId,
    entityId: ud.sketchEntityId,
  };
}

export function boxPick(
  scene: BoxScene,
  b: ClientBox,
  mode: BoxMode,
  rect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  camera: THREE.Camera,
): Selection[] {
  const v = new THREE.Vector3();
  const project: Project = (positions, matrix) => {
    const out: XY[] = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      v.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      const c = worldToClient(rect, camera, v.applyMatrix4(matrix));
      out.push(c.inFront ? c : null);
    }
    return out;
  };
  const wants = (id: string) => scene.providerIds.includes(id);
  const meets = (o: THREE.Object3D, g: THREE.BufferGeometry) => {
    const pts = project(g.getAttribute("position").array, o.matrixWorld);
    if (!(o as THREE.Mesh).isMesh) return curveMeets(b, mode, pts);
    const index = g.index?.array ?? Array.from(pts.keys());
    return trianglesMeet(b, mode, pts, index, 0, index.length);
  };
  const sketches: Selection[] = [];
  scene.sketches.traverse((o) => {
    const picked = sketchPick(o, wants, meets);
    if (picked) sketches.push(picked);
  });
  return [...bodyPicks(scene, b, mode, project), ...sketches];
}
