import path from "node:path";
import {
  parse,
  projectView,
  viewCamera,
  type ProjectView,
  type ProjectViewBody,
} from "@rockett/shared";
import { StoreError } from "./jsonStore.js";
import { ID_RE } from "./manifestStore.js";
import { migrate, viewMigrations } from "./migrations.js";
import type { Storage } from "./storage.js";

const LEGACY = "view.json";

function camera(value: unknown): ProjectView["camera"] {
  try {
    return parse(viewCamera, value);
  } catch {
    return null;
  }
}

const stored = (view: ProjectViewBody) =>
  parse(projectView, { ...view, camera: view.camera ?? null }) as ProjectView;

function decode(raw: Buffer | undefined, label: string) {
  if (!raw) return undefined;
  try {
    const view = migrate(viewMigrations, JSON.parse(raw.toString("utf8")));
    return stored({ ...view, camera: camera(view.camera) });
  } catch (err) {
    throw new StoreError(
      `${label} is unreadable: ${(err as Error).message}`,
      "internal",
    );
  }
}

export class ViewStore {
  constructor(
    private readonly storage: Storage,
    private readonly projectDir: (projectId: string) => string,
  ) {}

  private file(userId: string, projectId: string): string {
    if (!ID_RE.test(userId) || !ID_RE.test(projectId))
      throw new StoreError("invalid view id");
    return path.posix.join("users", userId, "views", `${projectId}.json`);
  }

  async read(
    userId: string,
    projectId: string,
  ): Promise<ProjectView | undefined> {
    const raw = await this.storage
      .read(this.file(userId, projectId))
      .catch(() => undefined);
    return decode(raw, `view of project ${projectId}`);
  }

  async legacy(projectId: string): Promise<ProjectView | undefined> {
    const raw = await this.storage
      .read(path.posix.join(this.projectDir(projectId), LEGACY))
      .catch(() => undefined);
    return decode(raw, `project ${projectId} view`);
  }

  encode(
    userId: string,
    projectId: string,
    view: ProjectViewBody,
  ): [string, string] {
    return [
      this.file(userId, projectId),
      JSON.stringify(stored(view), null, 1),
    ];
  }

  async write(
    userId: string,
    projectId: string,
    view: ProjectViewBody,
  ): Promise<ProjectView> {
    await this.storage.writeAtomic(...this.encode(userId, projectId, view));
    return stored(view);
  }

  async remove(projectId: string): Promise<void> {
    for (const userId of await this.storage.list("users"))
      if (ID_RE.test(userId))
        await this.storage.remove(this.file(userId, projectId));
  }
}
