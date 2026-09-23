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

let server: Server | undefined;
let apiUrl = "";
let store: ProjectStore;

beforeAll(async () => {
  await initKernel();
  store = new ProjectStore(
    await fs.mkdtemp(path.join(os.tmpdir(), "rockett-export-")),
  );
  await store.init();
  const app = express();
  app.use("/api", createApiRouter(store));
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

describe("exporters", () => {
  it("writes a valid binary STL", () => {
    dropEngine("e1");
    const doc = boxDoc("e1");
    const engine = engineFor("e1");
    let result = engine.evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0].profileId =
      result.sketches[0].profiles[0].id;
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
    (doc.features[1] as ExtrudeFeature).profiles[0].profileId =
      result.sketches[0].profiles[0].id;
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

    const model = strFromU8(files["3D/3dmodel.model"]);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="MainBody"');
    expect(model).toContain("<vertex ");
    expect(model).toContain("<triangle ");
    expect(model).toContain('<item objectid="1"/>');
  });

  it("export request validation", async () => {
    const { id } = await store.create("Box");
    const doc = boxDoc(id);
    const result = engineFor(id).evaluate(doc, 1);
    (doc.features[1] as ExtrudeFeature).profiles[0].profileId =
      result.sketches[0].profiles[0].id;
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

    await rejects({ format: "stl" }, /bodyIds must be an array/);
    await rejects({ format: "stl", bodyIds: "b:ext1" }, /bodyIds must be/);
    await rejects({ format: "stl", bodyIds: [5, null] }, /strings: 5, null/);
    await rejects(
      { format: "stl", bodyIds: ["b:ext1", "b:gone", "b:lost"] },
      /not in the model: b:gone, b:lost/,
    );
    await rejects(
      { format: "stl", bodyIds: [], quality: "fine" },
      /quality must be a finite number/,
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
