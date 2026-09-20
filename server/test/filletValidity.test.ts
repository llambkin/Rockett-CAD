import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { CadDocument, FilletFeature } from "@rockett/shared";
import { engineFor, dropEngine } from "../src/geometry/engine.js";
import { getKernel, initKernel, volumeOf } from "../src/geometry/kernel.js";

beforeAll(async () => { await initKernel(); }, 120_000);
afterAll(() => dropEngine("fillet-validity-regression"));

it("rejects a completed but invalid rim fillet and preserves the previous solid", () => {
  const { document: doc }: { document: CadDocument } = JSON.parse(
    readFileSync(new URL("./fixtures/invalid-top-fillet.json", import.meta.url), "utf8")
  );
  const engine = engineFor("fillet-validity-regression");
  const before = engine.evaluate(doc, doc.features.length - 1);
  expect(before.featureStatuses.slice(0, -1).every(s => s.status === "ok")).toBe(true);
  const previous = [...engine.stateAt(doc, doc.features.length - 1).bodies.values()][0];
  const volume = volumeOf(previous.shape);
  const fillet = doc.features.at(-1) as FilletFeature;
  for (const radius of [2, 0.5]) {
    fillet.radius = radius;
    const result = engine.evaluate(doc);
    expect(result.featureStatuses.at(-1)).toMatchObject({
      featureId: fillet.id, status: "error", error: expect.stringContaining("invalid geometry"),
    });
    expect(result.bodies).toEqual(before.bodies);
    const retained = [...engine.stateAt(doc).bodies.values()][0];
    expect(volumeOf(retained.shape)).toBeCloseTo(volume, 6);
    const check = new (getKernel().BRepCheck_Analyzer)(retained.shape, true, false);
    try { expect(check.IsValid_2()).toBe(true); } finally { check.delete(); }
  }
}, 120_000);
