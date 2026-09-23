import { afterAll, beforeAll, expect, it } from "vitest";
import { strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import {
  bboxOf,
  getKernel,
  initKernel,
  pnt,
  solids,
  volumeOf,
  type Shape,
} from "../src/geometry/kernel.js";
import { engineFor } from "../src/geometry/engine.js";
import { ShapeMap } from "../src/geometry/shapeMap.js";
import { write3mf } from "../src/geometry/exporters.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";
import { cube } from "./helpers/meshFixtures.js";

let app: TestApp;

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

function upload(contents: Buffer, filename: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(contents)]), filename);
  return app.request("/api/projects/import-step", {
    method: "POST",
    body: form,
  });
}

async function importedBodies(
  contents: Buffer,
  filename: string,
): Promise<Shape[]> {
  const response = await upload(contents, filename);
  expect(response.status).toBe(200);
  const { document, evaluation } = await response.json();
  const feature = document.features[0],
    state = engineFor(document.id).stateAt(await app.store.load(document.id));
  expect(feature).toMatchObject({ type: "importMesh", format: "3mf" });
  expect(evaluation.featureStatuses).toEqual([
    { featureId: feature.id, status: "ok" },
  ]);
  return evaluation.bodies.map(
    ({ bodyId }: { bodyId: string }) => state.bodies.get(bodyId)!.shape,
  );
}

const near = (...values: number[]) => values.map((v) => expect.closeTo(v, 4));

const measured = (shape: Shape) => ({
  volume: volumeOf(shape),
  box: bboxOf(shape),
});

function box(x: number, size: number) {
  const k = getKernel(),
    make = new k.BRepPrimAPI_MakeBox_3(pnt(x, 0, 0), size, size, size);
  return {
    body: {
      bodyId: `box${x}`,
      shape: make.Shape(),
      names: new ShapeMap<string>(),
    },
    name: `Box ${x}`,
  };
}

it("imports two cubes from the 3MF exporter as two solids in place", async () => {
  const shapes = await importedBodies(
    write3mf([box(0, 10), box(30, 5)]),
    "Two cubes.3mf",
  );
  expect(shapes.map((shape) => solids(shape).length)).toEqual([1, 1]);
  expect(shapes.map(measured)).toEqual([
    {
      volume: expect.closeTo(1000, 6),
      box: { min: near(0, 0, 0), max: near(10, 10, 10) },
    },
    {
      volume: expect.closeTo(125, 6),
      box: { min: near(30, 0, 0), max: near(35, 5, 5) },
    },
  ]);
});

it("scales an inch file by 25.4 and applies the build item transform", async () => {
  const { vertices, triangles } = cube(1),
    model =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
      `<resources><object id="7" type="model"><mesh><vertices>` +
      vertices
        .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`)
        .join("") +
      `</vertices><triangles>` +
      triangles
        .map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
        .join("") +
      `</triangles></mesh></object></resources>` +
      `<build><item objectid="7" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></build></model>`;
  const shapes = await importedBodies(
    Buffer.from(zipSync({ "3D/3dmodel.model": strToU8(model) })),
    "Inch.3mf",
  );
  expect(shapes.map(measured)).toEqual([
    {
      volume: expect.closeTo(25.4 ** 3, 6),
      box: { min: near(50.8, 0, 0), max: near(76.2, 25.4, 25.4) },
    },
  ]);
});

it("rejects a zip entry that expands past 256 MB and changes nothing", async () => {
  const chunks: Uint8Array[] = [],
    zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    }),
    entry = new ZipDeflate("3D/3dmodel.model", { level: 1 }),
    zeros = new Uint8Array(1024 * 1024);
  zip.add(entry);
  for (let i = 0; i <= 256; i++) entry.push(zeros, i === 256);
  zip.end();
  const bomb = Buffer.concat(chunks),
    projects = await app.store.list();
  expect(bomb.length).toBeLessThan(1024 * 1024);
  const response = await upload(bomb, "Bomb.3mf");
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe(
    "The 3MF file expands past 256 MB, the limit.",
  );
  expect(await app.store.list()).toEqual(projects);
}, 60_000);
