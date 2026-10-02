import path from "node:path";
import {
  bodyMadeBy,
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
  parse(projectView, {
    ...view,
    hidden: {
      bodies: [...new Set(view.hidden.bodies)],
      features: [...new Set(view.hidden.features)],
    },
    camera: view.camera ?? null,
  }) as ProjectView;

const file = (userId: string, projectId: string) => {
  if (!ID_RE.test(userId) || !ID_RE.test(projectId))
    throw new StoreError("invalid view id");
  return path.posix.join("users", userId, "views", `${projectId}.json`);
};

const encoded = (view: ProjectViewBody) =>
  JSON.stringify(stored(view), null, 1);

async function users(storage: Storage): Promise<string[]> {
  return (await storage.list("users")).filter((id) => ID_RE.test(id));
}

type Hidden = ProjectView["hidden"];

async function rewriteViews(
  storage: Storage,
  projectId: string,
  change: (hidden: Hidden) => Hidden,
): Promise<void> {
  for (const userId of await users(storage)) {
    const at = file(userId, projectId);
    const view = await storage
      .read(at)
      .then((raw) => decode(raw, at))
      .catch(() => undefined);
    if (!view) continue;
    const hidden = change(view.hidden);
    if (JSON.stringify(hidden) === JSON.stringify(view.hidden)) continue;
    await storage.writeAtomic(at, encoded({ ...view, hidden }));
  }
}

export function pruneViews(
  storage: Storage,
  projectId: string,
  featureId: string,
): Promise<void> {
  const kept = (id: string) => id !== featureId && !bodyMadeBy(featureId, id);
  return rewriteViews(storage, projectId, ({ bodies, features }) => ({
    bodies: bodies.filter(kept),
    features: features.filter(kept),
  }));
}

export function remapViews(
  storage: Storage,
  projectId: string,
  moved: ReadonlyMap<string, string>,
): Promise<void> {
  return rewriteViews(storage, projectId, ({ bodies, features }) => ({
    bodies: bodies.map((id) => moved.get(id) ?? id),
    features,
  }));
}

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

  async read(
    userId: string,
    projectId: string,
  ): Promise<ProjectView | undefined> {
    const raw = await this.storage
      .read(file(userId, projectId))
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
    return [file(userId, projectId), encoded(view)];
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
    for (const userId of await users(this.storage))
      await this.storage.remove(file(userId, projectId));
  }
}
