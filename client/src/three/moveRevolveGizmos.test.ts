import * as THREE from "three";
import { afterEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type MeshedBody,
  type SketchPayload,
} from "@rockett/shared";
import "../features/core";
import {
  featureCommand,
  featureParams,
  setFeatureParams,
} from "../commands/featureCommand";
import { useStore } from "../store";
import { api } from "../api";
import { dropBase, loadPreviewBase } from "../previewBase";
import { dragPreview } from "../toolTargets";
import { FeatureGizmos } from "./featureGizmos";
import { sceneLayers } from "./sceneLayers";
import { worldToClient } from "./screen";

const baseline = useStore.getState();
const owners: FeatureGizmos[] = [];
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  vi.restoreAllMocks();
  useStore.setState(baseline, true);
  dropBase();
});
const sketch: SketchPayload = {
  featureId: "sketch",
  frame: {
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    normal: [0, 0, 1],
  },
  entities: [],
  solveStatus: "fully_constrained",
  dof: 0,
  profiles: [
    {
      id: "profile",
      outer: [],
      holes: [],
      polygon: [8, -2, 12, -2, 12, 2, 8, 2],
      holePolygons: [],
      area: 16,
    },
  ],
};
const body: MeshedBody = {
  bodyId: "body",
  name: "Body",
  meshKey: "mesh",
  positions: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2],
  faces: [],
  edges: [
    {
      name: "axis",
      polyline: [5, 0, -5, 5, 0, 5],
      length: 10,
      curve: { type: "line", a: [5, 0, -5], b: [5, 0, 5] },
    },
  ],
  vertices: [],
  bbox: { min: [-1, -1, -1], max: [1, 1, 1] },
};
function setup(type: "move" | "revolve", editing = false) {
  useStore.setState(baseline, true);
  dropBase();
  const document = createEmptyDocument("document", "Gizmo fixture");
  if (editing)
    document.features.push(
      type === "move"
        ? {
            id: "edit",
            type: "move",
            name: "Move",
            suppressed: false,
            bodies: ["body"],
            translation: [0, 0, 0],
            axis: { kind: "originAxis", axis: "Z" },
            angle: 0,
            copy: false,
          }
        : {
            id: "edit",
            type: "revolve",
            name: "Revolve",
            suppressed: false,
            profiles: [{ sketchId: "sketch", profileId: "profile" }],
            axis: { kind: "originAxis", axis: "Z" },
            angle: 90,
            operation: "newBody",
          },
    );
  document.timelinePosition = document.features.length;
  useStore.setState({
    projectId: document.id,
    document,
    evaluation: {
      bodies: [body],
      sketches: [sketch],
      planes: [],
      featureStatuses: [],
      kernelMs: 0,
    },
    active: null,
    selection: [],
  });
  featureCommand.enter(type, {
    selection:
      type === "move"
        ? [{ kind: "body", bodyId: "body" }]
        : [{ kind: "profile", sketchId: "sketch", profileId: "profile" }],
    ...(editing && { editFeatureId: "edit" }),
  });
  if (editing && type === "revolve") setFeatureParams({ angle: 90 });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-40, 40, 30, -30, -1000, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const layers = sceneLayers(scene);
  const host = {
    scene,
    camera,
    worldPerPixel: () => 0.1,
    canvasRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    requestRender: vi.fn(),
    addLayer: layers.addLayer,
  };
  const label = vi.fn();
  const owner = new FeatureGizmos(host, label);
  owners.push(owner);
  const at = (x: number, y: number, z = 0) => ({
    ...worldToClient(host.canvasRect(), camera, new THREE.Vector3(x, y, z)),
    ctrlKey: false,
    metaKey: false,
  });
  const pointer = (x: number, y: number, z = 0) => {
    const p = at(x, y, z);
    return { clientX: p.x, clientY: p.y, ctrlKey: false, metaKey: false };
  };
  const layer = scene.getObjectByName("featureGizmo")!;
  const ring = () => {
    let found: THREE.Mesh | undefined;
    layer.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry)
        found = o;
    });
    return found!;
  };
  const ghosts = () => {
    const found: THREE.Mesh[] = [];
    layer.traverse((o) => {
      if (o instanceof THREE.Mesh && o.renderOrder === 4) found.push(o);
    });
    return found;
  };
  return { owner, layer, host, label, pointer, ring, ghosts };
}

