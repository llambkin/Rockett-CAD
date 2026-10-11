import path from "node:path";
import {
  createEmptyDocument,
  emptyView,
  withShown,
  moduleAssetHashes,
  referencedAssets,
  type CadDocument,
  type ProjectSummary,
  type ProjectView,
  type ProjectViewBody,
} from "@rockett/shared";
import { imageBlobs, projectSources } from "../modules/featureInputs.js";
import { UserStore } from "../auth/userStore.js";
import { build } from "../build.js";
import { BlobStore, HASH_RE, PendingBlobs, Uploads } from "./blobStore.js";
import { JsonStore, newId, sameTag, sha256, StoreError } from "./jsonStore.js";
import type { Inventory, Write } from "./jsonStore.js";
import {
  checkManifest,
  ID_RE,
  ManifestStore,
  type ProjectAccess,
} from "./manifestStore.js";
import { documentMigrations, migrate } from "./migrations.js";
import { SettingsStore } from "./settingsStore.js";
import type { Storage } from "./storage.js";
import { ThumbnailStore } from "./thumbnailStore.js";
import { ViewStore } from "./viewStore.js";
import { listProjects } from "./projectInventory.js";
import { TIMING_MS } from "../tunables.js";

import { imageMime, IMAGE_TYPES } from "./projectAssets.js";

export { StoreError };
export { IMAGE_LIMIT_MB } from "./projectAssets.js";

const LEGACY = "document.json";
const DOCUMENTS = "documents";

export class ProjectStore {
  readonly documents: JsonStore<CadDocument, PendingBlobs>;
  private views: ViewStore;
  private heldViews = new Map<string, Map<string, ProjectView>>();
  private users: UserStore;
  readonly manifests: ManifestStore;
  readonly uploads: Uploads;
  readonly settings: SettingsStore;
  readonly thumbnails: ThumbnailStore;

