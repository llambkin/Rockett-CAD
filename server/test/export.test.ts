import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { unzipSync, strFromU8 } from "fflate";
import type { ExtrudeFeature } from "@rockett/shared";
import { createEmptyDocument } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { write3mf, writeStl } from "../src/geometry/exporters.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { createApiRouter } from "../src/api/routes.js";
import { FolderStore } from "../src/store/folderStore.js";
import { LocalStorage } from "../src/store/storage.js";
import { expectEvidence } from "./helpers/interopEvidence.js";
import { filletedCube } from "./helpers/solidFixtures.js";

let server: Server | undefined;
let apiUrl = "";
let store: ProjectStore;

beforeAll(async () => {
  await initKernel();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-export-"));
  const storage = new LocalStorage(dir, fs);
  store = new ProjectStore(storage);
  const app = express();
  app.use("/api", createApiRouter(store, new FolderStore(storage)));
  const listening = app.listen(0);
  await new Promise((resolve) => listening.once("listening", resolve));
  server = listening;
  apiUrl = `http://127.0.0.1:${(listening.address() as AddressInfo).port}/api`;
}, 120_000);

afterAll(() => {
  server?.close();
});

function boxDoc(id: string) {
  const doc = createEmptyDocument(id, "Box");
  doc.features = [
    {
      id: "sk1",
      type: "sketch",
      name: "Sketch1",
      suppressed: false,
      plane: { kind: "origin", plane: "XY" },
      entities: [
        { id: "pa", kind: "point", x: 0, y: 0 },
        { id: "pb", kind: "point", x: 20, y: 0 },
        { id: "pc", kind: "point", x: 20, y: 20 },
        { id: "pd", kind: "point", x: 0, y: 20 },
        { id: "l1", kind: "line", p1: "pa", p2: "pb" },
        { id: "l2", kind: "line", p1: "pb", p2: "pc" },
        { id: "l3", kind: "line", p1: "pc", p2: "pd" },
        { id: "l4", kind: "line", p1: "pd", p2: "pa" },
      ],
      constraints: [],
    },
    {
      id: "ext1",
      type: "extrude",
      name: "Extrude1",
      suppressed: false,
      profiles: [{ sketchId: "sk1", profileId: "" }],
      distance: 10,
      direction: "normal",
      operation: "newBody",
    } as ExtrudeFeature,
  ];
  doc.timelinePosition = 2;
  return doc;
}

