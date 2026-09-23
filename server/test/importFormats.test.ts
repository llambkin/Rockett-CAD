import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createEmptyDocument } from "@rockett/shared";
import {
  getKernel,
  initKernel,
  progress,
  volumeOf,
  type Shape,
} from "../src/geometry/kernel.js";
import { engineFor } from "../src/geometry/engine.js";
import { stepFixture } from "./helpers/stepFixture.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";
import { trackRevisions } from "./helpers/revisions.js";

const BOX_VOLUME = 20 * 30 * 10;

function written(extension: string, write: (box: Shape, file: string) => void) {
  const k = getKernel(),
    file = `/fixture.${extension}`,
    box = new k.BRepPrimAPI_MakeBox_2(20, 30, 10);
  try {
    write(box.Shape(), file);
    return k.FS.readFile(file, { encoding: "utf8" }) as string;
  } finally {
    box.delete();
    if (k.FS.analyzePath(file).exists) k.FS.unlink(file);
  }
}

const igesBox = () =>
  written("igs", (box, file) => {
    const k = getKernel(),
      writer = new k.IGESControl_Writer_2("MM", 1);
    try {
      if (!writer.AddShape(box, progress()) || !writer.Write_2(file, false))
        throw new Error("IGES fixture export failed");
    } finally {
      writer.delete();
    }
  });

const brepBox = () =>
  written("brep", (box, file) => {
    if (!getKernel().BRepTools.Write_3(box, file, progress()))
      throw new Error("BREP fixture export failed");
  });

let app: TestApp;
const send = trackRevisions((url, init) => app.request(url, init));

beforeAll(async () => {
  await initKernel();
  app = await startTestApp();
}, 120_000);

afterAll(() => app?.close());

function upload(url: string, contents: string, filename: string) {
  const form = new FormData();
  form.append("file", new Blob([contents]), filename);
  return send(`/api${url}`, { method: "POST", body: form });
}

describe.each([
  { label: "IGES", filename: "Box.igs", source: igesBox },
  { label: "IGES", filename: "Box.IGES", source: igesBox },
  { label: "BREP", filename: "Box.brep", source: brepBox },
])("$filename import", ({ label, filename, source }) => {
  it("starts a project holding one solid of the box volume", async () => {
    const response = await upload("/projects/import-step", source(), filename);
    expect(response.status).toBe(200);
    const { document, evaluation } = await response.json();
    expect(document.name).toBe("Box");
    expect(evaluation.featureStatuses).toEqual([
      { featureId: document.features[0].id, status: "ok" },
    ]);
    expect(evaluation.bodies).toHaveLength(1);
    const solid = engineFor(document.id)
      .stateAt(await app.store.load(document.id))
      .bodies.get(`b:${document.features[0].id}`)!.shape;
    expect(Math.abs(volumeOf(solid) / BOX_VOLUME - 1)).toBeLessThan(1e-6);
  });

  it.each([
    ["an empty", ""],
    ["a corrupt", "not a CAD file\n"],
  ])(`rejects ${label} as %s file and changes nothing`, async (_, bytes) => {
    const created = await send("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Target" }),
    });
    const { document } = await created.json();
    const projects = await app.store.list();
    const into = await upload(
      `/projects/${document.id}/import-step`,
      bytes,
      filename,
    );
    expect(into.status).toBe(400);
    expect((await into.json()).error).toBe(
      `No solid found in the ${label} file.`,
    );
    const fresh = await upload("/projects/import-step", bytes, filename);
    expect(fresh.status).toBe(400);
    expect(await app.store.load(document.id)).toEqual(document);
    expect(await app.store.list()).toEqual(projects);
  });
});

it("evaluates a STEP import saved before imports had a format", async () => {
  const doc = {
    ...createEmptyDocument("legacystep01", "Legacy STEP"),
    features: [
      {
        id: "step",
        type: "importStep",
        name: "Fixture.step",
        suppressed: false,
        filename: "Fixture.step",
        data: stepFixture(),
      },
    ],
    timelinePosition: 1,
  };
  const dir = path.join(app.dataDir, "projects", doc.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "document.json"),
    JSON.stringify({ ...doc, schemaVersion: 5 }),
  );
  const response = await send(`/api/projects/${doc.id}/evaluate`);
  expect(response.status).toBe(200);
  const evaluation = await response.json();
  expect(evaluation.featureStatuses).toEqual([
    { featureId: "step", status: "ok" },
  ]);
  expect(evaluation.bodies).toHaveLength(1);
});
