import {
  createManifest,
  DOCUMENT_TYPES,
  type ProjectManifest,
} from "@rockett/shared";
import { JsonStore, StoreError } from "./jsonStore.js";
import { manifestMigrations } from "./migrations.js";
import type { Storage } from "./storage.js";
import { ProjectQueue } from "./projectQueue.js";

export type ProjectAccess = Pick<ProjectManifest, "owner" | "members">;

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MANIFEST = "project.json";

export function checkManifest(id: string, manifest: ProjectManifest): void {
  if (
    manifest.owner !== null &&
    (typeof manifest.owner !== "string" || !ID_RE.test(manifest.owner))
  )
    throw new Error("invalid owner");
  if (!Array.isArray(manifest.members))
    throw new Error("members is not a list");
  const users = new Set<string>();
  for (const member of manifest.members) {
    if (
      typeof member?.userId !== "string" ||
      !ID_RE.test(member.userId) ||
      (member.role !== "view" && member.role !== "edit") ||
      member.userId === manifest.owner ||
      users.has(member.userId)
    )
      throw new Error("invalid member");
    users.add(member.userId);
  }
  const types = new Set<unknown>(DOCUMENT_TYPES);
  if (!Array.isArray(manifest.documents))
    throw new Error("documents is not a list");
  for (const document of manifest.documents) {
    if (!types.has(document?.type))
      throw new Error(`unknown document type ${String(document?.type)}`);
    if (typeof document.id !== "string" || !ID_RE.test(document.id))
      throw new Error(`invalid document id ${String(document.id)}`);
  }
  const [first] = manifest.documents;
  if (first?.id !== id || first.type !== "part")
    throw new Error(`the first document is not part ${id}`);
}

export class ManifestStore {
  private readonly manifests: JsonStore<ProjectManifest>;
  private readonly queue = new ProjectQueue();

  constructor(private readonly storage: Storage) {
    this.manifests = new JsonStore({
      storage,
      root: "projects",
      name: "project",
      key: ID_RE,
      file: () => MANIFEST,
      migrations: manifestMigrations,
      validate: (manifest) =>
        checkManifest(manifest.documents[0]?.id ?? "", manifest),
    });
  }

  read(id: string): Promise<ProjectManifest> {
    return this.manifests.read(id).catch((err) => {
      if (!(err instanceof StoreError && err.code === "not_found")) throw err;
      return createManifest(id);
    });
  }

  async access(id: string): Promise<ProjectAccess> {
    const manifest = await this.read(id);
    try {
      checkManifest(id, manifest);
    } catch (err) {
      throw new StoreError(
        `project ${id} is invalid: ${(err as Error).message}`,
        "unprocessable",
      );
    }
    return { owner: manifest.owner, members: manifest.members };
  }

  write(id: string, manifest: ProjectManifest): Promise<void> {
    return this.manifests.write(id, manifest);
  }

  update(
    id: string,
    edit: (manifest: ProjectManifest) => ProjectManifest | undefined,
  ): Promise<void> {
    return this.queue.run(id, async () => {
      const manifest = await this.read(id);
      const next = edit(manifest);
      if (next) await this.write(id, next);
    });
  }

  async revokeFriendShares(
    ids: string[],
    first: string,
    second: string,
  ): Promise<void> {
    for (const id of ids) {
      await this.access(id);
      await this.update(id, (manifest) => {
        if (manifest.owner !== first && manifest.owner !== second) return;
        const members = manifest.members.filter(
          (member) =>
            !(manifest.owner === first && member.userId === second) &&
            !(manifest.owner === second && member.userId === first),
        );
        return members.length === manifest.members.length
          ? undefined
          : { ...manifest, members };
      });
    }
  }

  created(id: string, owner: string | null = null): [string, string] {
    return this.manifests.encode(id, createManifest(id, owner));
  }

  migrate(id: string): Promise<void> {
    return this.manifests.settle(id);
  }

  async missing(id: string): Promise<boolean> {
    const files = await this.storage.list(this.manifests.dir(id));
    return !files.includes(MANIFEST);
  }
}
