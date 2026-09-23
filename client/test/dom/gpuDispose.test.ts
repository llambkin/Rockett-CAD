import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CadDocument,
  EvaluateResult,
  PlaneFrame,
  ReferenceImageFeature,
  SketchEntity,
} from "@rockett/shared";
import type { Selection } from "../../src/store";
import type { CadViewport } from "../../src/three/CadViewport";
import { clearGroup, disposeGroup } from "../../src/three/dispose";
import { syncReferenceImages } from "../../src/three/referenceImages";
import {
  renderSketches,
  type SketchRenderInput,
} from "../../src/three/sketchRender";

afterEach(() => {
  vi.restoreAllMocks();
});

function disposedIds(spy: { mock: { contexts: unknown[] } }): number[] {
  return spy.mock.contexts
    .map((c) => (c as { id: number }).id)
    .toSorted((a, b) => a - b);
}

function idsBetween(first: number, last: number): number[] {
  return Array.from({ length: last - first - 1 }, (_, i) => first + 1 + i);
}

const nextMaterialId = () => new THREE.MeshBasicMaterial().id;
const nextGeometryId = () => new THREE.BufferGeometry().id;

const entities: SketchEntity[] = [
  { id: "a", kind: "point", x: 0, y: 0 },
  { id: "b", kind: "point", x: 10, y: 0 },
  { id: "c", kind: "point", x: 10, y: 10 },
  { id: "d", kind: "point", x: 0, y: 10 },
  { id: "ab", kind: "line", p1: "a", p2: "b" },
  { id: "bc", kind: "line", p1: "b", p2: "c" },
  { id: "cd", kind: "line", p1: "c", p2: "d" },
  { id: "da", kind: "line", p1: "d", p2: "a" },
  { id: "diag", kind: "line", p1: "a", p2: "c", construction: true },
  { id: "o", kind: "circle", center: "a", radius: 3 },
];

const sketch: SketchRenderInput = {
  sketchId: "s1",
  frame: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  },
  entities,
  showProfiles: true,
  active: true,
};

it("sketch hover rebuild disposes every resource of the previous build once", () => {
  const root = new THREE.Group();
  const viewport = { getSketchRoot: () => root } as unknown as CadViewport;
  const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
  const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");

  const materialsBefore = nextMaterialId();
  const geometriesBefore = nextGeometryId();
  renderSketches(viewport, [sketch], [], null);
  const materialsAfter = nextMaterialId();
  const geometriesAfter = nextGeometryId();
  expect(root.children[0]?.children.length).toBeGreaterThan(10);

  const hovers: Selection[] = [
    { kind: "sketchEntity", sketchId: "s1", entityId: "ab" },
    { kind: "sketchEntity", sketchId: "s1", entityId: "diag" },
    { kind: "sketchPoint", sketchId: "s1", entityId: "a" },
  ];
  for (const hover of hovers) renderSketches(viewport, [sketch], [], hover);
  renderSketches(viewport, [], [], null);

  expect(root.children).toHaveLength(0);
  const firstBuildMaterials = idsBetween(materialsBefore, materialsAfter);
  const firstBuildGeometries = idsBetween(geometriesBefore, geometriesAfter);
  const materialIds = disposedIds(materialDispose);
  const geometryIds = disposedIds(geometryDispose);
  expect(new Set(materialIds).size).toBe(materialIds.length);
  expect(new Set(geometryIds).size).toBe(geometryIds.length);
  expect(materialIds.filter((id) => id < materialsAfter)).toEqual(
    firstBuildMaterials,
  );
  expect(geometryIds.filter((id) => id < geometriesAfter)).toEqual(
    firstBuildGeometries,
  );
});

