import * as THREE from "three";
import { Window } from "happy-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CadViewport } from "./CadViewport";
import { worldToClient } from "./screen";
import { clearSettings } from "../settings";
import { manyBodyPayloads } from "../../test/helpers/perfFixtures";
import {
  pickProviders,
  registerPickProvider,
  type PickProvider,
} from "./pickProviders";

vi.mock("three", async (load) => ({
  ...(await load<typeof import("three")>()),
  WebGLRenderer: (await import("../../test/helpers/fakeRenderer"))
    .FakeWebGLRenderer,
}));
let viewport: CadViewport;
let cleanups: (() => void)[];

beforeEach(() => {
  const window = new Window();
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("DOMRect", window.DOMRect);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  clearSettings();
  const container = document.createElement("div");
  Object.defineProperties(container, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  viewport = new CadViewport(container);
  viewport.setCamera({
    position: [5, 5, 100],
    target: [5, 5, 0],
    up: [0, 1, 0],
    projection: "orthographic",
  });
  viewport.zoom = 20;
  viewport.resize();
  cleanups = [];
});
afterEach(() => {
  for (const cleanup of cleanups.toReversed()) cleanup();
  viewport.dispose();
  clearSettings();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pick(point: THREE.Vector3, providers: readonly string[], depth = 0) {
  viewport.render();
  const at = worldToClient(viewport.canvasRect(), viewport.camera, point);
  return viewport.pick(at.x, at.y, providers, depth);
}
const corner = new THREE.Vector3(0, 0, 5);
const centre = new THREE.Vector3(4, 4, 5);

it("keeps visible box vertex, edge, face and body priorities and depth cycling", () => {
  const bodies = manyBodyPayloads(1, 1);
  viewport.syncBodies(bodies);
  expect(
    pick(corner, ["design.vertex", "design.edge", "design.face", "design.body"])
      ?.selection.kind,
  ).toBe("vertex");
  expect(
    pick(corner, ["design.edge", "design.face", "design.body"])?.selection.kind,
  ).toBe("edge");
  expect(pick(centre, ["design.face", "design.body"])?.selection.kind).toBe(
    "face",
  );
  expect(pick(centre, ["design.body"])?.selection.kind).toBe("body");
  expect(
    pick(corner, ["design.vertex", "design.edge", "design.face"], 2)?.selection
      .kind,
  ).toBe("edge");
  expect(pick(centre, ["design.face"], 999)?.selection.kind).toBe("face");
  expect(pick(centre, [])).toBeNull();
  viewport.syncBodies(bodies, new Set([bodies[0]!.bodyId]));
  expect(
    pick(corner, [
      "design.vertex",
      "design.edge",
      "design.face",
      "design.body",
    ]),
  ).toBeNull();
});

it("keeps a mapped face ahead of its body but falls back for unmapped triangles", () => {
  const body = manyBodyPayloads(1, 1)[0]!;
  viewport.syncBodies([{ ...body, faces: [] }]);
  expect(pick(centre, ["design.face"])).toBeNull();
  expect(pick(centre, ["design.face", "design.body"])?.selection.kind).toBe(
    "body",
  );
});

it.each([false, true])(
  "keeps equal-depth face and fallback body ties in body order, mapped first: %s",
  (mappedFirst) => {
    const mapped = manyBodyPayloads(1, 1)[0]!;
    const unmapped = {
      ...mapped,
      bodyId: "unmapped",
      meshKey: "unmapped",
      faces: [],
    };
    viewport.syncBodies(mappedFirst ? [mapped, unmapped] : [unmapped, mapped]);
    const objects = vi.spyOn(THREE.Raycaster.prototype, "intersectObject");
    const chosen = pick(centre, ["design.face", "design.body"]);
    expect(chosen?.selection).toEqual(
      mappedFirst
        ? {
            kind: "face",
            bodyId: mapped.bodyId,
            faceName: mapped.faces[1]!.name,
          }
        : { kind: "body", bodyId: unmapped.bodyId },
    );
    expect(objects).toHaveBeenCalledTimes(2);
    expect(pick(centre, ["design.body"])?.selection).toEqual({
      kind: "body",
      bodyId: mappedFirst ? mapped.bodyId : unmapped.bodyId,
    });
    expect(pick(centre, ["design.face"])?.selection).toEqual({
      kind: "face",
      bodyId: mapped.bodyId,
      faceName: mapped.faces[1]!.name,
    });
  },
);

function profile(id: string, area: number) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.position.set(5, 5, 5);
  mesh.userData = { sketchId: "sketch", profileId: id, area };
  viewport.sketches.group.add(mesh);
  return mesh;
}
function sketchPoint() {
  const points = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([centre]),
    new THREE.PointsMaterial(),
  );
  points.userData = {
    sketchId: "sketch",
    sketchEntityId: "point",
    isPoint: true,
  };
  viewport.sketches.group.add(points);
}
function sketchCurve() {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 4, 5),
      new THREE.Vector3(10, 4, 5),
    ]),
    new THREE.LineBasicMaterial(),
  );
  line.userData = { sketchId: "sketch", sketchEntityId: "curve" };
  viewport.sketches.group.add(line);
}

