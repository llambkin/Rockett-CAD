import path from "node:path";
import crypto from "node:crypto";
import {
  SCHEMA_VERSION,
  createEmptyDocument,
  type CadDocument,
  type ProjectSummary,
} from "@rockett/shared";
import { JsonStore, StoreError, type Inventory } from "./jsonStore.js";
import { documentMigrations } from "./migrations.js";
import type { Storage } from "./storage.js";

export { StoreError };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ASSET_ID_RE = /^[a-f0-9]{16}\.(png|jpg|webp)$/;
const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

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

const newId = () => crypto.randomBytes(6).toString("hex");

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

export class ProjectStore {
  private documents: JsonStore<CadDocument>;

  constructor(
    private readonly storage: Storage,
    private readonly now: () => number = Date.now,
  ) {
    this.documents = new JsonStore({
      storage,
      root: "projects",
      name: "project",
      key: ID_RE,
      file: "document.json",
      migrations: documentMigrations,
      unbacked: (id) => this.isTemporary(id),
      validate: (doc) => {
        if (doc.schemaVersion !== SCHEMA_VERSION)
          throw new StoreError(
            `document schema ${doc.schemaVersion} does not match ${SCHEMA_VERSION}`,
          );
      },
    });
  }

  inventory(): Promise<Inventory> {
    return this.documents.inventory();
  }

  async list(): Promise<ProjectSummary[]> {
    const out: ProjectSummary[] = [];
    for (const id of await this.documents.keys()) {
      if (await this.isTemporary(id)) continue;
      try {
        const doc = await this.load(id);
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
    const id = newId();
    const doc = createEmptyDocument(id, name || "Untitled");
    await this.save(doc);
    return doc;
  }

  load(id: string): Promise<CadDocument> {
    return this.documents.read(id);
  }

  async save(doc: CadDocument): Promise<void> {
    const snapshot = structuredClone(doc);
    snapshot.modifiedAt = new Date().toISOString();
    await this.documents.write(doc.id, snapshot);
    doc.modifiedAt = snapshot.modifiedAt;
  }

  async duplicate(id: string, newName?: string): Promise<CadDocument> {
    const src = await this.load(id);
    const copy: CadDocument = JSON.parse(JSON.stringify(src));
    copy.id = newId();
    copy.name = newName || `${src.name} (copy)`;
    copy.createdAt = new Date().toISOString();
    const from = this.assetDir(id);
    for (const f of await this.storage.list(from))
      await this.storage.writeAtomic(
        path.posix.join(this.assetDir(copy.id), f),
        await this.storage.read(path.posix.join(from, f)),
      );
    await this.save(copy);
    return copy;
  }

  async isTemporary(id: string): Promise<boolean> {
    return (await this.touchedAt(id)) !== undefined;
  }

  async touch(id: string): Promise<void> {
    const at = await this.touchedAt(id);
    if (at !== undefined && this.now() - at >= MINUTE)
      await this.writeMarker(id);
  }

  async temporaryIds(): Promise<string[]> {
    const out: string[] = [];
    for (const id of await this.documents.keys())
      if (await this.isTemporary(id)) out.push(id);
    return out;
  }

  async expire(id: string): Promise<boolean> {
    const at = await this.touchedAt(id);
    if (at === undefined || this.now() - at < DAY) return false;
    await this.remove(id);
    return true;
  }

  private markerFile(id: string): string {
    return path.posix.join(this.documents.dir(id), "temporary.json");
  }

  private writeMarker(id: string): Promise<void> {
    return this.storage.writeAtomic(
      this.markerFile(id),
      JSON.stringify({
        owner: null,
        touchedAt: new Date(this.now()).toISOString(),
      }),
    );
  }

  private async touchedAt(id: string): Promise<number | undefined> {
    let raw: Buffer;
    try {
      raw = await this.storage.read(this.markerFile(id));
    } catch {
      return undefined;
    }
    try {
      return Date.parse(JSON.parse(raw.toString("utf8")).touchedAt) || 0;
    } catch {
      return 0;
    }
  }

  remove(id: string): Promise<void> {
    return this.documents.remove(id);
  }

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
    temporary = false,
  ): Promise<CadDocument> {
    const id = newId();
    try {
      if (temporary) await this.writeMarker(id);
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
    await this.storage.writeAtomic(file, data);
  }

  private assetDir(projectId: string): string {
    return path.posix.join(this.documents.dir(projectId), "assets");
  }

  private assetFile(projectId: string, assetId: string, label = ""): string {
    if (!ASSET_ID_RE.test(assetId))
      throw new StoreError(`${label}invalid asset id`);
    return path.posix.join(this.assetDir(projectId), assetId);
  }

  async readAsset(projectId: string, assetId: string): Promise<Buffer> {
    const file = this.assetFile(projectId, assetId);
    try {
      return await this.storage.read(file);
    } catch {
      throw new StoreError("asset not found", "not_found");
    }
  }

  async saveExport(
    projectId: string,
    fileName: string,
    data: Buffer,
  ): Promise<void> {
    if (!/^[\w.-]{1,120}$/.test(fileName)) return;
    const file = path.posix.join(
      this.documents.dir(projectId),
      "exports",
      fileName,
    );
    await this.documents.exclusive(projectId, () =>
      this.storage.writeAtomic(file, data),
    );
  }
}
