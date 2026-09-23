import path from "node:path";
import crypto from "node:crypto";
import {
  createEmptyDocument,
  type CadDocument,
  type ProjectSummary,
} from "@rockett/shared";
import { build } from "../build.js";
import { BlobStore, HASH_RE, PendingBlobs } from "./blobStore.js";
import { JsonStore, sha256, StoreError, type Inventory } from "./jsonStore.js";
import { documentMigrations, TooNewError } from "./migrations.js";
import type { Storage } from "./storage.js";

export { StoreError };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const IMAGE_LIMIT_MB = 25;

const IMAGE_TYPES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  {
    mime: "image/png",
    test: (b) => b.length >= 33 && b.subarray(0, 16).equals(PNG_HEAD),
  },
  {
    mime: "image/jpeg",
    test: (b) =>
      b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/webp",
    test: (b) =>
      b.length > 12 &&
      b.toString("ascii", 0, 4) === "RIFF" &&
      b.toString("ascii", 8, 12) === "WEBP",
  },
];

const newId = () => crypto.randomBytes(6).toString("hex");

const text = (v: unknown, fallback: string) =>
  typeof v === "string" ? v : fallback;

function imageMime(data: Buffer, label: string): string {
  if (data.length > IMAGE_LIMIT_MB * 1024 * 1024)
    throw new StoreError(`${label}image is over ${IMAGE_LIMIT_MB} MB`);
  const type = IMAGE_TYPES.find((t) => t.test(data));
  if (!type)
    throw new StoreError(
      `${label}unsupported image type (PNG, JPEG, WebP only)`,
    );
  return type.mime;
}

function stepBlobs(doc: CadDocument): string[] {
  return doc.features.flatMap((f) => (f.type === "importStep" ? [f.blob] : []));
}

function imageBlobs(doc: CadDocument): string[] {
  return doc.features.flatMap((f) =>
    f.type === "referenceImage" && HASH_RE.test(f.assetId) ? [f.assetId] : [],
  );
}

export class ProjectStore {
  private documents: JsonStore<CadDocument, PendingBlobs>;

  constructor(
    private readonly storage: Storage,
    private readonly validate: (doc: CadDocument) => void,
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
      validate,
      effects: {
        context: async (id, stored) =>
          new PendingBlobs(await this.legacyAssets(id, stored)),
        commit: async (id, pending) => {
          for (const bytes of pending.blobs.values())
            await this.blobs(id).put(bytes);
        },
        retire: (id) => storage.remove(this.assetDir(id)),
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
          status: "ok",
        });
      } catch (err) {
        if (err instanceof StoreError && err.code === "not_found") continue;
        const raw = (await this.documents
          .stored(id)
          .catch(() => ({}))) as Partial<Record<keyof CadDocument, unknown>>;
        out.push({
          id,
          name: text(raw.name, id),
          createdAt: text(raw.createdAt, ""),
          modifiedAt: text(raw.modifiedAt, ""),
          featureCount: Array.isArray(raw.features) ? raw.features.length : 0,
          status: err instanceof TooNewError ? "tooNew" : "invalid",
          error: (err as Error).message,
          ...(err instanceof TooNewError && { schemaVersion: err.version }),
        });
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

  async load(id: string): Promise<CadDocument> {
    const doc = await this.documents.read(id);
    try {
      this.validate(doc);
    } catch (err) {
      throw new StoreError(
        `project ${id} is invalid: ${(err as Error).message}`,
        "unprocessable",
      );
    }
    return doc;
  }

  async save(doc: CadDocument): Promise<void> {
    const snapshot = structuredClone(doc);
    snapshot.modifiedAt = new Date().toISOString();
    snapshot.savedWith = build();
    await this.documents.update(doc.id, (previous) => {
      snapshot.revision = (previous?.revision ?? 0) + 1;
      return snapshot;
    });
    doc.modifiedAt = snapshot.modifiedAt;
    doc.revision = snapshot.revision;
    doc.savedWith = snapshot.savedWith;
  }

  async duplicate(id: string, newName?: string): Promise<CadDocument> {
    const src = await this.load(id);
    const copy: CadDocument = JSON.parse(JSON.stringify(src));
    copy.id = newId();
    copy.name = newName || `${src.name} (copy)`;
    copy.createdAt = new Date().toISOString();
    const from = path.posix.join(this.documents.dir(id), "blobs");
    for (const f of await this.storage.list(from))
      await this.storage.writeAtomic(
        path.posix.join(this.documents.dir(copy.id), "blobs", f),
        await this.storage.read(path.posix.join(from, f)),
      );
    for (const hash of [...stepBlobs(src), ...imageBlobs(src)]) {
      const bytes = await this.blob(id, hash).catch(() => undefined);
      if (bytes) await this.blobs(copy.id).put(bytes);
    }
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
    imageMime(data, "");
    return { assetId: await this.blobs(projectId).put(data) };
  }

  async importProject(
    doc: CadDocument,
    assets: ReadonlyMap<string, Buffer>,
    temporary = false,
  ): Promise<CadDocument> {
    const id = newId();
    const images = new Set(imageBlobs(doc));
    try {
      if (temporary) await this.writeMarker(id);
      for (const [assetId, data] of assets) {
        const label = `asset ${assetId}: `;
        if (!HASH_RE.test(assetId))
          throw new StoreError(`${label}invalid asset id`);
        if (sha256(data) !== assetId)
          throw new StoreError(`${label}content does not match its id`);
        if (images.has(assetId)) imageMime(data, label);
        await this.blobs(id).put(data);
      }
      const imported = { ...doc, id };
      await this.save(imported);
      return imported;
    } catch (error) {
      await this.remove(id);
      throw error;
    }
  }

  blobs(projectId: string): BlobStore {
    return new BlobStore(
      this.storage,
      path.posix.join(this.documents.dir(projectId), "blobs"),
    );
  }

  async blob(projectId: string, hash: string): Promise<Buffer> {
    try {
      return await this.blobs(projectId).get(hash);
    } catch (err) {
      if (!(err instanceof StoreError && err.code === "not_found")) throw err;
      const { context } = await this.documents.migrated(projectId);
      const pending = context.blobs.get(hash);
      if (!pending) throw err;
      return pending;
    }
  }

  async sources(doc: CadDocument): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    for (const hash of stepBlobs(doc)) {
      if (out.has(hash)) continue;
      const bytes = await this.blob(doc.id, hash).catch(() => undefined);
      if (bytes) out.set(hash, bytes);
    }
    return out;
  }

  private assetDir(projectId: string): string {
    return path.posix.join(this.documents.dir(projectId), "assets");
  }

  private async legacyAssets(
    projectId: string,
    stored: unknown,
  ): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    const version = (stored as Partial<CadDocument> | null)?.schemaVersion;
    if (typeof version !== "number" || version > 8) return out;
    const dir = this.assetDir(projectId);
    for (const name of await this.storage.list(dir))
      out.set(name, await this.storage.read(path.posix.join(dir, name)));
    return out;
  }

  async readAsset(
    projectId: string,
    assetId: string,
  ): Promise<{ data: Buffer; mime: string }> {
    const missing = new StoreError("asset not found", "not_found");
    if (!HASH_RE.test(assetId)) throw missing;
    const data = await this.blob(projectId, assetId);
    const type = IMAGE_TYPES.find((t) => t.test(data));
    if (!type) throw missing;
    return { data, mime: type.mime };
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
