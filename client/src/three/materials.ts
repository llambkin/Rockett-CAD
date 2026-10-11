import * as THREE from "three";
import { themeColor } from "../theme/tokens";
import { BODY_APPEARANCE } from "../tunables";

const DIMMED_OPACITY = 0.35;

function faceMaterial(color: string | undefined, dimmed: boolean) {
  const material = new THREE.MeshStandardMaterial({
    color: color ?? themeColor("body"),
    metalness: BODY_APPEARANCE.metalness,
    roughness: BODY_APPEARANCE.roughness,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    transparent: dimmed,
    opacity: dimmed ? DIMMED_OPACITY : 1,
  });
  if (color === undefined) material.userData.themeToken = "body";
  else material.userData.userColor = color;
  return material;
}

function edgeMaterial() {
  const material = new THREE.LineBasicMaterial({ color: themeColor("edge") });
  material.userData.themeToken = "edge";
  return material;
}

function vertexMaterial() {
  const material = new THREE.PointsMaterial({
    color: themeColor("edge"),
    size: BODY_APPEARANCE.vertexSizePx,
    sizeAttenuation: false,
  });
  material.userData.themeToken = "edge";
  return material;
}

export class BodyMaterials {
  private readonly faces = new Map<string, THREE.MeshStandardMaterial>();
  private edges: THREE.LineBasicMaterial | null = null;
  private vertices: THREE.PointsMaterial | null = null;
  private readonly users = new Map<THREE.Material, number>();

  face(color: string | undefined, dimmed: boolean) {
    const key = `${color ?? "body"}${dimmed ? ":dimmed" : ""}`;
    let material = this.faces.get(key);
    if (!material) {
      material = faceMaterial(color, dimmed);
      this.faces.set(key, material);
    }
    return this.use(material);
  }

  edge() {
    return this.use((this.edges ??= edgeMaterial()));
  }

  vertex() {
    return this.use((this.vertices ??= vertexMaterial()));
  }

  release(material: THREE.Material | THREE.Material[]) {
    for (const m of [material].flat()) {
      const users = this.users.get(m);
      if (users === undefined) continue;
      if (users > 1) {
        this.users.set(m, users - 1);
        continue;
      }
      this.users.delete(m);
      if (m === this.edges) this.edges = null;
      if (m === this.vertices) this.vertices = null;
      for (const [key, face] of this.faces)
        if (face === m) this.faces.delete(key);
    }
  }

  live(): ReadonlySet<THREE.Material> {
    return new Set(this.users.keys());
  }

  private use<M extends THREE.Material>(material: M) {
    this.users.set(material, (this.users.get(material) ?? 0) + 1);
    return material;
  }
}
