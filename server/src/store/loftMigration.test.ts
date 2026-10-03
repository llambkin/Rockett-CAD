import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createEmptyDocument,
  SCHEMA_VERSION,
  type LoftFeature,
} from "@rockett/shared";
import { validateDocument, validateFeature } from "../api/validate.js";
import { ProjectStore } from "./projectStore.js";
import { documentMigrations, migrate } from "./migrations.js";
import { LocalStorage } from "./storage.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function storageRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "loft-migration-"));
  roots.push(root);
  return new LocalStorage(root, fs);
}

const face = {
  kind: "face",
  bodyId: "source",
  faceName: "f:source:cap:end",
} as const;
const profile = { sketchId: "middle", profileId: "profile1" };
const loft: LoftFeature = {
  id: "loft",
  name: "Loft",
  type: "loft",
  suppressed: false,
  sections: [face, profile],
  operation: "join",
  targets: ["source"],
};

function previousProject(origin: string) {
  const doc = createEmptyDocument(origin, "Saved Loft");
  const legacy =
    origin === "fork21"
      ? {
          ...doc,
          schemaVersion: 21,
          features: [
            {
              ...loft,
              sections: [profile, { ...profile, sketchId: "last" }],
            },
          ],
        }
      : (() => {
          const {
            namingVersion: _naming,
            modifiedBy: _author,
            ...upstream
          } = doc;
          return { ...upstream, schemaVersion: 12, features: [loft] };
        })();
  legacy.timelinePosition = 1;
  legacy.extensions = {
    "unknown.module": {
      version: 9,
      data: { text: "keep verbatim", values: [2, 1] },
    },
  };
  return { doc, legacy };
}

it("validates ordered mixed sections and rejects malformed or insufficient sections", () => {
  expect(() => validateFeature(loft)).not.toThrow();
  expect(() => validateFeature({ ...loft, sections: [face] })).toThrow();
  expect(() =>
    validateFeature({
      ...loft,
      sections: [{ ...face, faceName: "" }, profile],
    }),
  ).toThrow();
});

it.each(["fork21", "upstream12"])(
  "backs up and cold reopens %s with its ordered references and opaque data",
  async (origin) => {
    const { doc, legacy } = previousProject(origin);
    const raw = Buffer.from(JSON.stringify(legacy));
    const bytes = Buffer.from("synthetic source bytes\n");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const home = `projects/${doc.id}`;
    const storage = await storageRoot();
    await storage.writeAtomic(`${home}/document.json`, raw);
    await storage.writeAtomic(`${home}/blobs/${hash}`, bytes);
    const store = new ProjectStore(storage, validateDocument);
    const loaded = await store.load(doc.id);
    expect(loaded.schemaVersion).toBe(SCHEMA_VERSION);
    expect(loaded.namingVersion).toBe(
      origin === "fork21" ? doc.namingVersion : 1,
    );
    expect(loaded.features).toEqual(legacy.features);
    expect(loaded.extensions).toEqual(legacy.extensions);
    expect(await storage.list(`backups/${home}`)).toEqual([]);
    const beforeSave = structuredClone(loaded);
    await store.save(loaded, null);
    const [backup, ...others] = await storage.list(`backups/${home}`);
    expect(others).toEqual([]);
    expect(backup).toMatch(origin === "fork21" ? /^v21-/ : /^v12-/);
    expect(
      await storage.read(`backups/${home}/${backup}/files/document.json`),
    ).toEqual(raw);
    expect(
      await storage.read(`backups/${home}/${backup}/files/blobs/${hash}`),
    ).toEqual(bytes);
    const reopened = await new ProjectStore(storage, validateDocument).load(
      doc.id,
    );
    expect(reopened).toEqual(loaded);
    const restored = await storageRoot();
    for (const file of await storage.files(`backups/${home}/${backup}/files`))
      await restored.writeAtomic(
        `${home}/${file}`,
        await storage.read(`backups/${home}/${backup}/files/${file}`),
      );
    expect(
      await new ProjectStore(restored, validateDocument).load(doc.id),
    ).toEqual(beforeSave);
  },
);

it("preserves existing fork naming versions and refuses invalid versions", () => {
  const doc = {
    ...createEmptyDocument("fork12", "Fork 12"),
    schemaVersion: 12,
    namingVersion: 2,
  };
  expect(migrate(documentMigrations, doc).namingVersion).toBe(2);
  expect(() =>
    validateDocument(
      migrate(documentMigrations, { ...doc, namingVersion: null }),
    ),
  ).toThrow();
});

it.each(["fork21", "upstream12"])(
  "recovers the complete %s project after a migration write fails",
  async (origin) => {
    for (const when of ["before", "after"] as const) {
      const { doc, legacy } = previousProject(origin);
      const root = await mkdtemp(path.join(tmpdir(), "loft-fault-"));
      roots.push(root);
      const clean = new LocalStorage(root, fs);
      const raw = Buffer.from(JSON.stringify(legacy));
      const home = `projects/${doc.id}`;
      await clean.writeAtomic(`${home}/document.json`, raw);
      await clean.writeAtomic(
        `${home}/blobs/source`,
        "synthetic retained source",
      );
      let failed = false;
      const failing = new LocalStorage(root, {
        ...fs,
        rename: async (from, to) => {
          const inject =
            !failed && String(to).endsWith(`/documents/${doc.id}.json`);
          if (inject) failed = true;
          if (inject && when === "before")
            throw new Error("injected migration write");
          await fs.rename(from, to);
          if (inject && when === "after")
            throw new Error("injected migration write");
        },
      });
      const store = new ProjectStore(failing, validateDocument);
      await expect(store.save(await store.load(doc.id), null)).rejects.toThrow(
        "injected migration write",
      );
      expect(failed).toBe(true);
      const restarted = new ProjectStore(clean, validateDocument);
      expect((await restarted.inventory()).failed).toEqual([]);
      const recovered = await restarted.load(doc.id);
      expect(recovered.features).toEqual(legacy.features);
      expect(recovered.extensions).toEqual(legacy.extensions);
      expect((await clean.read(`${home}/blobs/source`)).toString()).toBe(
        "synthetic retained source",
      );
      await restarted.save(recovered, null);
      const [backup, ...others] = await clean.list(`backups/${home}`);
      expect(others).toEqual([]);
      expect(
        await clean.read(`backups/${home}/${backup}/files/document.json`),
      ).toEqual(raw);
    }
  },
);
