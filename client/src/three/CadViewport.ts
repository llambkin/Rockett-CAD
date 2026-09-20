/**
 * Three.js viewport engine.
 *
 * Owns the renderer/scene/cameras and keeps the scene in sync with the
 * evaluated model. The mesh is only a visualisation — every rendered face,
 * edge and vertex carries its persistent CAD topology name so picking
 * resolves to CAD references, not triangles.
 */

import * as THREE from "three";
import type {
  BodyPayload,
  ConstructionPlanePayload,
  PlaneFrame,
  SketchPayload,
  Vec3,
} from "@rockett/shared";
import type { Selection } from "../store";

export const COLORS = {
  bg: 0x2a2d30,
  body: 0xb7bcc1,
  bodyHover: 0xd3dbe3,
  edge: 0x30343a,
  edgeHover: 0x38b6ff,
  selected: 0x4da3ff,
  hover: 0x77c4ff,
  sketchLine: 0x3ba1e8,
  sketchConstruction: 0x8f7fe8,
  sketchPoint: 0x1c72b8,
  sketchFixed: 0x2c9c3e,
  profileFill: 0x3ba1e8,
  planeFill: 0xf2b34c,
  dimension: 0xd8dee6,
};

export interface PickResult {
  selection: Selection;
  distance: number;
  point: THREE.Vector3;
  /** sketch-region area — the tie-break when coplanar regions overlap */
  area?: number;
}

const ORIGIN_PLANE_DEFS: { name: "XY" | "XZ" | "YZ"; frame: PlaneFrame }[] = [
  {
    name: "XY",
    frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1] },
  },
  {
    name: "XZ",
    frame: { origin: [0, 0, 0], xAxis: [1, 0, 0], yAxis: [0, 0, 1], normal: [0, -1, 0] },
  },
  {
    name: "YZ",
    frame: { origin: [0, 0, 0], xAxis: [0, 1, 0], yAxis: [0, 0, 1], normal: [1, 0, 0] },
  },
];

export function frameBasis(frame: PlaneFrame): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.makeBasis(
    new THREE.Vector3(...frame.xAxis),
    new THREE.Vector3(...frame.yAxis),
    new THREE.Vector3(...frame.normal)
  );
  m.setPosition(new THREE.Vector3(...frame.origin));
  return m;
}

export function uv3(frame: PlaneFrame, u: number, v: number): THREE.Vector3 {
  return new THREE.Vector3(
    frame.origin[0] + u * frame.xAxis[0] + v * frame.yAxis[0],
    frame.origin[1] + u * frame.xAxis[1] + v * frame.yAxis[1],
    frame.origin[2] + u * frame.xAxis[2] + v * frame.yAxis[2]
  );
}

interface BodyObjects {
  group: THREE.Group;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  /** segment index → edge name */
  edgeSegments: string[];
  vertices: THREE.Points;
  vertexNames: string[];
  payload: BodyPayload;
}

export class CadViewport {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  orthoCam: THREE.OrthographicCamera;
  perspCam: THREE.PerspectiveCamera;
  projection: "orthographic" | "perspective" = "orthographic";
  target = new THREE.Vector3(0, 0, 0);
  /** ortho half-height in mm */
  zoom = 90;

  private container: HTMLElement;
  private bodies = new Map<string, BodyObjects>();
  private bodyRoot = new THREE.Group();
  private sketchRoot = new THREE.Group();
  private planeRoot = new THREE.Group();
  private overlayRoot = new THREE.Group();
  private originRoot = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private animFrame = 0;
  private animating: null | {
    t: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromUp: THREE.Vector3;
    toUp: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromZoom: number;
    toZoom: number;
  } = null;

  originPlanesVisible = true;
  onRender: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(COLORS.bg);
    container.appendChild(this.renderer.domElement);