function meshOf3mf(data: Buffer) {
  const model = strFromU8(unzipSync(new Uint8Array(data))["3D/3dmodel.model"]!);
  const vertices = [
    ...model.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
  const triangles = [
    ...model.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
  return { vertices, triangles };
}

function expectClosedOutward(mesh: ReturnType<typeof meshOf3mf>) {
  const directed = new Map<string, number>();
  for (const [a, b, c] of mesh.triangles)
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const)
      directed.set(`${p},${q}`, (directed.get(`${p},${q}`) ?? 0) + 1);
  const unpaired = [...directed].filter(([edge, count]) => {
    const [p, q] = edge.split(",");
    return p === q || count !== 1 || directed.get(`${q},${p}`) !== 1;
  });
  expect(unpaired).toEqual([]);
  let volume = 0;
  for (const [a, b, c] of mesh.triangles) {
    const [p, q, r] = [a, b, c].map((i) => mesh.vertices[i]!);
    volume +=
      (p![0] * (q![1] * r![2] - q![2] * r![1]) +
        p![1] * (q![2] * r![0] - q![0] * r![2]) +
        p![2] * (q![0] * r![1] - q![1] * r![0])) /
      6;
  }
  return volume;
}

describe("exporters", () => {
  it("writes a valid binary STL", () => {
    dropEngine("e1");
    const doc = boxDoc("e1");
    const engine = engineFor("e1");
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0]!.profileId =
      result.sketches[0]!.profiles[0]!.id;
    engine.evaluate(doc);
    const state = engine.stateAt(doc);
    const stl = writeStl([...state.bodies.values()], 0.1);

    const triCount = stl.readUInt32LE(80);
    expect(stl.length).toBe(84 + triCount * 50);
    expect(triCount).toBeGreaterThanOrEqual(12); // a box is at least 12 triangles

    // Verify all vertices are within the expected bounding box
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (let t = 0; t < triCount; t++) {
      const base = 84 + t * 50 + 12;
      for (let v = 0; v < 3; v++) {
        const x = stl.readFloatLE(base + v * 12);
        const z = stl.readFloatLE(base + v * 12 + 8);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
    expect(minX).toBeCloseTo(0, 4);
    expect(maxX).toBeCloseTo(20, 4);
    expect(minZ).toBeCloseTo(0, 4);
    expect(maxZ).toBeCloseTo(10, 4);
  });

  it("writes a valid 3MF package with named objects", () => {
    dropEngine("e2");
    const doc = boxDoc("e2");
    const engine = engineFor("e2");
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0]!.profileId =
      result.sketches[0]!.profiles[0]!.id;
    engine.evaluate(doc);
    const state = engine.stateAt(doc);
    const bodies = [...state.bodies.values()].map((b) => ({
      body: b,
      name: "MainBody",
    }));
    const data = write3mf(bodies, 0.1);

    const files = unzipSync(new Uint8Array(data));
    expect(Object.keys(files)).toContain("[Content_Types].xml");
    expect(Object.keys(files)).toContain("_rels/.rels");
    expect(Object.keys(files)).toContain("3D/3dmodel.model");

    const model = strFromU8(files["3D/3dmodel.model"]!);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="MainBody"');
    expect(model).toContain("<vertex ");
    expect(model).toContain("<triangle ");
    expect(model).toContain('<item objectid="1"/>');
    const mesh = meshOf3mf(data);
    expect([mesh.vertices.length, mesh.triangles.length]).toEqual([8, 12]);
    expect(expectClosedOutward(mesh)).toBeCloseTo(4000, 6);
    expectEvidence("box.3mf", data);
  });

  it("writes a filleted box as one closed outward mesh", () => {
    const mesh = meshOf3mf(write3mf([{ body: filletedCube(5, 1), name: "F" }]));
    const exact = 125 - 36 * (1 - Math.PI / 4) - 8 * (1 - Math.PI / 6);
    const volume = expectClosedOutward(mesh);
    expect(volume / exact).toBeGreaterThan(0.99);
    expect(volume / exact).toBeLessThan(1);
  });

  it("export request validation", async () => {
    const { id } = await store.create("Box");
    const doc = boxDoc(id);
    const result = engineFor(id).evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0]!.profileId =
      result.sketches[0]!.profiles[0]!.id;
    await store.save(doc);
    const post = (body: unknown) =>
      fetch(`${apiUrl}/projects/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const rejects = async (body: unknown, error: RegExp) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(error);
    };

    await rejects({ format: "stl" }, /required properties bodyIds/);
    await rejects({ format: "stl", bodyIds: "b:ext1" }, /bodyIds must be/);
    await rejects(
      { format: "stl", bodyIds: [5, null] },
      /bodyIds.0 must be string/,
    );
    await rejects(
      { format: "stl", bodyIds: ["b:ext1", "b:gone", "b:lost"] },
      /not in the model: b:gone, b:lost/,
    );
    await rejects(
      { format: "stl", bodyIds: [], quality: "fine" },
      /quality must be number/,
    );

    const res = await post({
      format: "stl",
      bodyIds: ["b:ext1"],
      quality: 0.1,
    });
    expect(res.status).toBe(200);
    const stl = Buffer.from(await res.arrayBuffer());
    expect(stl.readUInt32LE(80)).toBeGreaterThanOrEqual(12);
  });
});
