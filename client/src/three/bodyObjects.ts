import * as THREE from "three";
import type { MeshPayload } from "@rockett/shared";
import type { PreviewTint } from "../livePreview";
import { themeColor } from "../theme/tokens";
import { disposeAll, disposeGroup } from "./dispose";
import { BodyMaterials } from "./materials";
import type { PickBody } from "./pickProviders";
import { halfHeightPerDistance } from "./camera";
import { hashOf, meshes, type LayerBody } from "./meshes";

export interface BodyObjects extends PickBody {
  material: THREE.MeshStandardMaterial;
  tint: THREE.MeshStandardMaterial | null;
  coarse: boolean;
}

const COARSE_PX = 64;
const middle = new THREE.Vector3();
const canvas = new THREE.Vector2();

const sameMesh = (a: LayerBody, b: LayerBody) =>
  hashOf(a) === hashOf(b) && a.coarse?.hash === b.coarse?.hash;

function bboxPixels(
  { min, max }: LayerBody["bbox"],
  camera: THREE.Camera,
  height: number,
) {
  const size = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (camera instanceof THREE.OrthographicCamera)
    return (size * height * camera.zoom) / (camera.top - camera.bottom);
  if (!(camera instanceof THREE.PerspectiveCamera)) return Infinity;
  middle.set(min[0] + max[0], min[1] + max[1], min[2] + max[2]);
  const distance = camera.position.distanceTo(middle.multiplyScalar(0.5));
  if (distance <= size / 2) return Infinity;
  return (size * height) / (2 * distance * halfHeightPerDistance(camera.fov));
}