it("clearGroup disposes a shared geometry once and keeps a shared texture", () => {
  const texture = new THREE.Texture();
  const textureDispose = vi.spyOn(texture, "dispose");
  const geometry = new THREE.PlaneGeometry(1, 1);
  const geometryDispose = vi.spyOn(geometry, "dispose");
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const materialDispose = vi.spyOn(material, "dispose");
  const keeperMaterial = new THREE.MeshBasicMaterial({ map: texture });
  const keeperDispose = vi.spyOn(keeperMaterial, "dispose");

  const group = new THREE.Group();
  const nested = new THREE.Group();
  nested.add(new THREE.Mesh(geometry, material));
  group.add(new THREE.Mesh(geometry, material), nested);
  const keeper = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), keeperMaterial);

  clearGroup(group);

  expect(group.children).toHaveLength(0);
  expect(geometryDispose).toHaveBeenCalledTimes(1);
  expect(materialDispose).toHaveBeenCalledTimes(1);
  expect(textureDispose).not.toHaveBeenCalled();
  expect(keeperDispose).not.toHaveBeenCalled();
  expect(keeper.material.map).toBe(texture);
});

it("disposeGroup releases a material array entry once", () => {
  const material = new THREE.MeshBasicMaterial();
  const materialDispose = vi.spyOn(material, "dispose");
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), [material, material]));

  disposeGroup(group);

  expect(materialDispose).toHaveBeenCalledTimes(1);
});

type ImageMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

const frame: PlaneFrame = {
  origin: [0, 0, 0],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
};

function image(id: string, assetId: string): ReferenceImageFeature {
  return {
    id,
    name: id,
    suppressed: false,
    type: "referenceImage",
    plane: { kind: "origin", plane: "XY" },
    assetId,
    fileName: `${assetId}.png`,
    transform: { u: 0, v: 0, rotation: 0, scale: 1 },
    opacity: 0.5,
    visible: true,
    width: 4,
    height: 3,
  };
}

function sync(viewport: CadViewport, features: ReferenceImageFeature[]) {
  const doc = {
    id: "p1",
    features,
    timelinePosition: features.length,
  } as unknown as CadDocument;
  const evaluation = {
    planes: features.map((f) => ({ featureId: f.id, frame, size: 10 })),
  } as unknown as EvaluateResult;
  syncReferenceImages(viewport, doc, evaluation);
}

function stubImageLoads() {
  const pending: (() => void)[] = [];
  vi.spyOn(THREE.ImageLoader.prototype, "load").mockImplementation(
    (_url, onLoad) => {
      const img = document.createElement("img");
      pending.push(() => onLoad?.(img));
      return img;
    },
  );
  return () => {
    for (const finish of pending.splice(0)) finish();
  };
}

function meshes(viewport: CadViewport): ImageMesh[] {
  return (viewport.scene.children[0]?.children ?? []) as ImageMesh[];
}

describe("reference images", () => {
  it("reference image removed disposes its texture, geometry and material", () => {
    const finishLoads = stubImageLoads();
    const viewport = { scene: new THREE.Scene() } as unknown as CadViewport;
    const a = image("a", "asset-a");
    const b = image("b", "asset-b");
    sync(viewport, [a, b]);
    finishLoads();
    const [removed, kept] = meshes(viewport);
    if (!removed || !kept) throw new Error("expected two image meshes");
    const geometryDispose = vi.spyOn(removed.geometry, "dispose");
    const materialDispose = vi.spyOn(removed.material, "dispose");
    const textureDispose = vi.spyOn(removed.material.map!, "dispose");
    const keptTextureDispose = vi.spyOn(kept.material.map!, "dispose");

    sync(viewport, [{ ...a, visible: false }, b]);

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(keptTextureDispose).not.toHaveBeenCalled();
    expect(meshes(viewport)).toHaveLength(1);
    expect(meshes(viewport)[0]?.material.map).toBe(kept.material.map);
  });

  it("an image hidden while loading keeps its texture until the load settles", () => {
    const finishLoads = stubImageLoads();
    const viewport = { scene: new THREE.Scene() } as unknown as CadViewport;
    const a = image("a", "asset-a");
    sync(viewport, [a]);
    const texture = meshes(viewport)[0]?.material.map;
    if (!texture) throw new Error("expected a textured image mesh");
    const textureDispose = vi.spyOn(texture, "dispose");

    sync(viewport, [{ ...a, visible: false }]);
    expect(textureDispose).not.toHaveBeenCalled();

    finishLoads();
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
