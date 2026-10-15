import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  SCHEMA_VERSION,
  type Feature,
  type SketchFeature,
  ValidationError,
} from "@rockett/shared";
import { validateFeature, validateDocument } from "../src/api/validate.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { LocalStorage } from "../src/store/storage.js";

function sketch(value: number): SketchFeature {
  return {
    id: "sk1",
    type: "sketch",
    name: "Sketch1",
    suppressed: false,
    plane: { kind: "origin", plane: "XY" },
    entities: [
      { id: "a", kind: "point", x: 0, y: 0 },
      { id: "b", kind: "point", x: 8.6603, y: 5 },
      { id: "l1", kind: "line", p1: "a", p2: "b" },
    ],
    constraints: [
      { id: "len", type: "length", line: "l1", value: 10 },
      { id: "ang", type: "lineAngle", line: "l1", value },
    ],
  };
}

describe("line angle constraint", () => {
  it("accepts angles in (-180, 180] and rejects the rest", () => {
    for (const value of [30, 180, -179.5, 0]) {
      expect(() => validateFeature(sketch(value))).not.toThrow();
    }
    for (const value of [-180, 181, Number.NaN]) {
      expect(() => validateFeature(sketch(value))).toThrow(ValidationError);
    }
    const noLine: Feature = {
      ...sketch(30),
      constraints: [{ id: "ang", type: "lineAngle", line: "", value: 30 }],
    };
    expect(() => validateFeature(noLine)).toThrow(ValidationError);
  });

  it("migrates a schema 4 project to 5 and round-trips the angle", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-angle-"));
    const store = new ProjectStore(new LocalStorage(dir, fs), validateDocument);
    const legacy = {
      ...createEmptyDocument("legacy4", "Legacy"),
      schemaVersion: 4,
      features: [{ ...sketch(30), constraints: [] }],
      timelinePosition: 1,
    };
    const projectDir = path.join(dir, "projects", legacy.id);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "document.json"),
      JSON.stringify(legacy),
    );

    const loaded = await store.load(legacy.id);
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.features).toEqual(legacy.features);

    loaded.features = [sketch(30)];
    await store.save(loaded);
    const reloaded = await store.load(legacy.id);
    expect(reloaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(reloaded.features).toEqual([sketch(30)]);
  });
});