it("registers Move arrows and a translated ghost on the single command layer", () => {
  const { owner, layer, pointer, ghosts } = setup("move");
  expect(layer.children).toHaveLength(1);
  expect(ghosts()).toHaveLength(1);
  expect(ghosts()[0]!.visible).toBe(false);
  expect(owner.down(pointer(6, 0))).toBe(true);
  expect(owner.move(pointer(10, 0))).toBe(true);
  expect(featureParams()).toMatchObject({ tx: 4, ty: 0, tz: 0 });
  expect(ghosts()[0]!.position.x).toBe(4);
  expect(ghosts()[0]!.visible).toBe(true);
  expect(owner.up()).toBe(true);
  const group = layer.children[0];
  setFeatureParams({ tx: -2, ty: 3, tz: 0 });
  expect(layer.children[0]).toBe(group);
  expect(ghosts()[0]!.position.toArray()).toEqual([-2, 3, 0]);
});

it("keeps Move edit preview and zero release on the existing transport without edit ghosts", async () => {
  const during = vi.spyOn(dragPreview, "during").mockImplementation(() => {});
  const commit = vi.spyOn(dragPreview, "commit").mockImplementation(() => {});
  const { owner, pointer, ghosts } = setup("move", true);
  expect(ghosts()).toHaveLength(0);
  expect(owner.down(pointer(6, 0))).toBe(false);
  vi.spyOn(api, "evaluate").mockResolvedValue(useStore.getState().evaluation!);
  expect(await loadPreviewBase("edit", useStore.getState)).toBe(true);
  owner.refresh(true);
  expect(owner.down(pointer(6, 0))).toBe(true);
  owner.move(pointer(2, 0));
  expect(during).toHaveBeenLastCalledWith("edit", { translation: [-4, 0, 0] });
  owner.move(pointer(6, 0));
  owner.up();
  expect(featureParams()).toMatchObject({ tx: 0, ty: 0, tz: 0 });
  expect(commit).toHaveBeenLastCalledWith("edit", { translation: [0, 0, 0] });
});

it("registers Revolve ring and complete ghost together, retaining angle-only ring identity", () => {
  const { layer, ring, ghosts } = setup("revolve");
  expect(layer.children).toHaveLength(1);
  const original = ring();
  expect(original).toBeDefined();
  expect(ghosts()).toHaveLength(1);
  const oldGeometry = ghosts()[0]!.geometry;
  const disposed = vi.spyOn(oldGeometry, "dispose");
  setFeatureParams({ angle: -90 });
  expect(ring()).toBe(original);
  expect(ghosts()).toHaveLength(3);
  expect(disposed).toHaveBeenCalledTimes(1);
  setFeatureParams({ angle: 0 });
  expect(ring()).toBe(original);
  expect(ghosts()).toHaveLength(0);
});

it("defers axis changes during an accepted revolve drag and rebuilds once on release", () => {
  const { owner, pointer, ring, ghosts } = setup("revolve");
  setFeatureParams({ angle: 0 });
  const original = ring();
  expect(owner.down(pointer(10, 0))).toBe(true);
  setFeatureParams({ axis: "X" });
  expect(ring()).toBe(original);
  expect(owner.move(pointer(0, 10))).toBe(true);
  const zExtent = () =>
    Math.max(
      ...ghosts().flatMap((mesh) => {
        const positions = mesh.geometry.getAttribute("position");
        return Array.from({ length: positions.count }, (_, index) =>
          Math.abs(positions.getZ(index)),
        );
      }),
    );
  expect(zExtent()).toBe(0);
  expect(owner.up()).toBe(true);
  expect(zExtent()).toBeGreaterThan(1);

  expect(ring()).not.toBe(original);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(ring().quaternion);
  expect(normal.distanceTo(new THREE.Vector3(1, 0, 0))).toBeLessThan(1e-10);
  setFeatureParams({ axisSource: "edge" });
  expect(ring()).toBeUndefined();
  useStore.setState({
    selection: [
      ...useStore.getState().selection,
      { kind: "edge", bodyId: "body", edgeName: "axis" },
    ],
  });
  expect(ring().position.toArray()).toEqual([5, 0, 0]);
});

