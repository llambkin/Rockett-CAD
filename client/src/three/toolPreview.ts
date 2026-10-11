/**
 * Rubber-band previews for sketch tools: ghost geometry drawn between the
 * committed clicks and the current cursor position.
 */

import * as THREE from "three";
import { curveSamples, ellipseAxes, type PlaneFrame } from "@rockett/shared";
import { CadViewport, uv3 } from "./CadViewport";
import { themeColor } from "../theme/tokens";
import { SKETCH_APPEARANCE } from "../tunables";
import type { LayerHandle } from "./sceneLayers";
import type { SketchTool } from "../store";
import {
  ellipseMinor,
  polygonVertices,
  type PolygonOptions,
  type UV,
} from "../sketchTools";
import { conicRho } from "../sketchClicks";
import { splinePreview } from "../splineTools";

const layers = new WeakMap<CadViewport, LayerHandle>();

function ensureGroup(viewport: CadViewport): THREE.Group {
  viewport.requestRender();
  let layer = layers.get(viewport);
  if (!layer) {
    layer = viewport.addLayer("toolPreview");
    layer.group.renderOrder = 9;
    layers.set(viewport, layer);
  }
  return layer.group;
}

export function clearToolPreview(viewport: CadViewport | null): void {
  if (!viewport) return;
  const layer = layers.get(viewport);
  if (!layer) return;
  layer.clear();
  viewport.requestRender();
}

function ghostLine(pts: THREE.Vector3[]): THREE.Line {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({
      color: themeColor("hover"),
      transparent: true,
      opacity: SKETCH_APPEARANCE.previewLineOpacity,
      depthTest: false,
    }),
  );
  line.userData.themeToken = "hover";
  return line;
}

const trace = (frame: PlaneFrame, flat: number[]) =>
  flat.flatMap((u, i) => (i % 2 ? [] : [uv3(frame, u, flat[i + 1]!)]));

const circlePts = (frame: PlaneFrame, cx: number, cy: number, r: number) =>
  trace(frame, curveSamples({ id: "", kind: "circle", cx, cy, r }, 48));

function ellipseRim(c: UV, m: UV, cursor: UV): number[] {
  const n = ellipseMinor(c, m, cursor);
  if (!n) return [c.x, c.y, m.x, m.y];
  return curveSamples({ id: "", kind: "ellipse", ...ellipseAxes(c, m, n) }, 48);
}

function arcRim(s: UV, e: UV, b: UV): number[] {
  const d = 2 * (s.x * (b.y - e.y) + b.x * (e.y - s.y) + e.x * (s.y - b.y));
  if (Math.abs(d) < 1e-9) return [s.x, s.y, e.x, e.y];
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
  if (am > a1) [a0, a1] = [a1 - Math.PI * 2, a0];
  return Array.from(
    { length: 33 },
    (_, i) => a0 + ((a1 - a0) * i) / 32,
  ).flatMap((t) => [ux + r * Math.cos(t), uy + r * Math.sin(t)]);
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
  polygon: PolygonOptions = { sides: 6, type: "inscribed", angle: null },
): boolean {
  clearToolPreview(viewport);
  const g = ensureGroup(viewport);
  const P = (u: number, v: number) => uv3(frame, u, v);

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
      if (r > 1e-6) g.add(ghostLine(circlePts(frame, c.x, c.y, r)));
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
        g.add(ghostLine(trace(frame, arcRim(clicks[0]!, clicks[1]!, cursor))));
        return true;
      }
      return false;
    }
    case "ellipse": {
      const [c, m] = clicks;
      if (!c) return false;
      const rim = m ? ellipseRim(c, m, cursor) : [c.x, c.y, cursor.x, cursor.y];
      g.add(ghostLine(trace(frame, rim)));
      return true;
    }
    case "polygon": {
      if (clicks.length < 1) return false;
      const pts = polygonVertices(clicks[0]!, cursor, polygon).map((v) =>
        P(v.x, v.y),
      );
      g.add(ghostLine([...pts, pts[0]!]));
      return true;
    }
    case "fitSpline":
    case "controlSpline":
    case "conic": {
      if (!clicks.length) return false;
      const rim = splinePreview(tool, clicks, cursor, conicRho());
      g.add(ghostLine(trace(frame, rim)));
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
        g.add(ghostLine(circlePts(frame, c1.x, c1.y, r)));
        g.add(ghostLine(circlePts(frame, c2.x, c2.y, r)));
        return true;
      }
      return false;
    }
    default:
      return false;
  }
}