it("keeps sketch points before curves, curves before profiles and profiles before faces", () => {
  viewport.syncBodies(manyBodyPayloads(1, 1));
  profile("large", 100);
  profile("small", 10);
  sketchCurve();
  sketchPoint();
  expect(
    pick(centre, [
      "design.face",
      "sketch.profile",
      "sketch.entity",
      "sketch.point",
    ])?.selection.kind,
  ).toBe("sketchPoint");
  expect(
    pick(centre, ["design.face", "sketch.profile", "sketch.entity"])?.selection
      .kind,
  ).toBe("sketchEntity");
  expect(pick(centre, ["design.face", "sketch.profile"])?.selection).toEqual({
    kind: "profile",
    sketchId: "sketch",
    profileId: "small",
  });
  expect(pick(centre, ["sketch.profile"], 1)?.selection).toEqual({
    kind: "profile",
    sketchId: "sketch",
    profileId: "small",
  });
  expect(pick(centre, ["design.face"])?.selection.kind).toBe("face");
});

it("preserves screen-space line and point thresholds and distance rather than absolute priority", () => {
  sketchCurve();
  sketchPoint();
  const lineTolerance = viewport.worldPerPixel() * 7;
  expect(
    pick(centre.clone().add(new THREE.Vector3(0, lineTolerance * 0.9, 0)), [
      "sketch.entity",
    ])?.selection.kind,
  ).toBe("sketchEntity");
  expect(
    pick(centre.clone().add(new THREE.Vector3(0, lineTolerance * 1.1, 0)), [
      "sketch.entity",
    ]),
  ).toBeNull();
  expect(
    pick(centre.clone().add(new THREE.Vector3(0, lineTolerance * 1.3, 0)), [
      "sketch.point",
    ])?.selection.kind,
  ).toBe("sketchPoint");
  expect(
    pick(centre.clone().add(new THREE.Vector3(0, lineTolerance * 1.5, 0)), [
      "sketch.point",
    ]),
  ).toBeNull();
  viewport.syncBodies(manyBodyPayloads(1, 1));
  viewport.sketches.group.position.z = -10;
  expect(
    pick(centre, ["design.face", "sketch.entity", "sketch.point"])?.selection
      .kind,
  ).toBe("face");
});

it("keeps origin and construction planes behind solid geometry and respects origin visibility", () => {
  viewport.syncBodies(manyBodyPayloads(1, 1));
  viewport.syncConstructionPlanes(
    [
      {
        featureId: "plane",
        size: 20,
        frame: {
          origin: [0, 0, 5],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
        },
      },
    ],
    new Map([["plane", "Work plane"]]),
    new Set(["plane"]),
  );
  expect(
    pick(centre, ["design.face", "design.constructionPlane"])?.selection.kind,
  ).toBe("face");
  expect(pick(centre, ["design.constructionPlane"])?.selection).toEqual({
    kind: "plane",
    ref: { kind: "construction", featureId: "plane" },
    label: "Work plane",
  });
  expect(pick(centre, ["design.originPlane"])?.selection).toEqual({
    kind: "plane",
    ref: { kind: "origin", plane: "XY" },
    label: "XY Plane",
  });
  expect(
    pick(new THREE.Vector3(7, 0, 0), ["design.originAxis"])?.selection,
  ).toEqual({
    kind: "axis",
    axis: "X",
  });
  viewport.setOriginVisible(false);
  expect(pick(centre, ["design.originPlane"])).toBeNull();
  expect(pick(new THREE.Vector3(7, 0, 0), ["design.originAxis"])).toBeNull();
  expect(pick(centre, ["design.constructionPlane"])?.selection.kind).toBe(
    "plane",
  );
});

it("picks a registered extension, refuses duplicate and invalid priority, and disposes registration only", () => {
  const mesh = profile("borrowed", 10);
  const disposed = vi.spyOn(mesh.geometry, "dispose");
  const provider: PickProvider = {
    id: "test.pick",
    kind: "test.selection",
    priority: 3,
    pick: (raycaster) =>
      raycaster.intersectObject(mesh, false).map((hit) => ({
        selection: { kind: "test.selection", id: "hit" },
        distance: hit.distance,
        point: hit.point,
      })),
  };
  const dispose = registerPickProvider(provider);
  cleanups.push(dispose);
  expect(pick(centre, [provider.id])?.selection).toEqual({
    kind: "test.selection",
    id: "hit",
  });
  expect(pick(centre, ["unregistered"])).toBeNull();
  expect(() => registerPickProvider(provider)).toThrow("already has");
  expect(() =>
    registerPickProvider({ ...provider, id: "invalid", priority: NaN }),
  ).toThrow("finite priority");
  dispose();
  dispose();
  expect(pick(centre, [provider.id])).toBeNull();
  expect(disposed).not.toHaveBeenCalled();
  const stop = registerPickProvider(provider);
  cleanups.push(stop);
  dispose();
  expect(pick(centre, [provider.id])?.selection.kind).toBe("test.selection");
  expect(pickProviders()).toHaveLength(12);
});

it("shares each body and overlay raycast within one pick and recomputes on the next", () => {
  viewport.syncBodies(manyBodyPayloads(1, 1));
  profile("profile", 10);
  sketchCurve();
  sketchPoint();
  const objects = vi.spyOn(THREE.Raycaster.prototype, "intersectObject");
  const groups = vi.spyOn(THREE.Raycaster.prototype, "intersectObjects");
  const providers = [
    "design.face",
    "design.body",
    "sketch.profile",
    "sketch.entity",
    "sketch.point",
  ];
  expect(pick(centre, providers)?.selection.kind).toBe("sketchPoint");
  expect(objects).toHaveBeenCalledTimes(1);
  expect(groups).toHaveBeenCalledTimes(1);
  viewport.sketches.clear();
  expect(pick(centre, providers)?.selection.kind).toBe("face");
  expect(objects).toHaveBeenCalledTimes(2);
  expect(groups).toHaveBeenCalledTimes(2);
});