it("keeps signed Revolve edit preview, ignores zero and releases through the same transport", () => {
  const during = vi.spyOn(dragPreview, "during").mockImplementation(() => {});
  const commit = vi.spyOn(dragPreview, "commit").mockImplementation(() => {});
  const { owner, pointer, ghosts } = setup("revolve", true);
  expect(ghosts()).toHaveLength(0);
  expect(owner.down(pointer(0, 10))).toBe(true);
  owner.move(pointer(10, 0));
  expect(featureParams().angle).toBe(0);
  expect(during).not.toHaveBeenCalled();
  owner.move(pointer(0, -10));
  expect(featureParams().angle).toBe(-90);
  expect(during).toHaveBeenLastCalledWith("edit", { angle: -90 });
  owner.up();
  expect(commit).toHaveBeenLastCalledWith("edit", { angle: -90 });
});

it.each(["move", "revolve"] as const)(
  "isolates %s cancelled gestures, exit cleanup and viewport unmount",
  (type) => {
    const { owner, layer, pointer } = setup(type);
    const point = type === "move" ? pointer(6, 0) : pointer(10, 0);
    expect(owner.down(point)).toBe(true);
    const geometries: THREE.BufferGeometry[] = [];
    layer.traverse((o) => {
      if (o instanceof THREE.Mesh) geometries.push(o.geometry);
    });
    const disposals = geometries.map((g) => vi.spyOn(g, "dispose"));
    featureCommand.exit();
    expect(layer.children).toHaveLength(0);
    for (const disposal of disposals) expect(disposal).toHaveBeenCalledTimes(1);
    featureCommand.enter(type);
    const replacement = useStore.getState().active;
    expect(owner.move(pointer(15, 0))).toBe(true);
    expect(owner.cancel()).toBe(true);
    expect(owner.up()).toBe(false);
    expect(useStore.getState().active).toBe(replacement);
    owner.dispose();
    expect(layer.parent).toBeNull();
    useStore.setState({ selection: [] });
    expect(layer.children).toHaveLength(0);
  },
);

it("retains numeric fallback, incomplete input and explicit zero without replacing the ring", () => {
  const { ring, ghosts } = setup("revolve");
  const original = ring();
  for (const angle of ["-", Number.NaN, Number.POSITIVE_INFINITY]) {
    setFeatureParams({ angle });
    expect(ring()).toBe(original);
    expect(ghosts()).toHaveLength(1);
  }
  setFeatureParams({ angle: "" });
  expect(ghosts()).toHaveLength(0);
  expect(ring()).toBe(original);
});

it("resolves a selected sketch line in its placed frame through the registered factory", () => {
  const { ring } = setup("revolve");
  const entities = [
    { id: "a", kind: "point" as const, x: 0, y: -8 },
    { id: "b", kind: "point" as const, x: 10, y: -8 },
    { id: "line", kind: "line" as const, p1: "a", p2: "b" },
  ];
  const document = structuredClone(useStore.getState().document!);
  document.features.push({
    id: "sketch",
    type: "sketch",
    name: "Sketch",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities,
    constraints: [],
  });
  const evaluation = structuredClone(useStore.getState().evaluation!);
  evaluation.sketches[0]!.entities = entities;
  evaluation.sketches[0]!.frame = {
    origin: [2, 3, 4],
    xAxis: [0, 1, 0],
    yAxis: [0, 0, 1],
    normal: [1, 0, 0],
  };
  useStore.setState({
    document,
    evaluation,
    selection: [
      ...useStore.getState().selection,
      { kind: "sketchEntity", sketchId: "sketch", entityId: "line" },
    ],
  });
  setFeatureParams({ axisSource: "edge" });
  expect(ring().position.toArray()).toEqual([2, 13, -4]);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(ring().quaternion);
  expect(normal.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-10);
});
