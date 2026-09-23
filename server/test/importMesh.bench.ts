import { beforeAll, expect, test } from "vitest";
import { createEmptyDocument, type EvaluateResult } from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import { record, SAMPLES, SLOW_SAMPLES } from "./helpers/perfFixtures.js";
import { binaryStl, sphere } from "./helpers/meshFixtures.js";

beforeAll(initKernel, 120_000);

test.for([
  { name: "import mesh 10k", slices: 100, rings: 51, plan: SAMPLES },
  { name: "import mesh 100k", slices: 500, rings: 101, plan: SLOW_SAMPLES },
])(
  "$name",
  { timeout: 1_800_000 },
  async ({ name, slices, rings, plan }, { bench }) => {
    const mesh = sphere(slices, rings);
    const doc = {
      ...createEmptyDocument(`bench-${slices}`, name),
      features: [
        {
          id: "mesh",
          type: "importMesh" as const,
          name: "Sphere.stl",
          suppressed: false,
          filename: "Sphere.stl",
          format: "stl" as const,
          data: binaryStl(mesh).toString("base64"),
        },
      ],
      timelinePosition: 1,
    };
    let runs = 0;
    let result: EvaluateResult | undefined;
    record(
      name,
      await bench(name, { async: false }, () => {
        const id = `bench-mesh-${slices}-${++runs}`;
        result = engineFor(id).evaluate(doc);
        dropEngine(id);
      }).run(plan),
      plan.iterations,
    );
    expect(mesh.triangles).toHaveLength(slices * (rings - 1) * 2);
    expect(result?.featureStatuses).toEqual([
      { featureId: "mesh", status: "ok" },
    ]);
    expect(result?.bodies).toHaveLength(1);
  },
);
