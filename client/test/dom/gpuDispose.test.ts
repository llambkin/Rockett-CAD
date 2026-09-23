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
import { manyBodyPayloads } from "../helpers/perfFixtures";

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

const nextMaterialId = () =>
  (new THREE.MeshBasicMaterial() as unknown as { id: number }).id;
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
  const viewport = {
    getSketchRoot: () => root,
    requestRender: () => {},
  } as unknown as CadViewport;
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
    const viewport = {
      scene: new THREE.Scene(),
      requestRender: () => {},
    } as unknown as CadViewport;
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
    const viewport = {
      scene: new THREE.Scene(),
      requestRender: () => {},
    } as unknown as CadViewport;
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

vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: (await import("../helpers/fakeRenderer")).FakeWebGLRenderer,
}));

async function mountViewport() {
  const { CadViewport } = await import("../../src/three/CadViewport");
  return new CadViewport(document.createElement("div"));
}

describe("CadViewport ownership", () => {
  type Planes = Parameters<CadViewport["syncConstructionPlanes"]>[0];
  type Body = Parameters<CadViewport["syncBodies"]>[0][number];

  const planes: Planes = [0, 5].map((z) => ({
    featureId: `p${z}`,
    frame: {
      origin: [0, 0, z],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    },
    size: 10,
  }));
  const visible = new Set(planes.map((p) => p.featureId));
  const body: Body = {
    bodyId: "b1",
    name: "Body",
    visible: true,
    meshKey: "b1:1",
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
    faces: [],
    edges: [],
    vertices: [],
    bbox: { min: [0, 0, 0], max: [1, 1, 0] },
  };

  it("planes re-sync disposes every resource of the previous sync once", async () => {
    const vp = await mountViewport();
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");

    const materialsBefore = nextMaterialId();
    const geometriesBefore = nextGeometryId();
    vp.syncConstructionPlanes(planes, new Map(), visible);
    const materialsAfter = nextMaterialId();
    const geometriesAfter = nextGeometryId();
    vp.syncConstructionPlanes(planes, new Map(), visible);

    expect(vp.getPlaneRoot().children).toHaveLength(2);
    const created = idsBetween(materialsBefore, materialsAfter);
    expect(created).toHaveLength(4);
    expect(disposedIds(materialDispose)).toEqual(created);
    expect(disposedIds(geometryDispose)).toEqual(
      idsBetween(geometriesBefore, geometriesAfter),
    );
    vp.dispose();
  });

  it("keeps the objects of every body whose mesh key is unchanged", async () => {
    const vp = await mountViewport();
    const bodies = manyBodyPayloads();
    vp.syncBodies(bodies);
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const renamed = bodies.map((p) => ({ ...p, name: `${p.name}'` }));

    const before = nextGeometryId();
    vp.syncBodies(renamed);
    expect(idsBetween(before, nextGeometryId()).length).toBe(0);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(vp.bodyPayloads()[0]).toBe(renamed[0]);

    const edited = renamed.map((p, i) =>
      i === 0 ? { ...p, meshKey: `${p.meshKey}'` } : p,
    );
    const beforeEdit = nextGeometryId();
    vp.syncBodies(edited);
    expect(idsBetween(beforeEdit, nextGeometryId()).length).toBe(3);
    expect(geometryDispose).toHaveBeenCalledTimes(3);
    vp.dispose();
  });

  it("viewport dispose releases every scene resource once and keeps a borrowed texture", async () => {
    const materialsBefore = nextMaterialId();
    const geometriesBefore = nextGeometryId();
    const vp = await mountViewport();
    vp.syncBodies([body]);
    vp.syncConstructionPlanes(planes, new Map(), visible);
    vp.addHighlight({ kind: "body", bodyId: "b1" }, "select");
    renderSketches(vp, [sketch], [], null);
    const texture = new THREE.Texture();
    const images = new THREE.Group();
    images.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: texture }),
      ),
    );
    vp.scene.add(images);
    const materialsAfter = nextMaterialId();
    const geometriesAfter = nextGeometryId();

    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    let bodiesAtRendererDispose = -1;
    vi.spyOn(vp.renderer, "dispose").mockImplementation(() => {
      bodiesAtRendererDispose = vp.bodyPayloads().length;
    });

    vp.dispose();

    expect(vp.scene.children).toHaveLength(0);
    expect(bodiesAtRendererDispose).toBe(0);
    expect(textureDispose).not.toHaveBeenCalled();
    const created = idsBetween(materialsBefore, materialsAfter);
    expect(created.length).toBeGreaterThan(20);
    expect(disposedIds(materialDispose)).toEqual(created);
    expect(disposedIds(geometryDispose)).toEqual(
      idsBetween(geometriesBefore, geometriesAfter),
    );
  });
});