  constructor(
    private readonly storage: Storage,
    private readonly validate: (doc: CadDocument) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.uploads = new Uploads(storage);
    this.settings = new SettingsStore(storage);
    this.thumbnails = new ThumbnailStore(
      storage,
      (id) => this.documents.dir(id),
      (id, operation) => this.documents.exclusive(id, operation),
    );
    this.views = new ViewStore(storage, (id) => this.documents.dir(id));
    this.users = new UserStore(storage);
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
          const shown = withShown(emptyView(), pending.shown);
          const copier = await this.copier(id);
          if (
            copier &&
            (shown.hidden.bodies.length || shown.hidden.features.length) &&
            !(await this.isTemporary(id)) &&
            !(await this.views.legacy(id)) &&
            !(await this.views.read(copier, id))
          )
            out.set(...this.views.encode(copier, id, shown));
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

  list(): Promise<ProjectSummary[]> {
    return listProjects(this);
  }

  manifestSource(id: string) {
    return this.manifests.source(id);
  }

  async projectAccess(id: string): Promise<ProjectAccess> {
    await this.exists(id);
    return this.manifests.access(id);
  }

  private async exists(id: string): Promise<void> {
    const files = await this.storage.list(this.documents.dir(id));
    if (!files.includes(LEGACY) && !files.includes(DOCUMENTS))
      throw new StoreError(`project ${id} not found`, "not_found");
  }

  private async copier(id: string): Promise<string | undefined> {
    const { owner } = await this.manifests.read(id);
    if (owner) return owner;
    return (await this.users.list()).find((user) => user.role === "admin")?.id;
  }

  async setProjectAccess(id: string, access: ProjectAccess): Promise<void> {
    await this.projectAccess(id);
    await this.manifests.update(id, (manifest) => ({ ...manifest, ...access }));
  }
  revokeFriendShares(first: string, second: string): Promise<void> {
    return this.documents
      .keys()
      .then((ids) => this.manifests.revokeFriendShares(ids, first, second));
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

  historyDir(id: string): string {
    return this.documents.dir(id);
  }

  async storedRevision(id: string): Promise<number> {
    const { revision } = (await this.documents.stored(id)) as {
      revision?: unknown;
    };
    return typeof revision === "number" ? revision : 0;
  }

  restored(stored: unknown, current: CadDocument): CadDocument {
    const document = migrate<CadDocument>(documentMigrations, stored);
    return { ...document, name: current.name };
  }

  private async documentView(id: string): Promise<ProjectView> {
    const { context } = await this.part(id, id);
    return withShown(emptyView(), context.shown);
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
    this.validate(doc);
    for (const hash of new Set(moduleAssetHashes(doc)))
      await this.blob(doc.id, hash);
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

  async view(id: string, userId: string): Promise<ProjectView> {
    await this.exists(id);
    if (await this.isTemporary(id))
      return this.heldViews.get(id)?.get(userId) ?? emptyView();
    const own = await this.views.read(userId, id);
    if (own) return own;
    if (userId !== (await this.copier(id))) return emptyView();
    const copy = (await this.views.legacy(id)) ?? (await this.documentView(id));
    await this.views.write(userId, id, copy);
    return copy;
  }

  private holdView(
    userId: string,
    id: string,
    view: ProjectViewBody,
  ): ProjectView {
    const held: ProjectView = JSON.parse(
      this.views.encode(userId, id, view)[1],
    );
    const users = this.heldViews.get(id) ?? new Map<string, ProjectView>();
    this.heldViews.set(id, users.set(userId, held));
    return held;
  }

  async setView(
    id: string,
    userId: string,
    view: ProjectViewBody,
    expected?: string,
  ): Promise<ProjectView> {
    await this.exists(id);
    const temporary = await this.isTemporary(id);
    const current = temporary
      ? this.heldViews.get(id)?.get(userId)
      : await this.view(id, userId);
    if (expected !== undefined && current && !sameTag(expected, current))
      throw new StoreError("This view changed in another session.", "conflict");
    if (temporary) return this.holdView(userId, id, view);
    return this.views.write(userId, id, view);
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
    for (const hash of referencedAssets(src)) {
      const bytes = await this.blob(id, hash).catch(() => undefined);
      if (bytes) await this.blobs(copy.id).put(bytes);
    }
    await this.settings.duplicateProject(id, copy.id);
    await this.add(copy, actor);
    return copy;
  }

  async isTemporary(id: string): Promise<boolean> {
    return (await this.marker(id)) !== undefined;
  }

  async temporaryRefuses(id: string, userId: string): Promise<boolean> {
    const marker = await this.marker(id);
    return marker !== undefined && marker.owner !== userId;
  }

  async touch(id: string): Promise<void> {
    const marker = await this.marker(id);
    if (
      marker &&
      this.now() - marker.touchedAt >= TIMING_MS.temporaryProjectTouch
    )
      await this.writeMarker(id, marker.owner);
  }

  async temporaryIds(): Promise<string[]> {
    const out: string[] = [];
    for (const id of await this.documents.keys())
      if (await this.isTemporary(id)) out.push(id);
    return out;
  }

  async expire(id: string): Promise<boolean> {
    const marker = await this.marker(id);
    if (
      marker === undefined ||
      this.now() - marker.touchedAt < TIMING_MS.temporaryProjectLifetime
    )
      return false;
    await this.remove(id);
    return true;
  }

  private markerFile(id: string): string {
    return path.posix.join(this.documents.dir(id), "temporary.json");
  }

  private writeMarker(id: string, owner: string | null): Promise<void> {
    return this.storage.writeAtomic(
      this.markerFile(id),
      JSON.stringify({
        owner,
        touchedAt: new Date(this.now()).toISOString(),
      }),
    );
  }

  private async marker(
    id: string,
  ): Promise<{ owner: string | null; touchedAt: number } | undefined> {
    let raw: Buffer;
    try {
      raw = await this.storage.read(this.markerFile(id));
    } catch {
      return undefined;
    }
    try {
      const { owner, touchedAt } = JSON.parse(raw.toString("utf8"));
      return {
        owner: typeof owner === "string" ? owner : null,
        touchedAt: Date.parse(touchedAt) || 0,
      };
    } catch {
      return { owner: null, touchedAt: 0 };
    }
  }

  async remove(id: string): Promise<void> {
    await this.documents.remove(id);
    this.heldViews.delete(id);
    await this.views.remove(id);
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
      if (temporary) await this.writeMarker(id, actor);
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
      const copier = await this.copier(id);
      if (copier && temporary) this.holdView(copier, id, view);
      else if (copier) await this.views.write(copier, id, view);
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
    return projectSources(doc, held, (id, hash) => this.blob(id, hash));
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
    if (!HASH_RE.test(assetId))
      throw new StoreError("asset not found", "not_found");
    const data = await this.blob(projectId, assetId);
    const type = IMAGE_TYPES.find((t) => t.test(data));
    return { data, mime: type?.mime ?? "application/octet-stream" };
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
