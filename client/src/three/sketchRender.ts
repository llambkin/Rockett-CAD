/**
 * Renders sketches (entities, points, profile regions) into the viewport's
 * sketch root. Rebuilt whenever sketch data or selection changes.
 */

import * as THREE from "three";
import type { PlaneFrame, Profile, SketchEntity } from "@rockett/shared";
import { detectProfiles, sampleArc } from "@rockett/shared";
import { COLORS, CadViewport, uv3 } from "./CadViewport";
import { clearGroup } from "./dispose";
import type { Selection } from "../store";
import { selectionKey } from "../store";

export interface SketchRenderInput {
  sketchId: string;
  frame: PlaneFrame;
  entities: SketchEntity[];
  /** show clickable profile fills */
  showProfiles: boolean;
  /** stronger colors for the actively edited sketch */
  active: boolean;
  /** regions to shade/pick */
  profiles?: Profile[];
  /** regions a feature already uses: shaded faintly, still pickable */
  usedProfileIds?: Set<string>;
  /** dimmer curves: the sketch has already been used by a feature */
  dim?: boolean;
  /** false: curves render but can't be picked (used sketches in idle) */
  curvesPickable?: boolean;
}

export function renderSketches(
  viewport: CadViewport,
  sketches: SketchRenderInput[],
  selection: Selection[],
  hover: Selection | null,
): void {
  const root = viewport.getSketchRoot();
  clearGroup(root);
  const selKeys = new Set(selection.map(selectionKey));
  const hoverKey = hover ? selectionKey(hover) : null;

  for (const sk of sketches) {
    const group = new THREE.Group();
    root.add(group);
    const pts = new Map<string, { x: number; y: number; e: SketchEntity }>();
    for (const e of sk.entities) {
      if (e.kind === "point") pts.set(e.id, { x: e.x, y: e.y, e });
    }

    const to3 = (u: number, v: number) => uv3(sk.frame, u, v);

    // --- profiles (fills) first so they render under curves ---
    if (sk.showProfiles) {
      const profiles = sk.profiles ?? detectProfiles(sk.entities);
      for (const p of profiles) {
        const shape = new THREE.Shape();
        for (let i = 0; i < p.polygon.length; i += 2) {
          if (i === 0) shape.moveTo(p.polygon[0], p.polygon[1]);
          else shape.lineTo(p.polygon[i], p.polygon[i + 1]);
        }
        for (const hp of p.holePolygons) {
          const hole = new THREE.Path();
          for (let i = 0; i < hp.length; i += 2) {
            if (i === 0) hole.moveTo(hp[0], hp[1]);
            else hole.lineTo(hp[i], hp[i + 1]);
          }
          shape.holes.push(hole);
        }
        const geom = new THREE.ShapeGeometry(shape);
        const key = `profile:${sk.sketchId}:${p.id}`;
        const isSel = selKeys.has(key);
        const isHover = hoverKey === key;
        const used = sk.usedProfileIds?.has(p.id) ?? false;
        const mesh = new THREE.Mesh(
          geom,
          new THREE.MeshBasicMaterial({
            color: isSel
              ? COLORS.selected
              : isHover
                ? COLORS.hover
                : COLORS.profileFill,
            transparent: true,
            opacity: isSel ? 0.55 : isHover ? 0.4 : used ? 0.06 : 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
          }),
        );
        mesh.applyMatrix4(frameMatrix(sk.frame));
        mesh.userData.profileId = p.id;
        mesh.userData.sketchId = sk.sketchId;
        mesh.userData.area = p.area;
        mesh.renderOrder = 2;
        group.add(mesh);
      }
    }

    // --- curves ---
    for (const e of sk.entities) {
      if (e.kind === "point") continue;
      let positions: THREE.Vector3[] = [];
      if (e.kind === "line") {
        const a = pts.get(e.p1);
        const b = pts.get(e.p2);
        if (!a || !b) continue;
        positions = [to3(a.x, a.y), to3(b.x, b.y)];
      } else if (e.kind === "circle") {
        const c = pts.get(e.center);
        if (!c) continue;
        for (let i = 0; i <= 64; i++) {
          const t = (i / 64) * Math.PI * 2;
          positions.push(
            to3(c.x + e.radius * Math.cos(t), c.y + e.radius * Math.sin(t)),
          );
        }
      } else if (e.kind === "arc") {
        const c = pts.get(e.center);
        const s = pts.get(e.start);
        const en = pts.get(e.end);
        if (!c || !s || !en) continue;
        const samples = sampleArc(c.x, c.y, s.x, s.y, en.x, en.y, 32);
        for (let i = 0; i < samples.length; i += 2) {
          positions.push(to3(samples[i], samples[i + 1]));
        }
      }
      if (positions.length < 2) continue;
      const key = `se:${sk.sketchId}:${e.id}`;
      const isSel = selKeys.has(key);
      const isHover = hoverKey === key;
      const color = isSel
        ? COLORS.selected
        : isHover
          ? COLORS.hover
          : e.external
            ? 0xbb88ff
            : e.construction
              ? COLORS.sketchConstruction
              : sk.active
                ? COLORS.sketchLine
                : sk.dim
                  ? 0x566478
                  : 0x7a92a8;
      const pickable = sk.curvesPickable !== false;
      const geom = new THREE.BufferGeometry().setFromPoints(positions);
      const line = new THREE.Line(
        geom,
        e.construction
          ? new THREE.LineDashedMaterial({
              color,
              dashSize: 2,
              gapSize: 1.5,
              depthTest: false,
            })
          : new THREE.LineBasicMaterial({
              color,
              transparent: !sk.active,
              opacity: sk.active ? 1 : sk.dim ? 0.5 : 0.8,
              depthTest: false,
            }),
      );
      if (e.construction) line.computeLineDistances();
      if (pickable) {
        line.userData.sketchEntityId = e.id;
        line.userData.sketchId = sk.sketchId;
      }
      line.renderOrder = 6;
      group.add(line);
    }

    // --- points (active sketch only) ---
    if (sk.active) {
      for (const e of sk.entities) {
        if (e.kind !== "point") continue;
        const key = `sp:${sk.sketchId}:${e.id}`;
        const isSel = selKeys.has(key);
        const isHover = hoverKey === key;
        const geom = new THREE.BufferGeometry().setFromPoints([to3(e.x, e.y)]);
        const pt = new THREE.Points(
          geom,
          new THREE.PointsMaterial({
            color: isSel
              ? COLORS.selected
              : isHover
                ? COLORS.hover
                : COLORS.sketchPoint,
            size: isSel || isHover ? 9 : 6,
            sizeAttenuation: false,
            depthTest: false,
          }),
        );
        pt.userData.sketchEntityId = e.id;
        pt.userData.sketchId = sk.sketchId;
        pt.userData.isPoint = true;
        pt.renderOrder = 8;
        group.add(pt);
      }
    }
  }
}

function frameMatrix(frame: PlaneFrame): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.makeBasis(
    new THREE.Vector3(...frame.xAxis),
    new THREE.Vector3(...frame.yAxis),
    new THREE.Vector3(...frame.normal),
  );
  m.setPosition(new THREE.Vector3(...frame.origin));
  return m;
}
