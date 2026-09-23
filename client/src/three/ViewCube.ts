/**
 * ViewCube: draggable navigation cube in the viewport corner.
 * Clicking faces/edges/corners animates the camera; dragging orbits freely.
 */

import * as THREE from "three";
import type { CadViewport } from "./CadViewport";
import { ISO_VIEW } from "./camera";
import { themeColor } from "../theme/tokens";

/**
 * Face label texture. `rotation` counters BoxGeometry's per-face UV
 * orientation so every label reads upright in its face's standard view
 * (Z-up world: side-face UVs put texture-"up" along ±Y, not +Z).
 */
function faceTexture(label: string, rotation: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = themeColor("viewcube-face");
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = themeColor("viewcube-border");
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 124);
  ctx.fillStyle = themeColor("viewcube-label");
  ctx.font = "bold 24px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(64, 64);
  ctx.rotate(rotation);
  ctx.fillText(label, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ViewCube {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private cube: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private frame = 0;
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    container: HTMLElement,
    private viewport: CadViewport,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(
      -1.15,
      1.15,
      1.15,
      -1.15,
      0.1,
      10,
    );
    this.camera.position.set(0, 0, 4);

    // Cube faces: three.js BoxGeometry material order is +x,-x,+y,-y,+z,-z.
    // Rotations make each label upright in that face's standard view.
    const mats: [string, number][] = [
      ["RIGHT", -Math.PI / 2],
      ["LEFT", Math.PI / 2],
      ["BACK", Math.PI],
      ["FRONT", 0],
      ["TOP", 0],
      ["BOTTOM", Math.PI],
    ];
    const materials = mats.map(
      ([l, rot]) => new THREE.MeshBasicMaterial({ map: faceTexture(l, rot) }),
    );
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), materials);
    this.scene.add(this.cube);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.cube.geometry as THREE.BoxGeometry),
      new THREE.LineBasicMaterial({ color: themeColor("viewcube-edge") }),
    );
    this.cube.add(edges);

    const el = this.renderer.domElement;
    el.style.cursor = "pointer";
    // Drag = orbit, click = snap view. The cursor is hidden for the whole
    // press via CSS on the captured element (pointer capture keeps delivering
    // moves — and the hidden cursor — wherever the mouse goes). No pointer
    // lock: engaging it stalls and drops mouse events for a moment, which
    // made the cube feel like it needed a big shove before it followed.
    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // capture already gone
      }
      el.style.cursor = "pointer";
    };
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.moved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.style.cursor = "none";
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // no active pointer to capture (synthetic events) — drag still works
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      // the first pixel of travel already orbits; only a perfectly still
      // press-release counts as a click
      if (!this.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 1) return;
        this.moved = true;
      }
      // trackball grab: the cube (and model) follows the cursor from any view
      this.viewport.orbitTrackball(dx, dy);
    });
    el.addEventListener("pointerup", (e) => {
      const wasDrag = this.moved;
      endDrag(e);
      if (!wasDrag) this.click(e);
    });
    el.addEventListener("pointercancel", endDrag);

    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      // cube shows the world orientation as seen by the camera
      const q = new THREE.Quaternion();
      this.viewport.camera.getWorldQuaternion(q);
      this.cube.quaternion.copy(q).invert();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private click(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.cube, false);
    const hit = hits[0];
    if (!hit) return;
    // local hit point → snap direction (face / edge / corner)
    const local = this.cube.worldToLocal(hit.point.clone());
    const half = 0.7;
    const t = 0.42; // threshold for edge/corner detection
    const sx = Math.abs(local.x) / half > t ? Math.sign(local.x) : 0;
    const sy = Math.abs(local.y) / half > t ? Math.sign(local.y) : 0;
    const sz = Math.abs(local.z) / half > t ? Math.sign(local.z) : 0;
    let dir = new THREE.Vector3(sx, sy, sz);
    if (dir.lengthSq() === 0) {
      dir = hit.face?.normal.clone() ?? new THREE.Vector3(0, 0, 1);
    }
    dir.normalize();
    const up =
      Math.abs(dir.z) > 0.95
        ? new THREE.Vector3(0, dir.z > 0 ? 1 : -1, 0)
        : new THREE.Vector3(0, 0, 1);
    this.viewport.setView([dir.x, dir.y, dir.z], [up.x, up.y, up.z]);
  }

  goHome() {
    this.viewport.setView(ISO_VIEW.dir, ISO_VIEW.up);
  }
}
