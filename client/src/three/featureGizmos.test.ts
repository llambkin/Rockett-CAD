import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createEmptyDocument,
  type EvaluateResult,
  type ExtrudeFeature,
  type PlaneFrame,
  type Profile,
} from "@rockett/shared";
import "../features/core";
import { extrude } from "../features/extrude";
import {
  featureCommand,
  featureParams,
  setFeatureParams,
} from "../commands/featureCommand";
import { useStore } from "../store";
import { dragPreview } from "../toolTargets";
import { FeatureGizmos } from "./featureGizmos";
import { sceneLayers } from "./sceneLayers";
import { worldToClient } from "./screen";

const baseline = useStore.getState();
const disposeOwners: Array<() => void> = [];
beforeEach(() => useStore.setState(baseline, true));
afterEach(() => {
  for (const dispose of disposeOwners.splice(0)) dispose();
  vi.restoreAllMocks();
  useStore.setState(baseline, true);
});

function setup(editing = false) {
  const sketch = {
    sketchId: "gizmo-sketch",
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
    } satisfies PlaneFrame,
    entities: [],
  };
  const profiles: Profile[] = [
    {
      id: "gizmo-profile",
      outer: [],
      holes: [],
      polygon: [0, 0, 6, 0, 6, 6, 0, 6],
      holePolygons: [],
      area: 36,
    },
  ];
  const evaluation: EvaluateResult = {
    bodies: [],
    featureStatuses: [],
    planes: [],
    kernelMs: 0,
    sketches: [
      {
        featureId: sketch.sketchId,
        frame: sketch.frame,
        entities: sketch.entities,
        profiles,
        solveStatus: "fully_constrained",
        dof: 0,
      },
    ],
  };
  const document = createEmptyDocument("gizmo-document", "Gizmo fixture");
  const feature: ExtrudeFeature = {
    id: "extrude-fixture",
    type: "extrude",
    name: "Extrude",
    suppressed: false,
    profiles: [{ sketchId: sketch.sketchId, profileId: profiles[0]!.id }],
    distance: 10,
    direction: "normal",
    operation: "newBody",
  };
  if (editing) document.features.push(feature);
  useStore.setState({ document, evaluation, active: null, selection: [] });
  featureCommand.enter("extrude", {
    selection: [
      {
        kind: "profile",
        sketchId: sketch.sketchId,
        profileId: profiles[0]!.id,
      },
    ],
    ...(editing && { editFeatureId: feature.id }),
  });
  const scene = new THREE.Scene();
  let camera: THREE.Camera = new THREE.OrthographicCamera(
    -40,
    40,
    30,
    -30,
    -1000,
    1000,
  );
  camera.position.set(40, 40, 40);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const layers = sceneLayers(scene);
  const host = {
    scene,
    get camera() {
      return camera;
    },
    worldPerPixel: () => 0.1,
    canvasRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    requestRender: vi.fn(),
    addLayer: layers.addLayer,
  };
  const label = vi.fn();
  const owner = new FeatureGizmos(host, label);
  disposeOwners.push(owner.dispose);
  const layer = scene.getObjectByName("featureGizmo")!;
  const at = (value: number, zero = false) => {
    const point = worldToClient(
      host.canvasRect(),
      host.camera,
      new THREE.Vector3(3, 3, value),
    );
    return {
      clientX: point.x,
      clientY: point.y,
      ctrlKey: zero,
      metaKey: false,
    };
  };
  return {
    owner,
    layer,
    host,
    label,
    evaluation,
    at,
    setCamera: (next: THREE.Camera) => {
      camera = next;
    },
  };
}

it("puts Extrude's KIT manipulator in a layer and empties it immediately on command exit", () => {
  const { owner, layer, at } = setup();
  expect(layer.children).toHaveLength(1);
  expect(
    layer.children[0]!.children.some((child) => child.userData.extrudeGizmo),
  ).toBe(true);
  const geometry = layer.children[0]!.children.find(
    (child) => child instanceof THREE.Mesh,
  )!;
  const dispose = vi.spyOn((geometry as THREE.Mesh).geometry, "dispose");
  expect(owner.down(at(10))).toBe(true);
  featureCommand.exit();
  expect(layer.children).toHaveLength(0);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(owner.move(at(5))).toBe(true);
  expect(owner.up()).toBe(true);
  expect(owner.up()).toBe(false);
});

it("consumes a cancelled gesture through release without changing the replacement command", () => {
  const { owner, at } = setup();
  expect(owner.down(at(10))).toBe(true);
  featureCommand.exit();
  featureCommand.enter("extrude");
  const replacement = useStore.getState().active;
  const selection = useStore.getState().selection;
  expect(owner.move(at(-8))).toBe(true);
  expect(owner.up()).toBe(true);
  expect(useStore.getState().active).toBe(replacement);
  expect(useStore.getState().selection).toBe(selection);
  expect(owner.move(at(-8))).toBe(false);
});

