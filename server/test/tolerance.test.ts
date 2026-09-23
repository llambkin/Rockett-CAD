import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initKernel } from "../src/geometry/kernel.js";
import { startTestApp, type TestApp } from "./helpers/testApp.js";

const read = (file: string) =>
  readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

const bare = (source: string, literal: RegExp) =>
  source
    .split("\n")
    .filter((line) => !/^\s*(export )?const [A-Z_]+ = [\d.e-]+;$/.test(line))
    .filter((line) => literal.test(line));

describe("modelling tolerances", () => {
  it.each([
    "geometry/features.ts",
    "geometry/tangentEdges.ts",
    "geometry/sketchGeom.ts",
    "api/validate.ts",
  ])("%s names every 1e-6 and 1e-7 tolerance", (file) => {
    expect(bare(read(file), /(?<![\w.])(1e-6|1e-7|0\.000001)(?!\d)/)).toEqual(
      [],
    );
  });

  it("features.ts names its full-turn tolerance", () => {
    expect(bare(read("geometry/features.ts"), /1e-9/)).toEqual([]);
  });
});

describe("offset distance bound", () => {
  let app: TestApp;
  let projectId = "";

  beforeAll(async () => {
    await initKernel();
    app = await startTestApp();
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tolerance" }),
    });
    projectId = ((await res.json()) as { document: { id: string } }).document
      .id;
  }, 120_000);

  afterAll(() => app.close());

  const addSketch = (id: string, distance: number) =>
    app.request(`/api/projects/${projectId}/features`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: {
          id,
          type: "sketch",
          name: id,
          suppressed: false,
          plane: { kind: "origin", plane: "XY" },
          entities: [],
          constraints: [],
          offsets: [
            {
              id: `${id}-offset`,
              distance,
              sourceIds: ["source"],
              entityIds: [`${id}-out`],
              joinTolerance: 0,
            },
          ],
        },
      }),
    });

  it("accepts 5e-7 mm", async () => {
    expect((await addSketch("small", 5e-7)).status).toBe(200);
  });

  it("rejects 5e-8 mm with 400", async () => {
    const res = await addSketch("tiny", 5e-8);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "offset distance must be non-zero",
    });
  });
});
