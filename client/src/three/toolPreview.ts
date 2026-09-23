/**
 * Rubber-band previews for sketch tools: ghost geometry drawn between the
 * committed clicks and the current cursor position.
 */

import * as THREE from "three";
import type { PlaneFrame } from "@rockett/shared";
import { CadViewport, uv3 } from "./CadViewport";
import { themeColor } from "../theme/tokens";
import { clearGroup } from "./dispose";
import type { SketchTool } from "../store";
import type { UV } from "../sketchTools";

let group: THREE.Group | null = null;

function ensureGroup(viewport: CadViewport): THREE.Group {
  viewport.requestRender();
  if (!group || group.parent !== viewport.scene) {
    group = new THREE.Group();
    group.renderOrder = 9;
    viewport.scene.add(group);
  }
  return group;
}

export function clearToolPreview(viewport: CadViewport | null): void {
  if (!viewport || !group) return;
  clearGroup(group);
  viewport.requestRender();
}

function ghostLine(pts: THREE.Vector3[]): THREE.Line {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({
      color: themeColor("hover"),
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
}

/**
 * Draw the ghost for the active tool given committed clicks + cursor.
 * Returns true if a preview was drawn.
 */
export function updateToolPreview(
  viewport: CadViewport,
  frame: PlaneFrame,
  tool: SketchTool,
  clicks: UV[],
  cursor: UV,
  polygonSides = 6,
): boolean {
  clearToolPreview(viewport);
  const g = ensureGroup(viewport);
  const P = (u: number, v: number) => uv3(frame, u, v);

  const circlePts = (cx: number, cy: number, r: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      pts.push(P(cx + r * Math.cos(t), cy + r * Math.sin(t)));
    }
    return pts;
  };

  switch (tool) {
    case "line": {
      if (clicks.length < 1) return false;
      g.add(ghostLine([P(clicks[0]!.x, clicks[0]!.y), P(cursor.x, cursor.y)]));
      return true;
    }
    case "rect": {
      if (clicks.length < 1) return false;
      const a = clicks[0]!;
      g.add(
        ghostLine([
          P(a.x, a.y),
          P(cursor.x, a.y),
          P(cursor.x, cursor.y),
          P(a.x, cursor.y),
          P(a.x, a.y),
        ]),
      );
      return true;
    }
    case "centerRect": {
      if (clicks.length < 1) return false;
      const c = clicks[0]!;
      const w = Math.abs(cursor.x - c.x);
      const h = Math.abs(cursor.y - c.y);
      g.add(
        ghostLine([
          P(c.x - w, c.y - h),
          P(c.x + w, c.y - h),
          P(c.x + w, c.y + h),
          P(c.x - w, c.y + h),
          P(c.x - w, c.y - h),
        ]),
      );
      return true;
    }
    case "circle": {
      if (clicks.length < 1) return false;
      const c = clicks[0]!;
      const r = Math.hypot(cursor.x - c.x, cursor.y - c.y);
      if (r > 1e-6) g.add(ghostLine(circlePts(c.x, c.y, r)));
      return true;
    }
    case "arc3": {
      if (clicks.length === 1) {
        g.add(
          ghostLine([P(clicks[0]!.x, clicks[0]!.y), P(cursor.x, cursor.y)]),
        );
        return true;
      }
      if (clicks.length === 2) {
        // arc through start, cursor, end (circumcircle sample)
        const s = clicks[0]!;
        const e = clicks[1]!;
        const b = cursor;
        const d =
          2 * (s.x * (b.y - e.y) + b.x * (e.y - s.y) + e.x * (s.y - b.y));
        if (Math.abs(d) < 1e-9) {
          g.add(ghostLine([P(s.x, s.y), P(e.x, e.y)]));
          return true;
        }
        const s2 = s.x * s.x + s.y * s.y;
        const b2 = b.x * b.x + b.y * b.y;
        const e2 = e.x * e.x + e.y * e.y;
        const ux = (s2 * (b.y - e.y) + b2 * (e.y - s.y) + e2 * (s.y - b.y)) / d;
        const uy = (s2 * (e.x - b.x) + b2 * (s.x - e.x) + e2 * (b.x - s.x)) / d;
        const r = Math.hypot(s.x - ux, s.y - uy);
        let a0 = Math.atan2(s.y - uy, s.x - ux);
        let a1 = Math.atan2(e.y - uy, e.x - ux);
        let am = Math.atan2(b.y - uy, b.x - ux);
        while (a1 <= a0) a1 += Math.PI * 2;
        while (am <= a0) am += Math.PI * 2;
        if (am > a1) {
          // go the other way round
          [a0, a1] = [a1 - Math.PI * 2, a0];
        }
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
          const t = a0 + ((a1 - a0) * i) / 32;
          pts.push(P(ux + r * Math.cos(t), uy + r * Math.sin(t)));
        }
        g.add(ghostLine(pts));
        return true;
      }
      return false;
    }
    case "polygon": {
      if (clicks.length < 1) return false;
      const c = clicks[0]!;
      const r = Math.hypot(cursor.x - c.x, cursor.y - c.y);
      const a0 = Math.atan2(cursor.y - c.y, cursor.x - c.x);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= polygonSides; i++) {
        const t = a0 + (i / polygonSides) * Math.PI * 2;
        pts.push(P(c.x + r * Math.cos(t), c.y + r * Math.sin(t)));
      }
      g.add(ghostLine(pts));
      return true;
    }
    case "slot": {
      if (clicks.length === 1) {
        g.add(
          ghostLine([P(clicks[0]!.x, clicks[0]!.y), P(cursor.x, cursor.y)]),
        );
        return true;
      }
      if (clicks.length === 2) {
        const c1 = clicks[0]!;
        const c2 = clicks[1]!;
        const r = Math.max(Math.hypot(cursor.x - c2.x, cursor.y - c2.y), 0.01);
        const dx = c2.x - c1.x,
          dy = c2.y - c1.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len,
          ny = dx / len;
        g.add(
          ghostLine([
            P(c1.x + nx * r, c1.y + ny * r),
            P(c2.x + nx * r, c2.y + ny * r),
          ]),
        );
        g.add(
          ghostLine([
            P(c1.x - nx * r, c1.y - ny * r),
            P(c2.x - nx * r, c2.y - ny * r),
          ]),
        );
        g.add(ghostLine(circlePts(c1.x, c1.y, r)));
        g.add(ghostLine(circlePts(c2.x, c2.y, r)));
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}
