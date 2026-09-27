import path from "node:path";
import crypto from "node:crypto";
import {
  createEmptyDocument,
  emptyView,
  MB,
  parse,
  projectView,
  VIEW_VERSION,
  withShown,
  type CadDocument,
  type ProjectSummary,
  type ProjectView,
  type ProjectManifest,
} from "@rockett/shared";
import { build } from "../build.js";
import { BlobStore, HASH_RE, PendingBlobs, Uploads } from "./blobStore.js";
import { JsonStore, sha256, StoreError } from "./jsonStore.js";
import type { Inventory, Write } from "./jsonStore.js";
import { checkManifest, ID_RE, ManifestStore } from "./manifestStore.js";
import { documentMigrations, TooNewError } from "./migrations.js";
import { SettingsStore } from "./settingsStore.js";
import type { Storage } from "./storage.js";
import { TIMING_MS } from "../tunables.js";

export { StoreError };

const LEGACY = "document.json";
const DOCUMENTS = "documents";
const PNG_HEAD = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

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
  if (data.length > IMAGE_LIMIT_MB * MB)
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
  readonly documents: JsonStore<CadDocument, PendingBlobs>;
  private views: JsonStore<ProjectView>;
  private manifests: ManifestStore;
  readonly uploads: Uploads;
  readonly settings: SettingsStore;

  constructor(
    private readonly storage: Storage,
    private readonly validate: (doc: CadDocument) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.uploads = new Uploads(storage);
    this.settings = new SettingsStore(storage);
    this.views = new JsonStore({
      storage,
      root: "projects",
      name: "project",
      key: ID_RE,
      file: () => "view.json",
      migrations: {
        namespace: "view",
        current: VIEW_VERSION,
        field: "version",
        steps: {},
      },
      unbacked: async () => true,
      validate: (view) => parse(projectView, view),
    });
    this.manifests = new ManifestStore(storage);
    this.documents = new JsonStore({
      storage,
      root: "projects",
      name: "project",
      key: ID_RE,
      file: (id) => `${DOCUMENTS}/${id}.json`,
      legacy: LEGACY,
      migrations: documentMigrations,
      unbacked: (id) => this.isTemporary(id),
      validate,
      remember: (doc) => ({ revision: doc.revision }),
      effects: {
        context: async (id, stored) =>
          new PendingBlobs(await this.legacyAssets(id, stored)),
        created: async (id, pending) => {
          const blobs = this.blobs(id);
          const out = new Map<string, string | Uint8Array>();
          for (const [hash, bytes] of pending.blobs)
            if (!(await blobs.has(hash))) out.set(blobs.file(hash), bytes);
          if (!(await this.savedView(id)))
            out.set(
              ...this.views.encode(id, withShown(emptyView(), pending.shown)),
            );
          if (Object.keys(pending.settings).length)
            out.set(...(await this.settings.staged(id, pending.settings)));
          if (await this.manifests.missing(id))
            out.set(...this.manifests.created(id));
          return out;
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
          modifiedBy: doc.modifiedBy,
          featureCount: doc.features.length,
          revision: doc.revision,
          status: "ok",
        });
      } catch (err) {
        if (err instanceof StoreError && err.code === "not_found") continue;
        const raw = (await this.documents
          .stored(id)
          .catch(() => ({}))) as Partial<Record<keyof CadDocument, unknown>>;
        const tooNew =
          err instanceof TooNewError &&
          err.namespace === documentMigrations.namespace;
        out.push({
          id,
          name: text(raw.name, id),
          createdAt: text(raw.createdAt, ""),
          modifiedAt: text(raw.modifiedAt, ""),
          modifiedBy:
            typeof raw.modifiedBy === "string" ? raw.modifiedBy : null,
          featureCount: Array.isArray(raw.features) ? raw.features.length : 0,
          status: tooNew ? "tooNew" : "invalid",
          error: (err as Error).message,
          ...(tooNew && { schemaVersion: err.version }),
        });
      }
    }
    out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return out;
  }

  async projectAccess(
    id: string,
  ): Promise<Pick<ProjectManifest, "owner" | "members">> {
    const files = await this.storage.list(this.documents.dir(id));
    if (!files.includes(LEGACY) && !files.includes(DOCUMENTS))
      throw new StoreError(`project ${id} not found`, "not_found");
    const manifest = await this.manifests.read(id);
    this.valid(id, () => checkManifest(id, manifest));
    const { owner, members } = manifest;
    return { owner, members };
  }

  migrateManifest(id: string): Promise<void> {
    return this.manifests.migrate(id);
  }

  async create(
    name: string,
    actor: string | null = null,
  ): Promise<CadDocument> {
    const id = newId();
    const doc = createEmptyDocument(id, name || "Untitled");
    await this.add(doc, actor);
    return doc;
  }

  private async add(doc: CadDocument, actor: string | null): Promise<void> {
    await this.save(doc, actor);
    await this.storage.writeAtomic(...this.manifests.created(doc.id, actor));
  }

  load(id: string): Promise<CadDocument> {
    return this.loadDocument(id, id);
  }

  async loadDocument(projectId: string, documentId: string) {
    return (await this.part(projectId, documentId)).doc;
  }

  async open(id: string): Promise<{ doc: CadDocument; view: ProjectView }> {
    const { doc, context } = await this.part(id, id);
    return {
      doc,
      view: (await this.savedView(id)) ?? withShown(emptyView(), context.shown),
    };
  }

  private async part(id: string, documentId: string) {
    const manifest = await this.manifests.read(id);
    this.valid(id, () => checkManifest(id, manifest));
    if (!manifest.documents.some((d) => d.id === documentId))
      throw new StoreError(`document ${documentId} not found`, "not_found");
    const { value, context } = await this.documents.migrated(id, documentId);
    this.valid(id, () => this.validate(value));
    return { doc: value, context };
  }

  private valid(id: string, check: () => void): void {
    try {
      check();
    } catch (err) {
      throw new StoreError(
        `project ${id} is invalid: ${(err as Error).message}`,
        "unprocessable",
      );
    }
  }

  async save(
    doc: CadDocument,
    actor: string | null,
    write?: Write<CadDocument>,
  ): Promise<void> {
    const snapshot = {
      ...doc,
      modifiedAt: new Date().toISOString(),
      modifiedBy: actor,
      savedWith: build(),
    };
    const next = (previous?: Partial<CadDocument>) => {
      snapshot.revision = (previous?.revision ?? 0) + 1;
      return snapshot;
    };
    await this.documents.update(doc.id, next, write);
    doc.modifiedAt = snapshot.modifiedAt;
    doc.modifiedBy = snapshot.modifiedBy;
    doc.revision = snapshot.revision;
    doc.savedWith = snapshot.savedWith;
  }

  async view(id: string): Promise<ProjectView> {
    if (await this.hasView(id)) return this.views.read(id);
    return (await this.open(id)).view;
  }

  async setView(id: string, view: ProjectView): Promise<void> {
    if (!(await this.hasView(id))) await this.documents.settle(id);
    await this.views.write(id, view);
  }

  private savedView(id: string): Promise<ProjectView | undefined> {
    return this.views.read(id).catch((err) => {
      if (!(err instanceof StoreError && err.code === "not_found")) throw err;
      return undefined;
    });
  }

  private async hasView(id: string): Promise<boolean> {
    const files = await this.storage.list(this.documents.dir(id));
    if (!files.includes(LEGACY) && !files.includes(DOCUMENTS))
      throw new StoreError(`project ${id} not found`, "not_found");
    return files.includes("view.json");
  }

  exclusive<R>(id: string, operation: () => Promise<R>): Promise<R> {
    return this.documents.exclusive(id, operation);
  }

  duplicate(
    id: string,
    newName?: string,
    actor: string | null = null,
  ): Promise<CadDocument> {
    return this.exclusive(id, () => this.copy(id, newName, actor));
  }

  private async copy(
    id: string,
    newName: string | undefined,
    actor: string | null,
  ): Promise<CadDocument> {
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
    await this.settings.duplicateProject(id, copy.id);
    await this.add(copy, actor);
    return copy;
  }

  async isTemporary(id: string): Promise<boolean> {
    return (await this.touchedAt(id)) !== undefined;
  }

  async touch(id: string): Promise<void> {
    const at = await this.touchedAt(id);
    if (at !== undefined && this.now() - at >= TIMING_MS.temporaryProjectTouch)
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
    if (
      at === undefined ||
      this.now() - at < TIMING_MS.temporaryProjectLifetime
    )
      return false;
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
    view: ProjectView,
    temporary = false,
    actor: string | null = null,
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
      await this.add(imported, actor);
      await this.views.write(id, view);
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

  async sources(
    doc: CadDocument,
    held: ReadonlyMap<string, Uint8Array> = new Map(),
  ): Promise<Map<string, Uint8Array>> {
    const out = new Map<string, Uint8Array>();
    for (const hash of stepBlobs(doc)) {
      if (out.has(hash)) continue;
      const bytes =
        held.get(hash) ??
        (await this.blob(doc.id, hash).catch(() => undefined));
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