it("syncs typed distance and start offset without rebuilding for unrelated store updates", () => {
  const { layer } = setup();
  setFeatureParams({ distance: 10 });
  const group = layer.children[0]!;
  const ghost = group.children.find(
    (child) => child instanceof THREE.Mesh && child.renderOrder === 4,
  );
  expect(ghost).toBeDefined();
  const dispose = vi.spyOn((ghost as THREE.Mesh).geometry, "dispose");
  useStore.setState({ error: "Synthetic unrelated status" });
  expect(dispose).not.toHaveBeenCalled();
  expect(layer.children[0]).toBe(group);
  setFeatureParams({ distance: 4, startOffset: 2 });
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(layer.children[0]).toBe(group);
  expect(
    group.children.find(
      (child) => child instanceof THREE.Mesh && child.renderOrder === 4,
    ),
  ).not.toBe(ghost);
});

it("rebuilds once after release using source changes received during the drag", () => {
  const { owner, layer, at, evaluation } = setup();
  expect(owner.down(at(10))).toBe(true);
  const group = layer.children[0];
  const changed = structuredClone(evaluation);
  changed.sketches[0]!.frame.origin = [0, 0, 7];
  useStore.setState({ evaluation: changed });
  expect(layer.children[0]).toBe(group);
  expect(owner.up()).toBe(true);
  expect(layer.children[0]).not.toBe(group);
  const shaft = layer.children[0]!.children.find(
    (child) => child.userData.extrudeGizmo,
  );
  expect(shaft!.position.z).toBe(12);
});

it("refreshes held-base source changes and reads the current camera", () => {
  const { owner, layer, host, setCamera } = setup();
  const group = layer.children[0];
  owner.refresh(true);
  expect(layer.children[0]).not.toBe(group);
  const next = new THREE.OrthographicCamera(-40, 40, 30, -30, -1000, 1000);
  next.position.set(-40, 40, 40);
  next.lookAt(0, 0, 0);
  next.updateMatrixWorld();
  setCamera(next);
  const point = worldToClient(
    host.canvasRect(),
    next,
    new THREE.Vector3(3, 3, 10),
  );
  expect(
    owner.down({
      clientX: point.x,
      clientY: point.y,
      ctrlKey: false,
      metaKey: false,
    }),
  ).toBe(true);
});

it("keeps dragPreview as the edit preview owner for reverse, zero and release", () => {
  const during = vi.spyOn(dragPreview, "during").mockImplementation(() => {});
  const commit = vi.spyOn(dragPreview, "commit").mockImplementation(() => {});
  const { owner, at } = setup(true);
  expect(owner.down(at(10))).toBe(true);
  expect(owner.move(at(-4))).toBe(true);
  expect(featureParams()).toMatchObject({ distance: 4, direction: "reverse" });
  expect(during).toHaveBeenLastCalledWith(
    "extrude-fixture",
    expect.objectContaining({
      distance: 4,
      direction: "reverse",
      suppressed: false,
    }),
  );
  expect(owner.move(at(0, true))).toBe(true);
  expect(featureParams()).toMatchObject({ distance: 0, direction: "reverse" });
  expect(during).toHaveBeenLastCalledWith("extrude-fixture", {
    suppressed: true,
  });
  expect(owner.up()).toBe(true);
  expect(commit).toHaveBeenLastCalledWith("extrude-fixture", {
    suppressed: true,
  });
});

it("preserves symmetric and two-sided direction when a drag crosses the plane", () => {
  for (const direction of ["symmetric", "twoSided"] as const) {
    const { owner, at } = setup();
    setFeatureParams({ direction });
    expect(owner.down(at(10))).toBe(true);
    owner.move(at(-3));
    expect(featureParams()).toMatchObject({ distance: 3, direction });
    owner.up();
    owner.dispose();
  }
});

it("releases layer ownership and subscriptions on viewport teardown", () => {
  const { owner, layer, host, at } = setup();
  owner.down(at(10));
  owner.dispose();
  expect(layer.parent).toBeNull();
  expect(layer.children).toHaveLength(0);
  expect(owner.move(at(2))).toBe(false);
  useStore.setState({ selection: [] });
  owner.refresh(true);
  expect(host.scene.getObjectByName("featureGizmo")).toBeUndefined();
});

it("never delivers an old accepted gesture to a re-entered registered gizmo", () => {
  const { owner, at } = setup();
  expect(owner.down(at(10))).toBe(true);
  const factory = extrude.gizmo!;
  let move = vi.fn();
  let up = vi.fn();
  vi.spyOn(extrude, "gizmo").mockImplementation((context) => {
    const gizmo = factory(context)!;
    move = vi.fn(gizmo.move);
    up = vi.fn(gizmo.up);
    return {
      ...gizmo,
      get dragging() {
        return gizmo.dragging;
      },
      move,
      up,
    };
  });
  featureCommand.exit();
  featureCommand.enter("extrude", {
    selection: useStore.getState().evaluation!.sketches.flatMap((sketch) =>
      sketch.profiles.map((profile) => ({
        kind: "profile" as const,
        sketchId: sketch.featureId,
        profileId: profile.id,
      })),
    ),
  });
  expect(owner.move(at(-8))).toBe(true);
  expect(owner.up()).toBe(true);
  expect(move).not.toHaveBeenCalled();
  expect(up).not.toHaveBeenCalled();
});
