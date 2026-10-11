import * as THREE from "three";
import { THEME_TOKENS, type ThemeColor, type ThemeTokens } from "./tokens";

type ColoredMaterial = THREE.Material & { color: THREE.Color };

function hasColor(material: THREE.Material): material is ColoredMaterial {
  return "color" in material && material.color instanceof THREE.Color;
}

function inferToken(
  object: THREE.Object3D,
  color: string,
  byColor: ReadonlyMap<string, ThemeColor>,
  previous: ThemeTokens,
): ThemeColor | undefined {
  if (object instanceof THREE.Points) {
    if (color === new THREE.Color(previous["sketch-point"]).getHexString())
      return "sketch-point";
  }
  if (object instanceof THREE.Line) {
    if (color === new THREE.Color(previous["sketch-line"]).getHexString())
      return "sketch-line";
  }
  if (object instanceof THREE.Mesh) {
    if (
      object.userData.originPlane &&
      color === new THREE.Color(previous["origin-plane"]).getHexString()
    )
      return "origin-plane";
    if (color === new THREE.Color(previous.gizmo).getHexString())
      return object.userData.profileId ? "profile-fill" : "gizmo";
  }
  return byColor.get(color);
}

export function applyThemeToScene(
  scene: THREE.Scene,
  tokens: ThemeTokens,
  requestRender: () => void = () => {},
): void {
  const previous =
    (scene.userData.themeTokens as ThemeTokens | undefined) ?? THEME_TOKENS;
  const byColor = new Map<string, ThemeColor>();
  for (const name of Object.keys(previous) as ThemeColor[])
    if (/^#[0-9a-f]{6}$/i.test(previous[name]))
      byColor.set(new THREE.Color(previous[name]).getHexString(), name);
  scene.traverse((object) => {
    if (object instanceof THREE.HemisphereLight) {
      object.color.set(tokens["light-sky"]);
      object.groundColor.set(tokens["light-ground"]);
    } else if (object instanceof THREE.DirectionalLight)
      object.color.set(tokens["light-key"]);
    if (!("material" in object)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.Material) || !hasColor(material))
        continue;
      if (material.userData.userColor !== undefined) continue;
      const explicit =
        (object.userData.themeToken as ThemeColor | undefined) ??
        (material.userData.themeToken as ThemeColor | undefined);
      if (!explicit && "map" in material && material.map) continue;
      const name =
        explicit ??
        inferToken(object, material.color.getHexString(), byColor, previous);
      if (!name || !(name in tokens)) continue;
      material.userData.themeToken = name;
      material.color.set(tokens[name]);
    }
  });
  scene.background = new THREE.Color(tokens["viewport-bg"]);
  scene.userData.themeTokens = tokens;
  requestRender();
}
