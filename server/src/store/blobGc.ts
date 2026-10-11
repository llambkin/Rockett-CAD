import path from "node:path";
import {
  featureSpec,
  referencedAssets,
  type BlobCollection,
  type CadDocument,
} from "@rockett/shared";
import { HASH_RE } from "./blobStore.js";
import { eachSnapshot, inflate, LOG } from "./historyLog.js";
import {
  BACKUP_RECORD as RECORD,
  BACKUP_DELETED,
  backupNamespace,
  sha256,
} from "./jsonStore.js";
import {
  documentMigrations,
  migrate,
  type MigrationContext,
} from "./migrations.js";
import type { ProjectStore } from "./projectStore.js";
import { TIMING_MS } from "../tunables.js";

const DOCUMENT = /^(document\.json|documents\/[^/]+\.json)$/;
const SNAPSHOT = /^history\/snapshots\/[0-9a-f]{64}$/;

const HASHING: MigrationContext = {
  put: sha256,
  asset: () => undefined,
  show() {},
  setting() {},
};

class Skip extends Error {}

type Read = (name: string) => Promise<Buffer>;

export async function collectBlobs(
  store: ProjectStore,
  id: string,
  previews: CadDocument[],
  dryRun: boolean,
  now = Date.now(),
): Promise<BlobCollection> {
  const result = await store.documents.exclusive(id, () =>
    collect(store, id, previews, dryRun, now),
  );
  if (!dryRun) {
    const { storage, root: projectRoot, key } = store.documents.options;
    for (const deletedId of await storage.list(
      path.posix.join("backups", projectRoot),
    )) {
      if (!key.test(deletedId)) continue;
      const dir = store.documents.dir(deletedId);
      await store.documents.exclusive(deletedId, async () => {
        if (await storage.stamp(dir)) return;
        await backupNamespace(storage, dir).prune(false, now);
      });
    }
  }
  return result;
}

async function collect(
  store: ProjectStore,
  id: string,
  previews: CadDocument[],
  dryRun: boolean,
  now: number,
): Promise<BlobCollection> {
  const blobs = store.blobs(id);
  const all = await blobs.list();
  let kept: Set<string>;
  try {
    kept = await roots(store, id, previews);
  } catch (err) {
    if (!(err instanceof Skip)) throw err;
    return { dryRun, skipped: err.message, kept: all.length, orphans: [] };
  }
  const orphans: string[] = [];
  for (const hash of all)
    if (
      !kept.has(hash) &&
      now - (await blobs.modified(hash)) >= TIMING_MS.orphanBlobAge
    )
      orphans.push(hash);
  if (!dryRun) {
    const { storage } = store.documents.options;
    await backupNamespace(storage, store.documents.dir(id)).prune(true, now);
    for (const hash of orphans) await blobs.remove(hash);
  }
  return { dryRun, skipped: null, kept: all.length - orphans.length, orphans };
}

async function roots(
  store: ProjectStore,
  id: string,
  previews: CadDocument[],
): Promise<Set<string>> {
  const { storage, validate } = store.documents.options;
  const dir = store.documents.dir(id);
  const kept = new Set<string>();
  const named = (label: string, raw: unknown) => {
    const doc = migrate<CadDocument>(documentMigrations, raw, HASHING);
    for (const feature of Array.isArray(doc.features) ? doc.features : [])
      if (!featureSpec(feature?.type))
        throw new Skip(
          `${label} names unknown feature type ${String(feature?.type)}`,
        );
    if (Object.keys(doc.extensions ?? {}).length)
      throw new Skip(`${label} has extension data`);
    validate?.(doc);
    for (const hash of referencedAssets(doc))
      if (HASH_RE.test(hash)) kept.add(hash);
  };
  const files = async (label: string, names: string[], read: Read) => {
    for (const name of names) {
      const file = `${label} ${name}`;
      if (DOCUMENT.test(name))
        await root(file, async () =>
          named(file, JSON.parse((await read(name)).toString("utf8"))),
        );
      else if (SNAPSHOT.test(name))
        await root(file, async () =>
          named(file, await inflate(await read(name))),
        );
      else if (name === LOG)
        await root(file, async () =>
          eachSnapshot(await read(name), (doc) => named(file, doc)),
        );
    }
  };
  const backups = backupNamespace(storage, dir);
  await root("manifest", () => store.projectAccess(id));
  await root("project", async () =>
    files("project", await storage.files(dir), (name) =>
      storage.read(path.posix.join(dir, name)),
    ),
  );
  await root("preview", async () => {
    for (const doc of previews) named("preview", doc);
  });
  const names = await root("backups", () => backups.names());
  for (const name of names.filter((n) => n !== RECORD && n !== BACKUP_DELETED))
    await root(`backup ${name}`, async () => {
      const sums = new Map(await backups.verify(name));
      await files(`backup ${name}`, [...sums.keys()], (file) =>
        backups.verified(name, file, sums.get(file)!),
      );
    });
  if (names.includes(RECORD))
    await root("recovery record", async () => {
      const record = JSON.parse(
        (await storage.read(path.posix.join("backups", dir, RECORD))).toString(
          "utf8",
        ),
      ) as { backup: unknown; created?: unknown };
      if (typeof record.backup !== "string" || !names.includes(record.backup))
        throw new Error("names a missing backup");
      const created = record.created ?? [];
      if (!Array.isArray(created)) throw new Error("created is not a list");
      const blobDir = path.posix.join(dir, "blobs");
      for (const [file] of created as Array<[unknown]>)
        if (typeof file === "string" && path.posix.dirname(file) === blobDir)
          kept.add(path.posix.basename(file));
    });
  return kept;
}

async function root<T>(label: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof Skip) throw err;
    const { code, message, syscall } = err as NodeJS.ErrnoException;
    throw new Skip(`unreadable ${label}: ${syscall ? code : message}`);
  }
}
