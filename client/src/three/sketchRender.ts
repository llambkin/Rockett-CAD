import * as THREE from "three";
import type { PlaneFrame, Profile, SketchEntity } from "@rockett/shared";
import { curveSamples, detectProfiles, sketchCurves } from "@rockett/shared";
import { CadViewport, uv3 } from "./CadViewport";
import { disposeGroup } from "./dispose";
import type { Selection } from "../store";
import { selectionKey } from "../store";
import { SketchGroup } from "./sketchStyle";

const CURVE_SEGMENTS = 64;

export interface SketchRenderInput {
  sketchId: string;
  frame: PlaneFrame;
  entities: SketchEntity[];
  showProfiles: boolean;
  active: boolean;
  profiles?: Profile[];
  usedProfileIds?: Set<string>;
  dim?: boolean;
  curvesPickable?: boolean;
  lit?: boolean;
}

export function renderSketches(
  viewport: CadViewport,
  sketches: SketchRenderInput[],
  selection: Selection[],
  hover: Selection | null,
): void {
  const root = viewport.sketches.group;
  const stale = [...root.children];
  const spare = new Map(stale.map((g) => [g.userData.renderKey, g]));
  root.clear();
  for (const sk of sketches) {
    const key = renderKey(sk);
    const kept = spare.get(key);
    spare.delete(key);
    root.add(kept ?? buildSketch(sk, key));
  }
  const shown = new Set(root.children);
  for (const g of stale) if (!shown.has(g)) disposeGroup(g);
  styleSketches(viewport, selection, hover);
}

export function styleSketches(
  viewport: CadViewport,
  selection: Selection[],
  hover: Selection | null,
): void {
  const selected = new Set(selection.map(selectionKey));
  const hoverKey = hover ? selectionKey(hover) : null;
  const piece = (hover?.kind === "sketchEntity" && hover.piece) || null;
  for (const g of viewport.sketches.group.children)
    if (g instanceof SketchGroup) g.restyle(selected, hoverKey, piece);
  viewport.requestRender();
}

function renderKey(sk: SketchRenderInput): string {
  return JSON.stringify([
    sk.sketchId,
    sk.frame,
    sk.entities,
    sk.showProfiles,
    sk.active,
    sk.profiles ?? null,
    [...(sk.usedProfileIds ?? [])],
    sk.dim ?? false,
    sk.curvesPickable ?? true,
    sk.lit ?? false,
  ]);
}

function profileGeometry(p: Profile): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i + 1 < p.polygon.length; i += 2) {
    if (i === 0) shape.moveTo(p.polygon[0]!, p.polygon[1]!);
    else shape.lineTo(p.polygon[i]!, p.polygon[i + 1]!);
  }
  for (const hp of p.holePolygons) {
    const hole = new THREE.Path();
    for (let i = 0; i + 1 < hp.length; i += 2) {
      if (i === 0) hole.moveTo(hp[0]!, hp[1]!);
      else hole.lineTo(hp[i]!, hp[i + 1]!);
    }
    shape.holes.push(hole);
  }
  return new THREE.ShapeGeometry(shape);
}

function addProfiles(group: SketchGroup, sk: SketchRenderInput) {
  const matrix = frameMatrix(sk.frame);
  for (const p of sk.profiles ?? detectProfiles(sk.entities)) {
    const used = sk.usedProfileIds?.has(p.id) ?? false;
    const key = `profile:${sk.sketchId}:${p.id}`;
    const mesh = group.place(
      key,
      { kind: "fill", used },
      (m) => new THREE.Mesh(profileGeometry(p), m),
    );
    mesh.applyMatrix4(matrix);
    mesh.userData.profileId = p.id;
    mesh.userData.sketchId = sk.sketchId;
    mesh.userData.area = p.area;
    mesh.renderOrder = 2;
  }
}

function curveToken(e: SketchEntity, sk: SketchRenderInput) {
  if (e.external) return "sketch-external";
  if (e.construction) return "sketch-construction";
  if (sk.active) return "sketch-line";
  return sk.dim ? "sketch-dimmed" : "sketch-inactive";
}

function addCurves(group: SketchGroup, sk: SketchRenderInput) {
  const byId = new Map(sk.entities.map((e) => [e.id, e]));
  const pickable = sk.curvesPickable !== false;
  for (const curve of sketchCurves(sk.entities, true)) {
    const e = byId.get(curve.id)!;
    const samples = curveSamples(curve, CURVE_SEGMENTS);
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < samples.length; i += 2)
      positions.push(uv3(sk.frame, samples[i]!, samples[i + 1]!));
    if (positions.length < 2) continue;
    const look = {
      kind: "curve",
      base: curveToken(e, sk),
      dashed: !!e.construction,
      active: sk.active,
      dim: !!sk.dim,
    } as const;
    const geom = new THREE.BufferGeometry().setFromPoints(positions);
    const line = group.place(
      `se:${sk.sketchId}:${e.id}`,
      look,
      (m) => new THREE.Line(geom, m),
    );
    if (e.construction) line.computeLineDistances();
    if (pickable) {
      line.userData.sketchEntityId = e.id;
      line.userData.sketchId = sk.sketchId;
    }
    line.renderOrder = 6;
  }
}

function addPoints(group: SketchGroup, sk: SketchRenderInput) {
  for (const e of sk.entities) {
    if (e.kind !== "point") continue;
    const at = uv3(sk.frame, e.x, e.y);
    const geom = new THREE.BufferGeometry().setFromPoints([at]);
    const pt = group.place(
      `sp:${sk.sketchId}:${e.id}`,
      { kind: "point" },
      (m) => new THREE.Points(geom, m),
    );
    pt.userData.sketchEntityId = e.id;
    pt.userData.sketchId = sk.sketchId;
    pt.userData.isPoint = true;
    pt.renderOrder = 8;
  }
}

function buildSketch(sk: SketchRenderInput, key: string): SketchGroup {
  const group = new SketchGroup(sk.frame, !!sk.lit);
  group.userData.renderKey = key;
  if (sk.showProfiles) addProfiles(group, sk);
  addCurves(group, sk);
  if (sk.active) addPoints(group, sk);
  return group;
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
