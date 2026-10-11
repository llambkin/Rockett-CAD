import * as THREE from "three";
import type { CadDocument, EvaluateResult } from "@rockett/shared";
import { type CadViewport, uv3 } from "./CadViewport";
import type { LayerHandle } from "./sceneLayers";

const IDLE_BUDGET_BYTES = 256 * 1024 * 1024;
const MAX_DECODES = 4;
const MAX_IMAGE_SIDE = 4096;

interface CachedTexture {
  url: string;
  texture: THREE.Texture;
  refs: number;
  bytes: number;
  loading: boolean;
}

interface ImageLayer {
  root: LayerHandle;
  held: CachedTexture[];
}

const cache = new Map<string, CachedTexture>();
const waiting: CachedTexture[] = [];
const loader = new THREE.ImageLoader();
let decoding = 0;
const layers = new Map<CadViewport, ImageLayer>();

function layerFor(vp: CadViewport): ImageLayer {
  const existing = layers.get(vp);
  if (existing) return existing;
  const layer: ImageLayer = { root: vp.addLayer("referenceImages"), held: [] };
  layer.root.group.addEventListener("removed", () => {
    layers.delete(vp);
    for (const entry of layer.held.splice(0)) release(entry);
    evictIdle();
  });
  layers.set(vp, layer);
  return layer;
}

function acquire(url: string): CachedTexture {
  const hit = cache.get(url);
  if (hit) {
    hit.refs++;
    return hit;
  }
  const entry: CachedTexture = {
    url,
    texture: new THREE.Texture(),
    refs: 1,
    bytes: 0,
    loading: true,
  };
  entry.texture.colorSpace = THREE.SRGBColorSpace;
  cache.set(url, entry);
  waiting.push(entry);
  pump();
  return entry;
}

function release(entry: CachedTexture) {
  if (--entry.refs > 0) return;
  if (cache.get(entry.url) !== entry) {
    entry.texture.dispose();
    return;
  }
  cache.delete(entry.url);
  cache.set(entry.url, entry);
}

function hold(layer: ImageLayer, url: string): THREE.Texture {
  const entry = acquire(url);
  layer.held.push(entry);
  return entry.texture;
}

function pump() {
  while (decoding < MAX_DECODES) {
    const entry = waiting.shift();
    if (!entry) return;
    if (entry.refs > 0) decode(entry);
    else drop(entry);
  }
}

function decode(entry: CachedTexture) {
  decoding++;
  const settle = () => {
    entry.loading = false;
    decoding--;
    pump();
    evictIdle();
    for (const vp of layers.keys()) vp.requestRender();
  };
  loader.load(
    entry.url,
    (image) => {
      const bounded = boundedImage(image);
      entry.texture.image = bounded;
      entry.texture.needsUpdate = true;
      entry.bytes = bounded.width * bounded.height * 4;
      if (entry.texture.generateMipmaps) entry.bytes = (entry.bytes / 3) * 4;
      settle();
    },
    undefined,
    () => {
      cache.delete(entry.url);
      if (entry.refs === 0) entry.texture.dispose();
      settle();
    },
  );
}

function boundedImage(image: HTMLImageElement) {
  const side = Math.max(image.width, image.height);
  if (side <= MAX_IMAGE_SIDE) return image;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((image.width * MAX_IMAGE_SIDE) / side));
  canvas.height = Math.max(
    1,
    Math.round((image.height * MAX_IMAGE_SIDE) / side),
  );
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function drop(entry: CachedTexture) {
  cache.delete(entry.url);
  entry.texture.dispose();
}

function evictIdle() {
  let idle = 0;
  for (const entry of cache.values()) if (entry.refs === 0) idle += entry.bytes;
  for (const entry of cache.values()) {
    if (idle <= IDLE_BUDGET_BYTES) return;
    if (entry.refs > 0 || entry.loading) continue;
    idle -= entry.bytes;
    drop(entry);
  }
}

export function syncReferenceImages(
  vp: CadViewport,
  doc: CadDocument | null,
  evaluation: EvaluateResult,
  hidden: ReadonlySet<string>,
) {
  const layer = layerFor(vp);
  const previous = layer.held.splice(0);
  layer.root.clear();
  if (doc) addImages(layer, doc, evaluation, hidden);
  for (const entry of previous) release(entry);
  evictIdle();
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
      map: hold(layer, url),
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
