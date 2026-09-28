/**
 * Three.js viewport engine.
 *
 * Owns the renderer/scene/cameras and keeps the scene in sync with the
 * evaluated model. The mesh is only a visualisation — every rendered face,
 * edge and vertex carries its persistent CAD topology name so picking
 * resolves to CAD references, not triangles.
 */

import * as THREE from "three";
import {
  ORIGIN_AXES,
  type BodyPayload,
  type ConstructionPlanePayload,
  type OriginAxis,
  type PlaneFrame,
  type Vec3,
  type ViewCamera,
} from "@rockett/shared";
import type { Selection } from "../store";
import type { PreviewGhost, PreviewTint } from "../livePreview";
import { clientRay } from "./screen";
import { clearGroup, disposeGroup, disposeObject } from "./dispose";
import { type LayerHandle, sceneLayers } from "./sceneLayers";
import {
  activeTheme,
  themeColor,
  subscribeTheme,
  type ThemeTokens,
} from "../theme/tokens";
import { applyThemeToScene } from "../theme/applyThemeToScene";
import {
  cameraTween,
  halfHeightPerDistance,
  orbitAbout,
  restoredPose,
  savedCamera,
  turntableAbout,
  type CameraPose,
} from "./camera";
import { frameScheduler } from "./frameScheduler";
import { getSetting, subscribe } from "../settings";
import {
  BODY_APPEARANCE,
  HIGHLIGHT_APPEARANCE,
  PLANE_APPEARANCE,
  TIMING_MS,
} from "../tunables";

export interface PickResult {
  selection: Selection;
  distance: number;
  point: THREE.Vector3;
  /** sketch-region area — the tie-break when coplanar regions overlap */
  area?: number | undefined;
}

export function pickThresholds(worldPerPixel: number, px: number) {
  const line = worldPerPixel * px;
  return { line, point: line * 1.4 };
}

export const ORIGIN_PLANE_DEFS: {
  name: "XY" | "XZ" | "YZ";
  frame: PlaneFrame;
}[] = [
  {
    name: "XY",
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    },
  },
  {
    name: "XZ",
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 0, 1],
      normal: [0, -1, 0],
    },
  },
  {
    name: "YZ",
    frame: {
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
    },
  },
];

export function frameBasis(frame: PlaneFrame): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.makeBasis(
    new THREE.Vector3(...frame.xAxis),
    new THREE.Vector3(...frame.yAxis),
    new THREE.Vector3(...frame.normal),
  );
  m.setPosition(new THREE.Vector3(...frame.origin));
  return m;
}

export function uv3(frame: PlaneFrame, u: number, v: number): THREE.Vector3 {
  return new THREE.Vector3(
    frame.origin[0] + u * frame.xAxis[0] + v * frame.yAxis[0],
    frame.origin[1] + u * frame.xAxis[1] + v * frame.yAxis[1],
    frame.origin[2] + u * frame.xAxis[2] + v * frame.yAxis[2],
  );
}

interface BodyObjects {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  tint: THREE.MeshStandardMaterial | null;
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
  projection: "orthographic" | "perspective" = getSetting("view.projection");
  target = new THREE.Vector3(0, 0, 0);
  /** ortho half-height in mm */
  zoom = 90;

  private container: HTMLElement;
  private bodies = new Map<string, BodyObjects>();
  private bodyRoot = new THREE.Group();
  private ghostRoot = new THREE.Group();
  private ghosts = new Map<
    string,
    THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  >();
  private overlayRoot = new THREE.Group();
  private originRoot = new THREE.Group();
  private layers = sceneLayers(this.scene);
  readonly addLayer = this.layers.addLayer;
  private planes: LayerHandle;
  readonly sketches: LayerHandle;
  private raycaster = new THREE.Raycaster();
  private rect: DOMRect | null = null;
  private forgetRect = () => {
    this.rect = null;
  };
  private stopTheme = () => {};
  private pickTolerancePx = getSetting("viewport.pickTolerancePx");
  private stopPickTolerance = () => {};
  private stopGhostOpacity = () => {};
  private animating: null | {
    start: number;
    poseAt: (t: number) => CameraPose;
  } = null;
  private pendingZoom: { factor: number; x: number; y: number } | null = null;
  private pendingPan: [number, number] | null = null;
  private frames = frameScheduler((now) => {
    this.applyQueuedInput();
    this.stepAnimation(now);
    this.render();
    return this.animating !== null;
  });
  readonly requestRender = this.frames.requestRender;
  readonly onRender = this.frames.onRender;

