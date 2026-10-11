import * as THREE from "three";
import type { PlaneFrame } from "@rockett/shared";
import { uv3 } from "./CadViewport";
import { themeColor, type ThemeColor } from "../theme/tokens";
import { SKETCH_APPEARANCE } from "../tunables";
import { disposeObject } from "./dispose";

export type SketchLook =
  | { kind: "fill"; used: boolean }
  | {
      kind: "curve";
      base: ThemeColor;
      dashed: boolean;
      active: boolean;
      dim: boolean;
    }
  | { kind: "point" };

type State = "base" | "hover" | "selection";
type Styled = THREE.Object3D & { material: THREE.Material | THREE.Material[] };
type Entry = { object: Styled; look: SketchLook };

const NONE = new Set<string>();

function token(look: SketchLook, state: State): ThemeColor {
  if (state !== "base") return state;
  if (look.kind === "fill") return "profile-fill";
  return look.kind === "point" ? "sketch-point" : look.base;
}

function fillOpacity(used: boolean, state: State): number {
  if (state === "selection") return SKETCH_APPEARANCE.profileSelectOpacity;
  if (state === "hover") return SKETCH_APPEARANCE.profileHoverOpacity;
  return used
    ? SKETCH_APPEARANCE.profileUsedOpacity
    : SKETCH_APPEARANCE.profileOpacity;
}

function makeMaterial(look: SketchLook, state: State): THREE.Material {
  const color = themeColor(token(look, state));
  if (look.kind === "fill")
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: fillOpacity(look.used, state),
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
  if (look.kind === "point")
    return new THREE.PointsMaterial({
      color,
      size:
        state === "base"
          ? SKETCH_APPEARANCE.pointSizePx
          : SKETCH_APPEARANCE.pointHighlightSizePx,
      sizeAttenuation: false,
      depthTest: false,
    });
  if (look.dashed)
    return new THREE.LineDashedMaterial({
      color,
      dashSize: SKETCH_APPEARANCE.constructionDashMm,
      gapSize: SKETCH_APPEARANCE.constructionGapMm,
      depthTest: false,
    });
  return new THREE.LineBasicMaterial({
    color,
    transparent: !look.active,
    opacity: look.active
      ? SKETCH_APPEARANCE.activeLineOpacity
      : look.dim
        ? SKETCH_APPEARANCE.dimmedLineOpacity
        : SKETCH_APPEARANCE.inactiveLineOpacity,
    depthTest: false,
  });
}

export function hoverPiece(frame: PlaneFrame, piece: number[]): THREE.Line {
  const positions: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < piece.length; i += 2)
    positions.push(uv3(frame, piece[i]!, piece[i + 1]!));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(positions),
    new THREE.LineBasicMaterial({
      color: themeColor("hover"),
      depthTest: false,
    }),
  );
  line.renderOrder = 7;
  line.userData.themeToken = "hover";
  return line;
}

export class SketchGroup extends THREE.Group {
  readonly material: THREE.Material[] = [];
  private readonly palette = new Map<string, THREE.Material>();
  private readonly byKey = new Map<string, Entry[]>();
  private styled = new Set<string>();
  private piece: { id: string; line: THREE.Line } | null = null;

  constructor(
    private readonly frame: PlaneFrame,
    private readonly lit: boolean,
  ) {
    super();
  }

  place<T extends Styled>(
    key: string,
    look: SketchLook,
    make: (material: THREE.Material) => T,
  ): T {
    const material = this.materialFor(look, this.stateOf(look, key));
    const object = make(material);
    object.userData.themeToken = material.userData.themeToken;
    const entries = this.byKey.get(key) ?? [];
    entries.push({ object, look });
    this.byKey.set(key, entries);
    this.add(object);
    return object;
  }

  restyle(
    selected: Set<string>,
    hoverKey: string | null,
    piece: number[] | null,
  ) {
    const next = new Set<string>();
    for (const key of selected) if (this.byKey.has(key)) next.add(key);
    if (hoverKey && this.byKey.has(hoverKey)) next.add(hoverKey);
    for (const key of new Set([...this.styled, ...next]))
      for (const { object, look } of this.byKey.get(key)!) {
        const state = this.stateOf(look, key, selected, hoverKey, piece);
        const material = this.materialFor(look, state);
        if (object.material === material) continue;
        object.material = material;
        object.userData.themeToken = material.userData.themeToken;
      }
    this.styled = next;
    const curve = this.byKey
      .get(hoverKey ?? "")
      ?.some((e) => e.look.kind === "curve");
    this.showPiece(curve && piece ? piece : null, hoverKey);
  }

  private stateOf(
    look: SketchLook,
    key: string,
    selected = NONE,
    hoverKey: string | null = null,
    piece: number[] | null = null,
  ): State {
    if (selected.has(key)) return "selection";
    const curve = look.kind === "curve";
    const hovered = key === hoverKey && !(curve && piece);
    return hovered || (curve && this.lit) ? "hover" : "base";
  }

  private materialFor(look: SketchLook, state: State): THREE.Material {
    const id = JSON.stringify([look, state]);
    const known = this.palette.get(id);
    if (known) return known;
    const material = makeMaterial(look, state);
    material.userData.themeToken = token(look, state);
    this.palette.set(id, material);
    this.material.push(material);
    return material;
  }

  private showPiece(piece: number[] | null, hoverKey: string | null) {
    const id = piece ? JSON.stringify([hoverKey, piece]) : null;
    if (this.piece?.id === id) return;
    if (this.piece) {
      this.remove(this.piece.line);
      disposeObject(this.piece.line);
      this.piece = null;
    }
    if (!piece || !id) return;
    this.piece = { id, line: hoverPiece(this.frame, piece) };
    this.add(this.piece.line);
  }
}
