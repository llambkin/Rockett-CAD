import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { SCHEMA_VERSION } from "@rockett/shared";
import { ProjectStore } from "../src/store/projectStore.js";
import { validateDocument } from "../src/api/validate.js";
import { LocalStorage } from "../src/store/storage.js";

const fixtures = path.join(import.meta.dirname, "fixtures", "schema");

describe("schema fixtures", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "loads v%i at the current schema with features unchanged",
    async (version) => {
      const raw = await fs.readFile(
        path.join(fixtures, `v${version}.json`),
        "utf8",
      );
      const fixture = JSON.parse(raw);
      expect(fixture.schemaVersion).toBe(version);
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-schema-"));
      const projectDir = path.join(dir, "projects", fixture.id);
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, "document.json"), raw);

      const loaded = await new ProjectStore(
        new LocalStorage(dir, fs),
        validateDocument,
      ).load(fixture.id);

      expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
      expect(loaded.features).toEqual(fixture.features);
      expect(loaded.bodyMeta).toEqual(fixture.bodyMeta);
      expect(loaded.timelinePosition).toBe(fixture.timelinePosition);
      expect(loaded.groups).toEqual(fixture.groups ?? []);
      expect(loaded.revision).toBe(0);
      expect(loaded.savedWith).toBeNull();
      await fs.rm(dir, { recursive: true, force: true });
    },
  );

  it("v4 carries an importStep with its STEP source", async () => {
    const v4 = JSON.parse(
      await fs.readFile(path.join(fixtures, "v4.json"), "utf8"),
    );
    const step = v4.features.find(
      (f: { type: string }) => f.type === "importStep",
    );
    expect(step.data).toMatch(/^ISO-10303-21;[\s\S]*END-ISO-10303-21;\n$/);
  });
});
