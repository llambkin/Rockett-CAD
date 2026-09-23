import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initKernel, solids, volumeOf } from "../src/geometry/kernel.js";
import { engineFor } from "../src/geometry/engine.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";
import { asciiStl, binaryStl, cube, strip } from "./helpers/meshFixtures.js";

const OBJ_CUBE = `# quads, as most exporters write them
v 0 0 0
v 10 0 0
v 10 10 0
v 0 10 0
v 0 0 10
v 10 0 10
v 10 10 10
v 0 10 10
f 1 4 3 2
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
f 5 6 7 8
`;

let app: TestApp;

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

function upload(
  url: string,
  contents: string | Buffer<ArrayBuffer>,
  filename: string,
) {
  const form = new FormData();
  form.append("file", new Blob([contents]), filename);
  return app.request(`/api${url}`, { method: "POST", body: form });
}

async function imported(
  contents: string | Buffer<ArrayBuffer>,
  filename: string,
) {
  const response = await upload("/projects/import-step", contents, filename);
  expect(response.status).toBe(200);
  const { document, evaluation } = await response.json();
  const feature = document.features[0];
  const body = engineFor(document.id)
    .stateAt(await app.store.load(document.id))
    .bodies.get(`b:${feature.id}`)!;
  return { feature, evaluation, shape: body.shape };
}

describe.each([
  {
    label: "a binary STL",
    filename: "Cube.stl",
    source: () => binaryStl(cube()),
  },
  {
    label: "an ASCII STL",
    filename: "Cube.STL",
    source: () => asciiStl(cube()),
  },
  { label: "an OBJ", filename: "Cube.obj", source: () => OBJ_CUBE },
])("$label cube", ({ filename, source }) => {
  it("imports as one solid of volume 1000", async () => {
    const { feature, evaluation, shape } = await imported(source(), filename);
    expect(feature).toMatchObject({
      type: "importMesh",
      filename,
      format: filename.slice(-3).toLowerCase(),
    });
    expect(evaluation.featureStatuses).toEqual([
      { featureId: feature.id, status: "ok" },
    ]);
    expect(evaluation.bodies).toHaveLength(1);
    expect(solids(shape)).toHaveLength(1);
    expect(Math.abs(volumeOf(shape) / 1000 - 1)).toBeLessThan(1e-6);
  });
});

it("imports an open mesh as a shell with a warning", async () => {
  const open = cube();
  open.triangles = open.triangles.slice(0, -2);
  const { feature, evaluation, shape } = await imported(
    binaryStl(open),
    "Open.stl",
  );
  expect(evaluation.featureStatuses).toEqual([
    {
      featureId: feature.id,
      status: "warning",
      warning:
        "The STL mesh is open at 4 edges, so it imported as a shell, not a solid.",
    },
  ]);
  expect(evaluation.bodies).toHaveLength(1);
  expect(solids(shape)).toHaveLength(0);
});

it("rejects 200,001 triangles with the count and changes nothing", async () => {
  const projects = await app.store.list();
  const response = await upload(
    "/projects/import-step",
    binaryStl(strip(200_001)),
    "Dense.stl",
  );
  expect(response.status).toBe(400);
  expect((await response.json()).error).toBe(
    "The STL mesh has 200,001 triangles; the limit is 200,000.",
  );
  expect(await app.store.list()).toEqual(projects);
});
