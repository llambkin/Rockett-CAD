/**
 * Project persistence.
 *
 * Layout under DATA_DIR (a mounted Docker volume in production):
 *   projects/{id}/document.json   — the parametric document (source of truth)
 *   projects/{id}/assets/{id}.ext — uploaded reference images
 *   projects/{id}/exports/        — optionally retained export files
 *
 * Writes are atomic (tmp file + rename) so a crash never corrupts a project.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  SCHEMA_VERSION,
  createEmptyDocument,
  type ApiErrorCode,
  type CadDocument,
  type ProjectSummary,
} from "@rockett/shared";
import { migrateDocument } from "./migrations.js";
import { ProjectQueue } from "./projectQueue.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ASSET_ID_RE = /^[a-f0-9]{16}\.(png|jpg|webp)$/;
const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

export const IMAGE_LIMIT_MB = 25;

const IMAGE_TYPES: Array<{ ext: string; test: (b: Buffer) => boolean }> = [
  {
    ext: "png",
    test: (b) => b.length >= 33 && b.subarray(0, 16).equals(PNG_HEAD),
  },
  {
    ext: "jpg",
    test: (b) =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: "webp",
    test: (b) =>
      b.length > 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

function imageExt(data: Buffer, label: string): string {
  if (data.length > IMAGE_LIMIT_MB * 1024 * 1024)
    throw new StoreError(`${label}image is over ${IMAGE_LIMIT_MB} MB`);
  const type = IMAGE_TYPES.find((t) => t.test(data));
  if (!type)
    throw new StoreError(
      `${label}unsupported image type (PNG, JPEG, WebP only)`,
    );
  return type.ext;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode = "validation",
  ) {
    super(message);
  }
}

export class ProjectStore {
  private saves = new ProjectQueue();

  constructor(private dataDir: string) {}

  private projectsDir(): string {
    return path.join(this.dataDir, "projects");
  }

  /** Validated project directory — rejects path traversal. */
  private projectDir(id: string): string {
    if (!ID_RE.test(id)) throw new StoreError(`invalid project id`);
    return path.join(this.projectsDir(), id);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.projectsDir(), { recursive: true });
  }

  async list(): Promise<ProjectSummary[]> {
    await this.init();
    const entries = await fs.readdir(this.projectsDir(), {
      withFileTypes: true,
    });
    const out: ProjectSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || !ID_RE.test(e.name)) continue;
      try {
        const doc = await this.load(e.name);
        out.push({
          id: doc.id,
          name: doc.name,
          createdAt: doc.createdAt,
          modifiedAt: doc.modifiedAt,
          featureCount: doc.features.length,
        });
      } catch {
        // skip unreadable projects rather than failing the listing
      }
    }
    out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return out;
  }

  async create(name: string): Promise<CadDocument> {
    const id = crypto.randomBytes(6).toString("hex");
    const doc = createEmptyDocument(id, name || "Untitled");
    await fs.mkdir(path.join(this.projectDir(id), "assets"), {
      recursive: true,
    });
    await fs.mkdir(path.join(this.projectDir(id), "exports"), {
      recursive: true,
    });
    await this.save(doc);
    return doc;
  }

  async load(id: string): Promise<CadDocument> {
    const file = path.join(this.projectDir(id), "document.json");
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      throw new StoreError(`project ${id} not found`, "not_found");
    }
    let doc: CadDocument;
    try {
      doc = JSON.parse(raw);
    } catch {
      throw new StoreError(`project ${id} is corrupted`, "internal");
    }
    return migrateDocument(doc);
  }

  async save(doc: CadDocument): Promise<void> {
    // Windows cannot reliably replace the same destination concurrently.
    // Capture the submitted version before waiting for earlier saves.
    const snapshot = structuredClone(doc);
    await this.saves.run(doc.id, () => this.writeDocument(snapshot));
    doc.modifiedAt = snapshot.modifiedAt;
  }

  private async writeDocument(doc: CadDocument): Promise<void> {
    if (doc.schemaVersion !== SCHEMA_VERSION) {
      throw new StoreError(
        `document schema ${doc.schemaVersion} does not match ${SCHEMA_VERSION}`,
      );
    }
    doc.modifiedAt = new Date().toISOString();
    const dir = this.projectDir(doc.id);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "document.json");
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(doc, null, 1), "utf8");
      await fs.rename(tmp, file);
    } finally {
      // Each save owns its temporary file, including when a write fails.
      await fs.rm(tmp, { force: true });
    }
  }

  async duplicate(id: string, newName?: string): Promise<CadDocument> {
    const src = await this.load(id);
    const copy: CadDocument = JSON.parse(JSON.stringify(src));
    copy.id = crypto.randomBytes(6).toString("hex");
    copy.name = newName || `${src.name} (copy)`;
    copy.createdAt = new Date().toISOString();
    await fs.mkdir(path.join(this.projectDir(copy.id), "assets"), {
      recursive: true,
    });
    await fs.mkdir(path.join(this.projectDir(copy.id), "exports"), {
      recursive: true,
    });
    // copy assets
    const srcAssets = path.join(this.projectDir(id), "assets");
    try {
      for (const f of await fs.readdir(srcAssets)) {
        await fs.copyFile(
          path.join(srcAssets, f),
          path.join(this.projectDir(copy.id), "assets", f),
        );
      }
    } catch {
      // no assets
    }
    await this.save(copy);
    return copy;
  }

  async remove(id: string): Promise<void> {
    const dir = this.projectDir(id);
    await fs.rm(dir, { recursive: true, force: true });
  }

  // ----- assets (reference images) -----

  async saveAsset(
    projectId: string,
    data: Buffer,
  ): Promise<{ assetId: string }> {
    const assetId = `${crypto.randomBytes(8).toString("hex")}.${imageExt(data, "")}`;
    await this.writeAsset(projectId, assetId, data, "");
    return { assetId };
  }

  async importProject(
    doc: CadDocument,
    assets: ReadonlyMap<string, Buffer>,
  ): Promise<CadDocument> {
    const { id } = await this.create(doc.name);
    try {
      for (const [assetId, data] of assets)
        await this.writeAsset(id, assetId, data, `asset ${assetId}: `);
      const imported = { ...doc, id };
      await this.save(imported);
      return imported;
    } catch (error) {
      await this.remove(id);
      throw error;
    }
  }

  private async writeAsset(
    projectId: string,
    assetId: string,
    data: Buffer,
    label: string,
  ): Promise<void> {
    const file = this.assetFile(projectId, assetId, label);
    if (path.extname(assetId) !== `.${imageExt(data, label)}`)
      throw new StoreError(`${label}extension does not match the image type`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }

  private assetFile(projectId: string, assetId: string, label = ""): string {
    if (!ASSET_ID_RE.test(assetId))
      throw new StoreError(`${label}invalid asset id`);
    return path.join(this.projectDir(projectId), "assets", assetId);
  }

  async assetPath(projectId: string, assetId: string): Promise<string> {
    const p = this.assetFile(projectId, assetId);
    try {
      await fs.access(p);
    } catch {
      throw new StoreError("asset not found", "not_found");
    }
    return p;
  }

  async saveExport(
    projectId: string,
    fileName: string,
    data: Buffer,
  ): Promise<void> {
    if (!/^[\w.-]{1,120}$/.test(fileName)) return;
    const dir = path.join(this.projectDir(projectId), "exports");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), data);
  }
}
