import * as THREE from "three";
import type { CadDocument, EvaluateResult } from "@rockett/shared";
import { type CadViewport, uv3 } from "./CadViewport";
import type { LayerHandle } from "./sceneLayers";

interface CachedTexture {
  texture: THREE.Texture;
  loading: boolean;
}

interface ImageLayer {
  vp: CadViewport;
  root: LayerHandle;
  textures: Map<string, CachedTexture>;
  used: Set<string>;
}

const layers = new WeakMap<CadViewport, ImageLayer>();

function layerFor(vp: CadViewport): ImageLayer {
  const existing = layers.get(vp);
  if (existing) return existing;
  const layer: ImageLayer = {
    vp,
    root: vp.addLayer("referenceImages"),
    textures: new Map(),
    used: new Set(),
  };
  layer.root.group.addEventListener("removed", () => {
    layers.delete(vp);
    layer.used.clear();
    evictUnused(layer);
  });
  layers.set(vp, layer);
  return layer;
}

function evictUnused(layer: ImageLayer) {
  for (const [url, cached] of layer.textures) {
    if (cached.loading || layer.used.has(url)) continue;
    layer.textures.delete(url);
    cached.texture.dispose();
  }
}

function acquireTexture(layer: ImageLayer, url: string): THREE.Texture {
  layer.used.add(url);
  const hit = layer.textures.get(url);
  if (hit) return hit.texture;
  const settle = () => {
    cached.loading = false;
    evictUnused(layer);
    layer.vp.requestRender();
  };
  const cached: CachedTexture = {
    texture: new THREE.TextureLoader().load(url, settle, undefined, settle),
    loading: true,
  };
  cached.texture.colorSpace = THREE.SRGBColorSpace;
  layer.textures.set(url, cached);
  return cached.texture;
}

export function syncReferenceImages(
  vp: CadViewport,
  doc: CadDocument | null,
  evaluation: EvaluateResult,
  hidden: ReadonlySet<string>,
) {
  const layer = layerFor(vp);
  layer.root.clear();
  layer.used.clear();
  if (doc) addImages(layer, doc, evaluation, hidden);
  evictUnused(layer);
  vp.requestRender();
}

function addImages(
  layer: ImageLayer,
  doc: CadDocument,
  evaluation: EvaluateResult,
  hidden: ReadonlySet<string>,
) {
  const activeFeatures = doc.features.slice(0, doc.timelinePosition);
  for (const f of activeFeatures) {
    if (f.type !== "referenceImage" || f.suppressed || hidden.has(f.id))
      continue;
    const planeInfo = evaluation.planes.find((p) => p.featureId === f.id);
    if (!planeInfo) continue;
    const url = `/api/projects/${doc.id}/assets/${f.assetId}`;
    const w = f.width * f.transform.scale;
    const h = f.height * f.transform.scale;
    const geom = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: acquireTexture(layer, url),
      transparent: true,
      opacity: f.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    const frame = planeInfo.frame;
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...frame.xAxis),
      new THREE.Vector3(...frame.yAxis),
      new THREE.Vector3(...frame.normal),
    );
    m.setPosition(uv3(frame, f.transform.u, f.transform.v));
    const rot = new THREE.Matrix4().makeRotationZ(
      (f.transform.rotation * Math.PI) / 180,
    );
    mesh.applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, rot));
    mesh.renderOrder = -2;
    layer.root.group.add(mesh);
  }
}