  originPlanesVisible = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(themeColor("viewport-bg"));
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.requestRender,
    );
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
    const hemi = new THREE.HemisphereLight(
      themeColor("light-sky"),
      themeColor("light-ground"),
      0.9,
    );
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(themeColor("light-key"), 1.1);
    key.position.set(0.6, -0.9, 1.4);
    this.scene.add(key);

    this.scene.add(this.originRoot);
    this.planes = this.addLayer("constructionPlanes");
    this.scene.add(this.bodyRoot);
    this.scene.add(this.ghostRoot);
    this.sketches = this.addLayer("sketches");
    this.scene.add(this.overlayRoot);

    this.buildOriginDisplay();
    this.setTheme(activeTheme());
    this.stopTheme = subscribeTheme((tokens) => this.setTheme(tokens));
    this.stopPickTolerance = subscribe("viewport.pickTolerancePx", (px) => {
      this.pickTolerancePx = px;
    });
    this.stopGhostOpacity = subscribe(
      "appearance.previewGhostOpacity",
      (opacity) => {
        for (const mesh of this.ghosts.values())
          mesh.material.opacity = opacity;
        this.requestRender();
      },
    );
    this.resize();
    window.addEventListener("scroll", this.forgetRect, true);
  }

  dispose() {
    this.stopTheme();
    this.stopPickTolerance();
    this.stopGhostOpacity();
    this.frames.dispose();
    window.removeEventListener("scroll", this.forgetRect, true);
    this.layers.dispose();
    clearGroup(this.scene);
    this.bodies.clear();
    this.ghosts.clear();
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
    this.rect = null;
    const aspect = w / h;
    this.orthoCam.left = -this.zoom * aspect;
    this.orthoCam.right = this.zoom * aspect;
    this.orthoCam.top = this.zoom;
    this.orthoCam.bottom = -this.zoom;
    this.orthoCam.updateProjectionMatrix();
    this.perspCam.aspect = aspect;
    this.perspCam.updateProjectionMatrix();
    this.requestRender();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  snapshot(width: number, height: number): HTMLCanvasElement | null {
    const drawn =
      [...this.bodies.values()].some((b) => b.group.visible) ||
      this.sketches.group.children.length > 0;
    if (!drawn) return null;
    const frame = document.createElement("canvas");
    frame.width = width;
    frame.height = height;
    const context = frame.getContext("2d");
    if (!context) return null;
    this.render();
    const source = this.renderer.domElement;
    const scale = Math.max(width / source.width, height / source.height);
    const w = width / scale;
    const h = height / scale;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      source,
      (source.width - w) / 2,
      (source.height - h) / 2,
      w,
      h,
      0,
      0,
      width,
      height,
    );
    return frame;
  }

  setTheme(tokens: ThemeTokens): void {
    applyThemeToScene(this.scene, tokens, this.requestRender);
    this.renderer.setClearColor(tokens["viewport-bg"]);
  }

  /** World units per screen pixel at the target depth. */
  worldPerPixel(): number {
    const h = this.container.clientHeight || 1;
    if (this.projection === "orthographic") {
      return (this.zoom * 2) / h;
    }
    const dist = this.perspCam.position.distanceTo(this.target);
    return (2 * dist * halfHeightPerDistance(this.perspCam.fov)) / h;
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
    this.requestRender();
  }

  orbitTrackball(dx: number, dy: number, pivot = this.target) {
    const cam = this.camera;
    const view = orbitAbout(
      { position: cam.position, up: cam.up, target: this.target },
      pivot,
      dx,
      dy,
    );
    this.target.copy(view.target);
    for (const c of [this.orthoCam, this.perspCam]) {
      c.up.copy(view.up);
      c.position.copy(view.position);
      c.lookAt(this.target);
    }
    this.requestRender();
  }

  orbitTurntable(dx: number, dy: number, pivot = this.target) {
    const center = pivot.clone();
    const cam = this.camera;
    cam.updateMatrixWorld();
    const screen = center.clone().project(cam);
    const view = turntableAbout(
      { position: cam.position, up: cam.up, target: this.target },
      center,
      dx,
      dy,
    );
    this.target.copy(view.target);
    for (const c of [this.orthoCam, this.perspCam]) {
      c.up.copy(view.up);
      c.position.copy(view.position);
      c.lookAt(this.target);
    }
    cam.updateMatrixWorld();
    const depth = center.clone().project(cam).z;
    const shift = center
      .clone()
      .sub(new THREE.Vector3(screen.x, screen.y, depth).unproject(cam));
    this.target.add(shift);
    for (const c of [this.orthoCam, this.perspCam]) {
      c.position.add(shift);
      c.lookAt(this.target);
    }
    this.requestRender();
  }

  orbit(dx: number, dy: number, pivot = this.target) {
    if (getSetting("view.orbit") === "turntable")
      this.orbitTurntable(dx, dy, pivot);
    else this.orbitTrackball(dx, dy, pivot);
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
    this.requestRender();
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

  queueZoom(factor: number, clientX: number, clientY: number) {
    const factorSoFar = this.pendingZoom?.factor ?? 1;
    this.pendingZoom = { factor: factorSoFar * factor, x: clientX, y: clientY };
    this.requestRender();
  }

  queuePan(dx: number, dy: number) {
    const [x, y] = this.pendingPan ?? [0, 0];
    this.pendingPan = [x + dx, y + dy];
    this.requestRender();
  }

  private applyQueuedInput() {
    const zoom = this.pendingZoom;
    const pan = this.pendingPan;
    this.pendingZoom = null;
    this.pendingPan = null;
    if (pan) this.pan(pan[0], pan[1]);
    if (zoom) this.zoomBy(zoom.factor, zoom.x, zoom.y);
  }

  /** Project a screen point onto a plane (default: view plane through target). */
  screenToPlanePoint(
    clientX: number,
    clientY: number,
    frame: PlaneFrame | null,
  ): THREE.Vector3 | null {
    const ray = this.rayFromClient(clientX, clientY);
    let plane: THREE.Plane;
    if (frame) {
      const n = new THREE.Vector3(...frame.normal);
      plane = new THREE.Plane(n, -n.dot(new THREE.Vector3(...frame.origin)));
    } else {
      const n = this.camera
        .getWorldDirection(new THREE.Vector3())
        .multiplyScalar(-1);
      plane = new THREE.Plane(n, -n.dot(this.target));
    }
    const out = new THREE.Vector3();
    return ray.intersectPlane(plane, out) ? out : null;
  }

  canvasRect(): DOMRect {
    return (this.rect ??= this.renderer.domElement.getBoundingClientRect());
  }

  rayFromClient(clientX: number, clientY: number): THREE.Ray {
    const rect = this.canvasRect();
    return clientRay(this.raycaster, rect, this.camera, clientX, clientY);
  }

  setView(direction: Vec3, up: Vec3, animate = true) {
    const dist = Math.max(this.perspCam.position.distanceTo(this.target), 50);
    const toPos = this.target
      .clone()
      .add(new THREE.Vector3(...direction).normalize().multiplyScalar(dist));
    this.animateTo(
      toPos,
      new THREE.Vector3(...up),
      this.target.clone(),
      this.zoom,
      animate,
    );
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
    this.sketches.group.updateWorldMatrix(true, true);
    if (this.sketches.group.children.length > 0) {
      box.expandByObject(this.sketches.group);
      any = true;
    }
    if (!any)
      box.set(new THREE.Vector3(-60, -60, -30), new THREE.Vector3(60, 60, 30));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const newZoom = Math.max(size * 0.62, 10);
    const dir = this.camera.position.clone().sub(this.target).normalize();
    const toPos = center
      .clone()
      .add(dir.multiplyScalar(Math.max(size * 1.8, 100)));
    this.animateTo(toPos, this.camera.up.clone(), center, newZoom, animate);
  }

  animateTo(
    toPos: THREE.Vector3,
    toUp: THREE.Vector3,
    toTarget: THREE.Vector3,
    toZoom: number,
    animate = true,
  ) {
    const to = { position: toPos, up: toUp, target: toTarget, zoom: toZoom };
    if (!animate) {
      this.animating = null;
      this.applyPose(to);
      return;
    }
    this.animating = {
      start: performance.now(),
      poseAt: cameraTween(
        {
          position: this.camera.position.clone(),
          up: this.camera.up.clone(),
          target: this.target.clone(),
          zoom: this.zoom,
        },
        to,
      ),
    };
    this.requestRender();
  }

  private stepAnimation(now: number) {
    if (!this.animating) return;
    const t = (now - this.animating.start) / TIMING_MS.viewTurn;
    this.applyPose(this.animating.poseAt(t));
    if (t >= 1) this.animating = null;
  }

  private applyPose(pose: CameraPose) {
    this.target.copy(pose.target);
    this.zoom = pose.zoom;
    this.applyZoom();
    for (const c of [this.orthoCam, this.perspCam]) {
      c.up.copy(pose.up);
      c.position.copy(pose.position);
      c.lookAt(this.target);
    }
  }

  cameraState(): ViewCamera {
    return savedCamera(
      {
        position: this.camera.position,
        up: this.camera.up,
        target: this.target,
        zoom: this.zoom,
      },
      this.projection,
      this.perspCam.fov,
    );
  }

  setCamera(camera: ViewCamera) {
    const pose = restoredPose(camera, this.perspCam.fov);
    this.animateTo(pose.position, pose.up, pose.target, pose.zoom, false);
    this.setProjection(camera.projection);
  }

  setProjection(p: "orthographic" | "perspective") {
    this.projection = p;
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Origin display
  // -------------------------------------------------------------------------

  private originPlaneMeshes: THREE.Mesh[] = [];
  private originAxisLines = new Map<OriginAxis, THREE.Line>();

  private buildOriginDisplay() {
    const size = 30;
    for (const def of ORIGIN_PLANE_DEFS) {
      const geom = new THREE.PlaneGeometry(size, size);
      const mat = new THREE.MeshBasicMaterial({
        color: themeColor("origin-plane"),
        transparent: true,
        opacity: PLANE_APPEARANCE.originFillOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.applyMatrix4(frameBasis(def.frame));
      mesh.userData.originPlane = def.name;
      mesh.userData.themeToken = "origin-plane";
      mesh.renderOrder = -5;
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({
          color: themeColor("origin-plane-border"),
          transparent: true,
          opacity: PLANE_APPEARANCE.originBorderOpacity,
        }),
      );
      border.userData.themeToken = "origin-plane-border";
      mesh.add(border);
      this.originRoot.add(mesh);
      this.originPlaneMeshes.push(mesh);
    }
    const colors = ["axis-x", "axis-y", "axis-z"] as const;
    ORIGIN_AXES.forEach((axis, i) => {
      const dir = new THREE.Vector3().setComponent(i, 1);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          dir.clone().multiplyScalar(-18),
          dir.clone().multiplyScalar(18),
        ]),
        new THREE.LineBasicMaterial({
          color: themeColor(colors[i]!),
          transparent: true,
          opacity: PLANE_APPEARANCE.originAxisOpacity,
        }),
      );
      this.originRoot.add(line);
      line.material.userData.themeToken = colors[i]!;
      this.originAxisLines.set(axis, line);
    });
  }

  setOriginVisible(v: boolean) {
    this.originRoot.visible = v;
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Bodies
  // -------------------------------------------------------------------------

  syncBodies(payloads: BodyPayload[], hidden: ReadonlySet<string> = new Set()) {
    const seen = new Set<string>();
    for (const p of payloads) {
      seen.add(p.bodyId);
      const existing = this.bodies.get(p.bodyId);
      if (existing && existing.payload.meshKey === p.meshKey) {
        existing.payload = p;
        existing.group.visible = !hidden.has(p.bodyId);
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
      objs.group.visible = !hidden.has(p.bodyId);
    }
    for (const [id, objs] of Array.from(this.bodies)) {
      if (!seen.has(id)) {
        this.bodyRoot.remove(objs.group);
        disposeGroup(objs.group);
        this.bodies.delete(id);
      }
    }
    this.requestRender();
  }

  private buildBody(p: BodyPayload): BodyObjects {
    const group = new THREE.Group();
    group.userData.bodyId = p.bodyId;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(p.positions, 3),
    );
    geom.setAttribute("normal", new THREE.Float32BufferAttribute(p.normals, 3));
    geom.setIndex(p.indices);
    const mat = new THREE.MeshStandardMaterial({
      color: themeColor("body"),
      metalness: BODY_APPEARANCE.metalness,
      roughness: BODY_APPEARANCE.roughness,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    mat.userData.themeToken = "body";
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.bodyId = p.bodyId;
    group.add(mesh);

    // edges as segment soup with per-segment edge names
    const edgePts: number[] = [];
    const edgeSegments: string[] = [];
    for (const e of p.edges) {
      for (let i = 0; i + 5 < e.polyline.length; i += 3) {
        edgePts.push(
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
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePts, 3),
    );
    const edges = new THREE.LineSegments(
      edgeGeom,
      new THREE.LineBasicMaterial({ color: themeColor("edge") }),
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
    vertGeom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertPts, 3),
    );
    const vertices = new THREE.Points(
      vertGeom,
      new THREE.PointsMaterial({
        color: themeColor("edge"),
        size: BODY_APPEARANCE.vertexSizePx,
        sizeAttenuation: false,
      }),
    );
    vertices.visible = false; // shown during vertex-relevant modes
    vertices.userData.bodyId = p.bodyId;
    group.add(vertices);

    return {
      group,
      mesh,
      material: mat,
      tint: null,
      edges,
      edgeSegments,
      vertices,
      vertexNames,
      payload: p,
    };
  }

  setBodyTints(tints: ReadonlyMap<string, PreviewTint>) {
    for (const [id, b] of this.bodies) {
      const tint = tints.get(id);
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
    this.requestRender();
  }

  setPreviewGhosts(ghosts: readonly PreviewGhost[]) {
    const keys = new Set(ghosts.map((g) => g.body.meshKey));
    for (const [key, mesh] of this.ghosts) {
      if (keys.has(key)) continue;
      this.ghostRoot.remove(mesh);
      disposeObject(mesh);
      this.ghosts.delete(key);
    }
    for (const { body, tint, ranges } of ghosts) {
      const mesh = this.ghosts.get(body.meshKey) ?? this.addGhost(body);
      mesh.geometry.setIndex(
        ranges.flatMap(({ start, count }) =>
          body.indices.slice(start, start + count),
        ),
      );
      mesh.material.color.set(themeColor(tint));
      mesh.material.userData.themeToken = tint;
      mesh.userData.ghostOf = body.bodyId;
    }
    this.requestRender();
  }

  private addGhost(body: BodyPayload) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(body.positions, 3),
    );
    geom.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(body.normals, 3),
    );
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({
        metalness: BODY_APPEARANCE.metalness,
        roughness: BODY_APPEARANCE.roughness,
        transparent: true,
        opacity: getSetting("appearance.previewGhostOpacity"),
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 3;
    this.ghostRoot.add(mesh);
    this.ghosts.set(body.meshKey, mesh);
    return mesh;
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
      bodies?: boolean | undefined;
      faces?: boolean | undefined;
      edges?: boolean | undefined;
      vertices?: boolean | undefined;
      originPlanes?: boolean | undefined;
      originAxes?: boolean | undefined;
      constructionPlanes?: boolean | undefined;
      profiles?: boolean | undefined;
      sketchEntities?: boolean | undefined;
      sketchPoints?: boolean | undefined;
      depth?: number; // alt-click cycling
    },
  ): PickResult | null {
    this.rayFromClient(clientX, clientY);
    const { line: pxTol, point } = pickThresholds(
      this.worldPerPixel(),
      this.pickTolerancePx,
    );
    this.raycaster.params.Line = { threshold: pxTol };
    this.raycaster.params.Points = { threshold: point };

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
          const vertexName = b.vertexNames[h.index];
          if (vertexName === undefined) continue;
          results.push({
            selection: {
              kind: "vertex",
              bodyId: b.payload.bodyId,
              vertexName,
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
            selection: {
              kind: "edge",
              bodyId: b.payload.bodyId,
              edgeName: name,
            },
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
            (f) => indexPos >= f.start && indexPos < f.start + f.count,
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

    if (opts.originAxes && this.originRoot.visible) {
      for (const [axis, line] of this.originAxisLines) {
        for (const h of this.raycaster.intersectObject(line, false)) {
          results.push({
            selection: { kind: "axis", axis },
            distance: h.distance - pxTol * 1.2,
            point: h.point,
          });
        }
      }
    }

    if (opts.constructionPlanes || opts.profiles || opts.sketchEntities) {
      const targets: THREE.Object3D[] = [];
      if (opts.constructionPlanes) targets.push(this.planes.group);
      if (opts.profiles || opts.sketchEntities)
        targets.push(this.sketches.group);
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
        } else if (
          opts.sketchEntities &&
          ud.sketchEntityId &&
          (opts.sketchPoints !== false || !ud.isPoint)
        ) {
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
    if (!chosen) return null;
    // Coplanar regions can overlap (a disc drawn over a quadrant); the
    // smallest one under the cursor is the one the user means.
    if (chosen.selection.kind === "profile") {
      const tied = results.filter(
        (r) =>
          r.selection.kind === "profile" &&
          Math.abs(r.distance - chosen.distance) < pxTol * 0.1,
      );
      if (tied.length > 1) {
        tied.sort((a, b) => (a.area ?? Infinity) - (b.area ?? Infinity));
        return tied[0]!;
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
    this.requestRender();
  }

  addHighlights(sels: Selection[], kind: "select" | "hover") {
    this.requestRender();
    const faces = new Map<string, Set<string>>();
    for (const s of sels) {
      if (s.kind !== "face") this.addHighlight(s, kind);
      else
        faces.set(s.bodyId, (faces.get(s.bodyId) ?? new Set()).add(s.faceName));
    }
    for (const [bodyId, names] of faces)
      this.addFaceHighlight(bodyId, names, kind);
  }

  private addFaceHighlight(
    bodyId: string,
    names: ReadonlySet<string> | null,
    kind: "select" | "hover",
  ) {
    const body = this.bodies.get(bodyId);
    if (!body) return;
    const src = body.payload;
    const index = names
      ? src.faces
          .filter((f) => names.has(f.name))
          .flatMap((f) => src.indices.slice(f.start, f.start + f.count))
      : src.indices;
    if (index.length === 0) return;
    const token = kind === "select" ? "selection" : "hover";
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", body.mesh.geometry.getAttribute("position"));
    geom.setAttribute("normal", body.mesh.geometry.getAttribute("normal"));
    geom.setIndex(index);
    geom.addEventListener("dispose", () => {
      geom.deleteAttribute("position");
      geom.deleteAttribute("normal");
    });
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshBasicMaterial({
        color: themeColor(token),
        transparent: true,
        opacity: HIGHLIGHT_APPEARANCE.faceOpacity[kind],
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    mesh.renderOrder = 5;
    mesh.userData.themeToken = token;
    this.overlayRoot.add(mesh);
    this.highlightObjects.push(mesh);
  }

  addHighlight(sel: Selection, kind: "select" | "hover") {
    this.requestRender();
    const token = kind === "select" ? "selection" : "hover";
    const color = themeColor(token);
    if (sel.kind === "face" || sel.kind === "body") {
      this.addFaceHighlight(
        sel.bodyId,
        sel.kind === "face" ? new Set([sel.faceName]) : null,
        kind,
      );
    } else if (sel.kind === "edge" || sel.kind === "axis") {
      const points =
        sel.kind === "axis"
          ? this.originAxisLines
              .get(sel.axis)
              ?.geometry.getAttribute("position").array
          : this.bodies
              .get(sel.bodyId)
              ?.payload.edges.find((x) => x.name === sel.edgeName)?.polyline;
      if (!points) return;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(points, 3),
        ),
        new THREE.LineBasicMaterial({
          color,
          linewidth: HIGHLIGHT_APPEARANCE.edgeLinewidth,
          depthTest: false,
        }),
      );
      line.renderOrder = 10;
      line.userData.themeToken = token;
      this.overlayRoot.add(line);
      this.highlightObjects.push(line);
    } else if (sel.kind === "vertex") {
      const b = this.bodies.get(sel.bodyId);
      if (!b) return;
      const v = b.payload.vertices[b.vertexNames.indexOf(sel.vertexName)];
      if (!v) return;
      const pt = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...v.position),
        ]),
        new THREE.PointsMaterial({
          color,
          size: HIGHLIGHT_APPEARANCE.vertexSizePx,
          sizeAttenuation: false,
          depthTest: false,
        }),
      );
      pt.renderOrder = 11;
      pt.userData.themeToken = token;
      this.overlayRoot.add(pt);
      this.highlightObjects.push(pt);
    } else if (sel.kind === "plane" && sel.ref.kind !== "face") {
      const ref = sel.ref;
      const mesh =
        ref.kind === "origin"
          ? this.originPlaneMeshes.find(
              (m) => m.userData.originPlane === ref.plane,
            )
          : (this.planes.group.children.find(
              (m) => m.userData.constructionPlane === ref.featureId,
            ) as THREE.Mesh | undefined);
      if (mesh) {
        mesh.updateWorldMatrix(true, false);
        const clone = new THREE.Mesh(
          (mesh.geometry as THREE.BufferGeometry).clone(),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: HIGHLIGHT_APPEARANCE.originPlaneOpacity,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        clone.applyMatrix4(mesh.matrixWorld);
        clone.userData.themeToken = token;
        this.overlayRoot.add(clone);
        this.highlightObjects.push(clone);
      }
    }
    // profile/sketch entity highlights handled by the sketch renderer
  }

  syncConstructionPlanes(
    planes: ConstructionPlanePayload[],
    featureNames: Map<string, string>,
    visibleIds: Set<string>,
  ) {
    this.planes.clear();
    for (const p of planes) {
      if (p.size <= 0) continue; // reference image frames
      if (!visibleIds.has(p.featureId)) continue;
      const geom = new THREE.PlaneGeometry(p.size * 2, p.size * 2);
      const mat = new THREE.MeshBasicMaterial({
        color: themeColor("plane"),
        transparent: true,
        opacity: PLANE_APPEARANCE.constructionFillOpacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.applyMatrix4(frameBasis(p.frame));
      mesh.userData.constructionPlane = p.featureId;
      mesh.userData.label = featureNames.get(p.featureId) ?? "Plane";
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({
          color: themeColor("plane"),
          transparent: true,
          opacity: PLANE_APPEARANCE.constructionBorderOpacity,
        }),
      );
      mesh.add(border);
      this.planes.group.add(mesh);
    }
    this.requestRender();
  }
}
