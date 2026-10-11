import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeMesh, type Feature, type MeshPayload } from "@rockett/shared";
import { watchProject } from "../api";
import { previewTints } from "../livePreview";
import { fillGhost } from "./ghostGeometry";
import { meshes, meshOf, MeshRegistry, type LayerBody } from "./meshes";

const hashOf = (n: number) => n.toString(16).padStart(64, "0");

function shape(size: number): MeshPayload {
  return {
    positions: [0, 0, 0, size, 0, 0, 0, size, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
    faces: [
      {
        name: `f${size}`,
        start: 0,
        count: 3,
        surface: { type: "plane" },
        area: size,
      },
    ] as MeshPayload["faces"],
    edges: [],
    vertices: [],
  };
}

const head = (n: number, bodyId = `b${n}`): LayerBody => ({
  bodyId,
  name: bodyId,
  meshKey: `k${n}`,
  mesh: { hash: hashOf(n), bytes: 1 },
  bbox: { min: [0, 0, 0], max: [n, n, 0] },
});

let requests: string[];
let replies: Map<string, () => Response>;
const settle = () => new Promise((done) => setTimeout(done));

beforeEach(() => {
  requests = [];
  replies = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requests.push(url);
      const reply = replies.get(url.split("/").at(-1)!);
      return reply?.() ?? new Response(null, { status: 404 });
    }),
  );
  meshes.useProject("p1");
});

afterEach(() => {
  meshes.useProject(undefined);
  watchProject(null);
  vi.unstubAllGlobals();
});

const serve = (n: number, mesh = shape(n)) =>
  replies.set(hashOf(n), () => new Response(encodeMesh(mesh)));

it("fetches each hash once and announces its arrival", async () => {
  serve(1);
  const heard = vi.fn();
  const stop = meshes.subscribe(heard);
  const before = meshes.current();

  expect(meshOf(head(1))).toBeUndefined();
  expect(meshOf(head(1, "copy"))).toBeUndefined();
  await settle();

  expect(requests).toEqual([`/api/projects/p1/meshes/${hashOf(1)}`]);
  expect(meshOf(head(1))?.faces[0]?.name).toBe("f1");
  expect(heard).toHaveBeenCalledOnce();
  expect(meshes.current()).toBe(before + 1);
  stop();
});

it("fetches preview and rolled-back hashes through the same route", async () => {
  serve(2);
  serve(3);
  const preview = head(2);
  const rolledBack = head(3);

  meshOf(preview);
  meshOf(rolledBack);
  await settle();

  expect(requests.toSorted()).toEqual(
    [hashOf(2), hashOf(3)].map((h) => `/api/projects/p1/meshes/${h}`),
  );
  expect(meshOf(preview)?.faces[0]?.name).toBe("f2");
  expect(meshOf(rolledBack)?.faces[0]?.name).toBe("f3");
});

it("keeps the newest meshes within its number budget", async () => {
  const registry = new MeshRegistry(45);
  registry.useProject("p1");
  for (const n of [1, 2, 3]) {
    serve(n);
    registry.get(head(n));
    await settle();
  }

  expect(registry.get(head(1))).toBeUndefined();
  expect(registry.get(head(2))?.faces[0]?.name).toBe("f2");
  expect(registry.get(head(3))?.faces[0]?.name).toBe("f3");
  registry.useProject(undefined);
});

it("draws inline bodies without fetching or caching them", async () => {
  const registry = new MeshRegistry(21);
  registry.useProject("p1");
  serve(1);
  registry.get(head(1));
  await settle();
  const inline = { ...head(7), ...shape(7) };

  expect(registry.get(inline)).toBe(inline);
  expect(registry.get(head(1))?.faces[0]?.name).toBe("f1");
  expect(registry.get(head(7))).toBeUndefined();
  await settle();

  expect(requests).toEqual(
    [hashOf(1), hashOf(7)].map((h) => `/api/projects/p1/meshes/${h}`),
  );
  registry.useProject(undefined);
});

it("a 404 leaves the session alone and waits for the next payload", async () => {
  const onMissing = vi.fn();
  watchProject({
    id: "p1",
    onMissing,
    onDocument: () => {},
    checkImage: async () => {},
  });

  expect(meshOf(head(4))).toBeUndefined();
  await settle();
  expect(requests).toHaveLength(1);

  meshOf(head(4));
  await settle();
  expect(requests).toHaveLength(1);

  serve(4);
  meshes.retry();
  meshOf(head(4));
  await settle();
  expect(requests).toHaveLength(2);
  expect(meshOf(head(4))).toBeDefined();
  expect(onMissing).not.toHaveBeenCalled();
});

it("tints and ghosts nothing before a mesh arrives and the right faces after", async () => {
  serve(5);
  const feature = { type: "extrude", operation: "join" } as Feature;
  const geom = new THREE.BufferGeometry();
  const ranges = [{ start: 0, count: 3 }];

  expect(previewTints(feature, [], [head(5)]).size).toBe(0);
  fillGhost(geom, head(5), ranges);
  expect(geom.drawRange.count).toBe(0);
  await settle();

  expect(previewTints(feature, [], [head(5)]).get("b5")?.ranges).toEqual(
    ranges,
  );
  fillGhost(geom, head(5), ranges);
  expect(geom.drawRange.count).toBe(3);
});

it("empties a ghost while its next mesh is missing and refills it on arrival", async () => {
  serve(6);
  const geom = new THREE.BufferGeometry();
  const ranges = [{ start: 0, count: 3 }];
  fillGhost(geom, { ...head(1), ...shape(1) }, ranges);
  expect(geom.drawRange.count).toBe(3);

  fillGhost(geom, head(6), ranges);
  expect(geom.drawRange.count).toBe(0);
  await settle();

  fillGhost(geom, head(6), ranges);
  expect(geom.drawRange.count).toBe(3);
  expect(geom.getAttribute("position").getX(1)).toBe(6);
});