function edgeLines(p: MeshPayload) {
  const points: number[] = [];
  const edgeSegments: string[] = [];
  for (const e of p.edges) {
    for (let i = 0; i + 5 < e.polyline.length; i += 3) {
      points.push(
        e.polyline[i]!,
        e.polyline[i + 1]!,
        e.polyline[i + 2]!,
        e.polyline[i + 3]!,
        e.polyline[i + 4]!,
        e.polyline[i + 5]!,
      );
      edgeSegments.push(e.name);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  return { edgeGeometry: geometry, edgeSegments };
}

function vertexPoints(p: MeshPayload) {
  const points: number[] = [];
  const vertexNames: string[] = [];
  for (const v of p.vertices) {
    points.push(...v.position);
    vertexNames.push(v.name);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  return { vertexGeometry: geometry, vertexNames };
}

function buildBody(
  p: LayerBody,
  shape: MeshPayload,
  coarse: boolean,
  materials: BodyMaterials,
  dimmed: boolean,
): BodyObjects {
  const group = new THREE.Group();
  group.userData.bodyId = p.bodyId;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(shape.positions, 3),
  );
  geom.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(shape.normals, 3),
  );
  geom.setIndex(shape.indices);
  const { edgeGeometry, edgeSegments } = edgeLines(shape);
  const { vertexGeometry, vertexNames } = vertexPoints(shape);
  const material = materials.face(p.color, dimmed);
  const mesh = new THREE.Mesh(geom, material);
  mesh.userData.bodyId = p.bodyId;
  const edges = new THREE.LineSegments(edgeGeometry, materials.edge());
  edges.userData.bodyId = p.bodyId;
  const vertices = new THREE.Points(vertexGeometry, materials.vertex());
  vertices.visible = false;
  vertices.userData.bodyId = p.bodyId;
  group.add(mesh, edges, vertices);
  return {
    group,
    mesh,
    material,
    tint: null,
    edges,
    edgeSegments,
    vertices,
    vertexNames,
    payload: p,
    shape,
    coarse,
  };
}

export class BodyLayer {
  readonly bodies = new Map<string, BodyObjects>();
  private readonly materials = new BodyMaterials();
  private missing: LayerBody[] = [];
  private synced: readonly LayerBody[] = [];
  private hidden: ReadonlySet<string> = new Set();
  private dimmed: ReadonlySet<string> = new Set();
  private tints: ReadonlyMap<string, PreviewTint> = new Map();
  private eye: { camera: THREE.Camera; height: number } | null = null;
  private readonly unsubscribe = meshes.subscribe(() => this.arrive());

  constructor(
    private readonly root: THREE.Group,
    private readonly changed: () => void,
  ) {}

  sync(
    bodies: readonly LayerBody[],
    hidden: ReadonlySet<string>,
    projectId?: string,
  ) {
    meshes.useProject(projectId);
    if (bodies !== this.synced) meshes.retry();
    this.synced = bodies;
    this.hidden = hidden;
    this.missing = [];
    const seen = new Set<string>();
    for (const body of bodies) {
      seen.add(body.bodyId);
      const built = this.bodies.get(body.bodyId);
      if (built && sameMesh(built.payload, body)) this.update(built, body);
      else this.show(body, built);
    }
    for (const [id, built] of this.bodies)
      if (!seen.has(id)) this.remove(id, built);
    this.changed();
  }

  dim(ids: ReadonlySet<string>) {
    this.dimmed = ids;
    for (const built of this.bodies.values())
      this.paint(built, built.payload.color);
    this.changed();
  }

  view(camera: THREE.Camera, renderer: Pick<THREE.WebGLRenderer, "getSize">) {
    this.eye = { camera, height: renderer.getSize(canvas).y };
    if (this.relevel()) meshes.notify();
  }

  tint(tints: ReadonlyMap<string, PreviewTint>) {
    this.tints = tints;
    this.relevel();
    for (const [id, b] of this.bodies) {
      const tint = b.coarse ? undefined : tints.get(id);
      const geom = b.mesh.geometry;
      geom.clearGroups();
      if (!tint) {
        b.mesh.material = b.material;
        b.tint?.dispose();
        b.tint = null;
        continue;
      }
      b.tint ??= b.material.clone();
      b.tint.userData.themeToken = tint.tint;
      b.tint.color.set(themeColor(tint.tint));
      let at = 0;
      for (const { start, count } of tint.ranges.toSorted(
        (x, y) => x.start - y.start,
      )) {
        if (start > at) geom.addGroup(at, start - at, 0);
        geom.addGroup(start, count, 1);
        at = start + count;
      }
      const end = geom.index?.count ?? 0;
      if (end > at) geom.addGroup(at, end - at, 0);
      b.mesh.material = [b.material, b.tint];
    }
    this.changed();
  }

  dispose() {
    this.unsubscribe();
    meshes.useProject(undefined);
    this.missing = [];
    for (const [id, built] of this.bodies) this.remove(id, built);
  }

  private wantsCoarse(body: LayerBody) {
    if (!body.coarse || !this.eye || this.tints.has(body.bodyId)) return false;
    const { camera, height } = this.eye;
    return bboxPixels(body.bbox, camera, height) < COARSE_PX;
  }

  private relevel() {
    let swapped = false;
    for (const built of this.bodies.values()) {
      const coarse = this.wantsCoarse(built.payload);
      const shape =
        coarse !== built.coarse && meshes.get(built.payload, coarse);
      if (!shape) continue;
      this.place(built.payload, shape, coarse);
      swapped = true;
    }
    return swapped;
  }

  private show(body: LayerBody, stale: BodyObjects | undefined) {
    const coarse = this.wantsCoarse(body);
    const shape = meshes.get(body, coarse);
    if (shape) return this.place(body, shape, coarse);
    if (stale) stale.group.visible = !this.hidden.has(body.bodyId);
    this.missing.push(body);
  }

  private arrive() {
    const waiting = this.missing;
    this.missing = [];
    for (const body of waiting) this.show(body, this.bodies.get(body.bodyId));
    if (this.relevel() || this.missing.length < waiting.length) this.changed();
  }

  private update(built: BodyObjects, body: LayerBody) {
    if (built.payload.color !== body.color) this.paint(built, body.color);
    built.payload = body;
    built.group.visible = !this.hidden.has(body.bodyId);
  }

  private place(body: LayerBody, shape: MeshPayload, coarse: boolean) {
    const old = this.bodies.get(body.bodyId);
    if (old) this.remove(body.bodyId, old);
    const built = buildBody(
      body,
      shape,
      coarse,
      this.materials,
      this.dimmed.has(body.bodyId),
    );
    built.group.visible = !this.hidden.has(body.bodyId);
    this.bodies.set(body.bodyId, built);
    this.root.add(built.group);
  }

  private paint(built: BodyObjects, color: string | undefined) {
    const old = built.material;
    const next = this.materials.face(
      color,
      this.dimmed.has(built.payload.bodyId),
    );
    this.materials.release(old);
    if (next === old) return;
    built.material = next;
    const { mesh } = built;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => (m === old ? next : m))
      : next;
    disposeAll([old], this.materials.live());
  }

  private remove(id: string, built: BodyObjects) {
    this.root.remove(built.group);
    this.materials.release(built.material);
    this.materials.release(built.edges.material);
    this.materials.release(built.vertices.material);
    disposeGroup(built.group, this.materials.live());
    this.bodies.delete(id);
  }
}