    const aspect = 1;
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.perspCam = new THREE.PerspectiveCamera(40, aspect, 0.1, 100000);
    for (const cam of [this.orthoCam, this.perspCam]) {
      cam.up.set(0, 0, 1);
      cam.position.set(120, -120, 100);
      cam.lookAt(this.target);
    }

    // lighting: hemisphere + key light attached to camera for stable shading
    const hemi = new THREE.HemisphereLight(0xffffff, 0x555566, 0.9);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(0.6, -0.9, 1.4);
    this.scene.add(key);

    this.scene.add(this.originRoot);
    this.scene.add(this.planeRoot);
    this.scene.add(this.bodyRoot);
    this.scene.add(this.sketchRoot);
    this.scene.add(this.overlayRoot);

    this.buildOriginDisplay();
    this.resize();

    const loop = () => {
      this.animFrame = requestAnimationFrame(loop);
      this.stepAnimation();
      this.render();
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.animFrame);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  get camera(): THREE.Camera {
    return this.projection === "orthographic" ? this.orthoCam : this.perspCam;
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    const aspect = w / h;
    this.orthoCam.left = -this.zoom * aspect;
    this.orthoCam.right = this.zoom * aspect;
    this.orthoCam.top = this.zoom;
    this.orthoCam.bottom = -this.zoom;
    this.orthoCam.updateProjectionMatrix();
    this.perspCam.aspect = aspect;
    this.perspCam.updateProjectionMatrix();
  }

  render() {
    this.onRender?.();
    this.renderer.render(this.scene, this.camera);
  }

