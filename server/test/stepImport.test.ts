import { beforeAll, expect, it } from "vitest";
import { createEmptyDocument } from "@rockett/shared";
import { initKernel, volumeOf, getKernel } from "../src/geometry/kernel.js";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { readStep } from "../src/geometry/stepImport.js";
import { stepFixture } from "./helpers/stepFixture.js";
beforeAll(initKernel, 120000);

it("imports multiple B-Rep bodies, persists them, and supports downstream fillets", () => {
  const doc = createEmptyDocument("step-test", "Imported");
  doc.features = [
    {
      id: "step",
      type: "importStep",
      name: "Imported",
      filename: "fixture.step",
      data: stepFixture(true),
      suppressed: false,
    },
  ];
  doc.timelinePosition = 1;
  let engine = engineFor(doc.id),
    result = engine.evaluate(doc);
  expect(result.featureStatuses[0]).toEqual({
    featureId: "step",
    status: "ok",
  });
  expect(result.bodies).toHaveLength(2);
  expect(result.bodies[0].bbox.max).toEqual(
    [20, 30, 10].map((x) => expect.closeTo(x, 4)),
  );
  const state = engine.stateAt(doc);
  expect(volumeOf(state.bodies.get("b:step")!.shape)).toBeCloseTo(6000, 3);
  const names = result.bodies[0].faces.map((f) => f.name);
  dropEngine(doc.id);
  engine = engineFor(doc.id);
  result = engine.evaluate(JSON.parse(JSON.stringify(doc)));
  expect(result.bodies[0].faces.map((f) => f.name)).toEqual(names);
  doc.features.push({
    id: "fillet",
    type: "fillet",
    name: "Fillet",
    suppressed: false,
    edges: [
      {
        kind: "edge",
        bodyId: "b:step",
        edgeName: result.bodies[0].edges[0].name,
      },
    ],
    radius: 1,
  });
  doc.timelinePosition = 2;
  expect(engine.evaluate(doc).featureStatuses.at(-1)!.status).toBe("ok");
  expect(
    volumeOf(engine.stateAt(doc).bodies.get("b:step")!.shape),
  ).toBeLessThan(6000);
  dropEngine(doc.id);
});

it("rejects invalid STEP and cleans its temporary kernel file", () => {
  expect(() => readStep("ISO-10303-21;\nnot a STEP model")).toThrow();
  expect(
    getKernel()
      .FS.readdir("/")
      .filter((f: string) => f.endsWith(".step")),
  ).toEqual([]);
});

it("a file already at `/rockett-import.step` survives `readStep`", () => {
  const fs = getKernel().FS,
    file = "/rockett-import.step";
  fs.writeFile(file, "keep");
  readStep(stepFixture(false)).delete();
  expect(fs.analyzePath(file).exists).toBe(true);
  expect(fs.readFile(file, { encoding: "utf8" })).toBe("keep");
  fs.unlink(file);
  expect(fs.readdir("/").filter((f: string) => f.endsWith(".step"))).toEqual(
    [],
  );
});
