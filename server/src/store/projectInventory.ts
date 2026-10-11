import type { CadDocument, ProjectSummary } from "@rockett/shared";
import type { ProjectStore } from "./projectStore.js";
import { sha256, StoreError } from "./jsonStore.js";
import {
  documentMigrations,
  MissingStepError,
  TooNewError,
} from "./migrations.js";

const sourceTag = (data: Buffer) => `"${sha256(data)}"`;

export const isInvalidProject = (error: unknown): boolean =>
  (error instanceof StoreError &&
    (error.code === "internal" || error.code === "unprocessable")) ||
  error instanceof TooNewError ||
  error instanceof MissingStepError;

function unreadable(
  error: unknown,
  data: Buffer,
  corruptOnly = false,
): Partial<Record<keyof CadDocument, unknown>> {
  if (!isInvalidProject(error)) throw error;
  try {
    const raw: unknown = JSON.parse(data.toString("utf8"));
    if (corruptOnly && error instanceof StoreError && error.code === "internal")
      throw error;
    return typeof raw === "object" && raw !== null ? raw : {};
  } catch (parseError) {
    if (parseError instanceof SyntaxError) return {};
    throw parseError;
  }
}

type RecoveryStore = Pick<
  ProjectStore,
  "documents" | "load" | "projectAccess" | "manifestSource"
>;

async function deleteTag(store: RecoveryStore, id: string, data: Buffer) {
  try {
    await store.projectAccess(id);
  } catch (error) {
    if (!isInvalidProject(error)) throw error;
    const { data: manifest } = await store.manifestSource(id);
    return {
      tag: sourceTag(
        Buffer.concat([Buffer.from(`${data.length}:`), data, manifest]),
      ),
      manifestInvalid: true,
    };
  }
  return { tag: sourceTag(data), manifestInvalid: false };
}

export async function checkDeleteTag(
  store: RecoveryStore,
  id: string,
  header: string,
): Promise<void> {
  const { data } = await store.documents.source(id);
  const snapshot = await deleteTag(store, id, data);
  if (snapshot.tag !== header)
    throw new StoreError(
      "This project changed since it was listed. Reload to continue.",
      "conflict",
    );
  try {
    await store.load(id);
  } catch (error) {
    unreadable(error, data, !snapshot.manifestInvalid);
    return;
  }
  throw new StoreError(
    "This project is readable. Reload before deleting it.",
    "conflict",
  );
}

const text = (v: unknown, fallback: string) =>
  typeof v === "string" ? v : fallback;

export async function listProjects(
  store: RecoveryStore & Pick<ProjectStore, "isTemporary">,
): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const id of await store.documents.keys()) {
    if (await store.isTemporary(id)) continue;
    try {
      const doc = await store.load(id);
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
      const { data } = await store.documents.source(id);
      const raw = unreadable(err, data);
      const tooNew =
        err instanceof TooNewError &&
        err.namespace === documentMigrations.namespace;
      out.push({
        id,
        name: text(raw.name, id),
        createdAt: text(raw.createdAt, ""),
        modifiedAt: text(raw.modifiedAt, ""),
        modifiedBy: typeof raw.modifiedBy === "string" ? raw.modifiedBy : null,
        featureCount: Array.isArray(raw.features) ? raw.features.length : 0,
        deleteTag: (await deleteTag(store, id, data)).tag,
        status: tooNew ? "tooNew" : "invalid",
        error: (err as Error).message,
        ...(tooNew && { schemaVersion: err.version }),
      });
    }
  }
  out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return out;
}