  /** World units per screen pixel at the target depth. */
  worldPerPixel(): number {
    const h = this.container.clientHeight || 1;
    if (this.projection === "orthographic") {
      return (this.zoom * 2) / h;
    }
    const dist = this.perspCam.position.distanceTo(this.target);
    return (2 * dist * Math.tan((this.perspCam.fov * Math.PI) / 360)) / h;
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  private applyZoom() {
    const aspect =
      (this.container.clientWidth || 1) / (this.container.clientHeight || 1);
    this.orthoCam.left = -this.zoom * aspect;
    this.orthoCam.right = this.zoom * aspect;
    this.orthoCam.top = this.zoom;
    this.orthoCam.bottom = -this.zoom;
    this.orthoCam.updateProjectionMatrix();
  }

  /**
   * Trackball-style orbit ("grab the model"): horizontal drag rotates the
   * model around the screen-vertical axis, vertical drag around the
   * screen-horizontal axis, so the geometry under the cursor follows it from
   * ANY orientation (the turntable orbit degenerates near top/bottom views).
   * Used by the ViewCube drag.
   */
  orbitTrackball(dx: number, dy: number) {
    const cam = this.camera;
    const offset = cam.position.clone().sub(this.target);
    const forward = offset.clone().normalize().negate();
    const right = new THREE.Vector3()
      .crossVectors(forward, cam.up)
      .normalize();
    const screenUp = new THREE.Vector3().crossVectors(right, forward).normalize();
    // model follows the cursor → camera rotates by the inverse
    const q = new THREE.Quaternion()
      .setFromAxisAngle(screenUp, dx * 0.014)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.014))
      .invert();
    offset.applyQuaternion(q);
    const newUp = cam.up.clone().applyQuaternion(q).normalize();
    for (const c of [this.orthoCam, this.perspCam]) {
      c.up.copy(newUp);
      c.position.copy(this.target).add(offset);
      c.lookAt(this.target);
    }
  }

  orbit(dx: number, dy: number) {
    const cam = this.camera;
    const offset = cam.position.clone().sub(this.target);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      cam.up.clone().normalize(),
      new THREE.Vector3(0, 0, 1)
    );
    // Use spherical around current up
    const spherical = new THREE.Spherical().setFromVector3(
      offset.clone().applyQuaternion(quat)
    );
    spherical.theta -= dx * 0.008;
    spherical.phi -= dy * 0.008;
    spherical.phi = Math.max(0.02, Math.min(Math.PI - 0.02, spherical.phi));
    const newOffset = new THREE.Vector3()
      .setFromSpherical(spherical)
      .applyQuaternion(quat.clone().invert());
    for (const c of [this.orthoCam, this.perspCam]) {
      c.position.copy(this.target).add(newOffset);
      c.lookAt(this.target);
    }
  }

  pan(dx: number, dy: number) {
    const scale = this.worldPerPixel();
    const cam = this.camera as THREE.Camera;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    const move = right
      .multiplyScalar(-dx * scale)
      .add(up.multiplyScalar(dy * scale));
    this.target.add(move);
    for (const c of [this.orthoCam, this.perspCam]) {
      c.position.add(move);
    }
  }

  zoomBy(factor: number, clientX?: number, clientY?: number) {
    // zoom toward cursor: keep the world point under the cursor stationary
    let before: THREE.Vector3 | null = null;
    if (clientX !== undefined && clientY !== undefined) {
      before = this.screenToPlanePoint(clientX, clientY, null);
    }
    this.zoom = Math.max(0.05, Math.min(100000, this.zoom * factor));
    this.applyZoom();
    // perspective: dolly
    const dir = this.perspCam.position.clone().sub(this.target);
    this.perspCam.position.copy(this.target).add(dir.multiplyScalar(factor));
    if (before) {
      const after = this.screenToPlanePoint(clientX!, clientY!, null);
      if (after) {
        const shift = before.sub(after);
        this.target.add(shift);
        this.orthoCam.position.add(shift);
        this.perspCam.position.add(shift);
      }
    }
  }

  /** Project a screen point onto a plane (default: view plane through target). */
  screenToPlanePoint(
    clientX: number,
    clientY: number,
    frame: PlaneFrame | null
  ): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    let plane: THREE.Plane;
    if (frame) {
      const n = new THREE.Vector3(...frame.normal);
      plane = new THREE.Plane(
        n,
        -n.dot(new THREE.Vector3(...frame.origin))
      );
    } else {
      const n = this.camera
        .getWorldDirection(new THREE.Vector3())
        .multiplyScalar(-1);
      plane = new THREE.Plane(n, -n.dot(this.target));
    }
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  setView(direction: Vec3, up: Vec3, animate = true) {
    const dist = Math.max(this.perspCam.position.distanceTo(this.target), 50);
    const toPos = this.target
      .clone()
      .add(new THREE.Vector3(...direction).normalize().multiplyScalar(dist));
    this.animateTo(toPos, new THREE.Vector3(...up), this.target.clone(), this.zoom, animate);
  }

  /** Fit current bodies (or a bbox) into view. */
  zoomToFit(animate = true) {
    const box = new THREE.Box3();
    let any = false;
    for (const b of this.bodies.values()) {
      if (b.group.visible) {
        box.expandByObject(b.mesh);
        any = true;
      }
    }
    this.sketchRoot.updateWorldMatrix(true, true);
    if (this.sketchRoot.children.length > 0) {
      box.expandByObject(this.sketchRoot);
      any = true;
    }
    if (!any) box.set(new THREE.Vector3(-60, -60, -30), new THREE.Vector3(60, 60, 30));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const newZoom = Math.max(size * 0.62, 10);
    const dir = this.camera.position.clone().sub(this.target).normalize();
    const toPos = center.clone().add(dir.multiplyScalar(Math.max(size * 1.8, 100)));
    this.animateTo(toPos, this.camera.up.clone(), center, newZoom, animate);
  }

  animateTo(
    toPos: THREE.Vector3,
    toUp: THREE.Vector3,
    toTarget: THREE.Vector3,
    toZoom: number,
    animate = true
  ) {
    if (!animate) {
      this.target.copy(toTarget);
      this.zoom = toZoom;
      this.applyZoom();
      for (const c of [this.orthoCam, this.perspCam]) {
        c.up.copy(toUp);
        c.position.copy(toPos);
        c.lookAt(this.target);
      }
      return;
    }
    this.animating = {
      t: 0,
      fromPos: this.camera.position.clone(),
      toPos,
      fromUp: this.camera.up.clone(),
      toUp,
      fromTarget: this.target.clone(),
      toTarget,
      fromZoom: this.zoom,
      toZoom,
    };
  }

  private stepAnimation() {
    if (!this.animating) return;
    const a = this.animating;
    a.t = Math.min(1, a.t + 0.08);
    const e = 1 - Math.pow(1 - a.t, 3);
    this.target.lerpVectors(a.fromTarget, a.toTarget, e);
    this.zoom = a.fromZoom + (a.toZoom - a.fromZoom) * e;
    this.applyZoom();
    const pos = new THREE.Vector3().lerpVectors(a.fromPos, a.toPos, e);
    const up = new THREE.Vector3().lerpVectors(a.fromUp, a.toUp, e).normalize();
    for (const c of [this.orthoCam, this.perspCam]) {
      c.up.copy(up);
      c.position.copy(pos);
      c.lookAt(this.target);
    }
    if (a.t >= 1) this.animating = null;
  }

  setProjection(p: "orthographic" | "perspective") {
    this.projection = p;
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Origin display
  // -------------------------------------------------------------------------

  private originPlaneMeshes: THREE.Mesh[] = [];

  private buildOriginDisplay() {
    const size = 30;
    for (const def of ORIGIN_PLANE_DEFS) {
      const geom = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x999faf,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.applyMatrix4(frameBasis(def.frame));
      mesh.userData.originPlane = def.name;
      mesh.renderOrder = -5;
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: 0x8b93a5, transparent: true, opacity: 0.35 })
      );
      mesh.add(border);
      this.originRoot.add(mesh);
      this.originPlaneMeshes.push(mesh);
    }
    // axes
    const axes = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xcc5555 },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x55aa55 },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x5577cc },
    ];
    for (const a of axes) {
      const geom = new THREE.BufferGeometry().setFromPoints([
        a.dir.clone().multiplyScalar(-18),
        a.dir.clone().multiplyScalar(18),
      ]);
      this.originRoot.add(
        new THREE.Line(
          geom,
          new THREE.LineBasicMaterial({ color: a.color, transparent: true, opacity: 0.6 })
        )
      );
    }
  }

  setOriginVisible(v: boolean) {
    this.originRoot.visible = v;
  }

  // -------------------------------------------------------------------------
  // Bodies
  // -------------------------------------------------------------------------

  syncBodies(payloads: BodyPayload[]) {
    const seen = new Set<string>();
    for (const p of payloads) {
      seen.add(p.bodyId);
      const existing = this.bodies.get(p.bodyId);
      if (existing && existing.payload === p) {
        existing.group.visible = p.visible;
        continue;
      }
      if (existing) {
        this.bodyRoot.remove(existing.group);
        disposeGroup(existing.group);
        this.bodies.delete(p.bodyId);
      }
      const objs = this.buildBody(p);
      this.bodies.set(p.bodyId, objs);
      this.bodyRoot.add(objs.group);
      objs.group.visible = p.visible;
    }
    for (const [id, objs] of [...this.bodies]) {
      if (!seen.has(id)) {
        this.bodyRoot.remove(objs.group);
        disposeGroup(objs.group);
        this.bodies.delete(id);
      }
    }
  }

  private buildBody(p: BodyPayload): BodyObjects {
    const group = new THREE.Group();
    group.userData.bodyId = p.bodyId;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(p.positions, 3));
    geom.setAttribute("normal", new THREE.Float32BufferAttribute(p.normals, 3));
    geom.setIndex(p.indices);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.body,
      metalness: 0.15,
      roughness: 0.55,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.bodyId = p.bodyId;
    group.add(mesh);

    // edges as segment soup with per-segment edge names
    const edgePts: number[] = [];
    const edgeSegments: string[] = [];
    for (const e of p.edges) {
      for (let i = 0; i + 5 < e.polyline.length; i += 3) {
        edgePts.push(
          e.polyline[i],
          e.polyline[i + 1],
          e.polyline[i + 2],
          e.polyline[i + 3],
          e.polyline[i + 4],
          e.polyline[i + 5]
        );
        edgeSegments.push(e.name);
      }
    }
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute("position", new THREE.Float32BufferAttribute(edgePts, 3));
    const edges = new THREE.LineSegments(
      edgeGeom,
      new THREE.LineBasicMaterial({ color: COLORS.edge })
    );
    edges.userData.bodyId = p.bodyId;
    group.add(edges);

    // vertices
    const vertPts: number[] = [];
    const vertexNames: string[] = [];
    for (const v of p.vertices) {
      vertPts.push(...v.position);
      vertexNames.push(v.name);
    }
    const vertGeom = new THREE.BufferGeometry();
    vertGeom.setAttribute("position", new THREE.Float32BufferAttribute(vertPts, 3));
    const vertices = new THREE.Points(
      vertGeom,
      new THREE.PointsMaterial({ color: COLORS.edge, size: 4, sizeAttenuation: false })
    );
    vertices.visible = false; // shown during vertex-relevant modes
    vertices.userData.bodyId = p.bodyId;
    group.add(vertices);

    return { group, mesh, edges, edgeSegments, vertices, vertexNames, payload: p };
  }

  setBodyDimmed(dim: boolean, exceptBodyId?: string) {
    for (const [id, b] of this.bodies) {
      const mat = b.mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = dim && id !== exceptBodyId;
      mat.opacity = dim && id !== exceptBodyId ? 0.35 : 1;
      mat.needsUpdate = true;
    }
  }

  bodyPayloads(): BodyPayload[] {
    return [...this.bodies.values()].map((b) => b.payload);
  }

  // -------------------------------------------------------------------------
  // Picking
  // -------------------------------------------------------------------------

  pick(
    clientX: number,
    clientY: number,
    opts: {
      bodies?: boolean;
      faces?: boolean;
      edges?: boolean;
      vertices?: boolean;
      originPlanes?: boolean;
      constructionPlanes?: boolean;
      profiles?: boolean;
      sketchEntities?: boolean;
      depth?: number; // alt-click cycling
    }
  ): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      (-(clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const pxTol = this.worldPerPixel() * 7;
    this.raycaster.params.Line = { threshold: pxTol };
    this.raycaster.params.Points = { threshold: pxTol * 1.4 };

    const results: PickResult[] = [];

    // vertices (highest priority)
    if (opts.vertices) {
      for (const b of this.bodies.values()) {
        if (!b.group.visible) continue;
        b.vertices.visible = true;
        const hits = this.raycaster.intersectObject(b.vertices, false);
        b.vertices.visible = false;
        for (const h of hits) {
          if (h.index === undefined) continue;
          results.push({
            selection: {
              kind: "vertex",
              bodyId: b.payload.bodyId,
              vertexName: b.vertexNames[h.index],
            },
            distance: h.distance - pxTol * 2.2,
            point: h.point,
          });
        }
      }
    }

    if (opts.edges) {
      for (const b of this.bodies.values()) {
        if (!b.group.visible) continue;
        const hits = this.raycaster.intersectObject(b.edges, false);
        for (const h of hits) {
          if (h.index === undefined) continue;
          const seg = Math.floor(h.index / 2);
          const name = b.edgeSegments[seg];
          if (!name) continue;
          results.push({
            selection: { kind: "edge", bodyId: b.payload.bodyId, edgeName: name },
            distance: h.distance - pxTol * 1.2,
            point: h.point,
          });
        }
      }
    }

    if (opts.faces || opts.bodies) {
      for (const b of this.bodies.values()) {
        if (!b.group.visible) continue;
        const hits = this.raycaster.intersectObject(b.mesh, false);
        for (const h of hits) {
          if (h.faceIndex === undefined || h.faceIndex === null) continue;
          const indexPos = h.faceIndex * 3;
          const face = b.payload.faces.find(
            (f) => indexPos >= f.start && indexPos < f.start + f.count
          );
          if (opts.faces && face) {
            results.push({
              selection: {
                kind: "face",
                bodyId: b.payload.bodyId,
                faceName: face.name,
              },
              distance: h.distance,
              point: h.point,
            });
          } else if (opts.bodies) {
            results.push({
              selection: { kind: "body", bodyId: b.payload.bodyId },
              distance: h.distance,
              point: h.point,
            });
          }
        }
      }
    }

    if (opts.originPlanes) {
      for (const mesh of this.originPlaneMeshes) {
        if (!this.originRoot.visible) continue;
        const hits = this.raycaster.intersectObject(mesh, false);
        for (const h of hits) {
          results.push({
            selection: {
              kind: "plane",
              ref: { kind: "origin", plane: mesh.userData.originPlane },
              label: `${mesh.userData.originPlane} Plane`,
            },
            distance: h.distance + pxTol, // lower priority than solid geometry
            point: h.point,
          });
        }
      }
    }

    if (opts.constructionPlanes || opts.profiles || opts.sketchEntities) {
      const targets: THREE.Object3D[] = [];
      if (opts.constructionPlanes) targets.push(this.planeRoot);
      if (opts.profiles || opts.sketchEntities) targets.push(this.sketchRoot);
      const hits = this.raycaster.intersectObjects(targets, true);
      for (const h of hits) {
        const ud = h.object.userData;
        if (opts.constructionPlanes && ud.constructionPlane) {
          results.push({
            selection: {
              kind: "plane",
              ref: { kind: "construction", featureId: ud.constructionPlane },
              label: ud.label ?? "Plane",
            },
            distance: h.distance + pxTol,
            point: h.point,
          });
        } else if (opts.profiles && ud.profileId) {
          results.push({
            selection: {
              kind: "profile",
              sketchId: ud.sketchId,
              profileId: ud.profileId,
            },
            // profiles outrank faces/bodies at the same depth: clicking a
            // sketch region on a face must select the region, not the face
            distance: h.distance - pxTol * 1.1,
            point: h.point,
            area: ud.area as number | undefined,
          });
        } else if (opts.sketchEntities && ud.sketchEntityId) {
          results.push({
            selection: {
              kind: ud.isPoint ? "sketchPoint" : "sketchEntity",
              sketchId: ud.sketchId,
              entityId: ud.sketchEntityId,
            },
            // curves outrank profile regions (1.1) when actually hit;
            // points outrank curves
            distance: h.distance - (ud.isPoint ? pxTol * 2 : pxTol * 1.3),
            point: h.point,
          });
        }
      }
    }

    if (results.length === 0) return null;
    results.sort((a, b) => a.distance - b.distance);
    const depth = opts.depth ?? 0;
    const chosen = results[Math.min(depth, results.length - 1)];
    // Coplanar regions can overlap (a disc drawn over a quadrant); the
    // smallest one under the cursor is the one the user means.
    if (chosen.selection.kind === "profile") {
      const tied = results.filter(
        (r) =>
          r.selection.kind === "profile" &&
          Math.abs(r.distance - chosen.distance) < pxTol * 0.1
      );
      if (tied.length > 1) {
        tied.sort((a, b) => (a.area ?? Infinity) - (b.area ?? Infinity));
        return tied[0];
      }
    }
    return chosen;
  }

  // -------------------------------------------------------------------------
  // Highlights (selection / hover overlays)
  // -------------------------------------------------------------------------

  private highlightObjects: THREE.Object3D[] = [];

  clearHighlights() {
    for (const o of this.highlightObjects) {
      o.parent?.remove(o);
      disposeObject(o);
    }
    this.highlightObjects = [];
  }

  addHighlight(sel: Selection, kind: "select" | "hover") {
    const color = kind === "select" ? COLORS.selected : COLORS.hover;
    if (sel.kind === "face" || sel.kind === "body") {
      const b = this.bodies.get(sel.bodyId);
      if (!b) return;
      const src = b.payload;
      let ranges: { start: number; count: number }[];
      if (sel.kind === "face") {
        const f = src.faces.find((x) => x.name === sel.faceName);
        if (!f) return;
        ranges = [f];
      } else {
        ranges = [{ start: 0, count: src.indices.length }];
      }
      for (const r of ranges) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(src.positions, 3)
        );
        geom.setAttribute("normal", new THREE.Float32BufferAttribute(src.normals, 3));
        geom.setIndex(src.indices.slice(r.start, r.start + r.count));
        const mesh = new THREE.Mesh(
          geom,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: kind === "select" ? 0.5 : 0.3,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          })
        );
        mesh.renderOrder = 5;
        this.overlayRoot.add(mesh);
        this.highlightObjects.push(mesh);
      }
    } else if (sel.kind === "edge") {
      const b = this.bodies.get(sel.bodyId);
      const e = b?.payload.edges.find((x) => x.name === sel.edgeName);
      if (!e) return;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < e.polyline.length; i += 3) {
        pts.push(new THREE.Vector3(e.polyline[i], e.polyline[i + 1], e.polyline[i + 2]));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, linewidth: 2, depthTest: false })
      );
      line.renderOrder = 10;
      this.overlayRoot.add(line);
      this.highlightObjects.push(line);
    } else if (sel.kind === "vertex") {
      const b = this.bodies.get(sel.bodyId);
      if (!b) return;
      const idx = b.vertexNames.indexOf(sel.vertexName);
      if (idx < 0) return;
      const v = b.payload.vertices[idx];
      const pt = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...v.position)]),
        new THREE.PointsMaterial({ color, size: 10, sizeAttenuation: false, depthTest: false })
      );
      pt.renderOrder = 11;
      this.overlayRoot.add(pt);
      this.highlightObjects.push(pt);
    } else if (sel.kind === "plane" && sel.ref.kind === "origin") {
      const mesh = this.originPlaneMeshes.find(
        (m) => m.userData.originPlane === (sel.ref as any).plane
      );
      if (mesh) {
        const clone = new THREE.Mesh(
          (mesh.geometry as THREE.BufferGeometry).clone(),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        );
        clone.applyMatrix4(mesh.matrixWorld);
        this.overlayRoot.add(clone);
        this.highlightObjects.push(clone);
      }
    }
    // profile/sketch entity highlights handled by the sketch renderer
  }

  // -------------------------------------------------------------------------
  // Construction planes & sketch content roots (populated externally)
  // -------------------------------------------------------------------------

  getPlaneRoot(): THREE.Group {
    return this.planeRoot;
  }

  getSketchRoot(): THREE.Group {
    return this.sketchRoot;
  }

  syncConstructionPlanes(
    planes: ConstructionPlanePayload[],
    featureNames: Map<string, string>,
    visibleIds: Set<string>
  ) {
    this.planeRoot.clear();
    for (const p of planes) {
      if (p.size <= 0) continue; // reference image frames
      if (!visibleIds.has(p.featureId)) continue;
      const geom = new THREE.PlaneGeometry(p.size * 2, p.size * 2);
      const mat = new THREE.MeshBasicMaterial({
        color: COLORS.planeFill,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.applyMatrix4(frameBasis(p.frame));
      mesh.userData.constructionPlane = p.featureId;
      mesh.userData.label = featureNames.get(p.featureId) ?? "Plane";
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: COLORS.planeFill, transparent: true, opacity: 0.55 })
      );
      mesh.add(border);
      this.planeRoot.add(mesh);
    }
  }
}

function disposeObject(o: THREE.Object3D) {
  const any = o as any;
  any.geometry?.dispose?.();
  const m = any.material;
  if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
  else m?.dispose?.();
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse(disposeObject);
}
