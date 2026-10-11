import path from "node:path";
import { historyLog, parse, type HistoryLog } from "@rockett/shared";
import { BlobStore } from "./blobStore.js";
import {
  bodied,
  compose,
  inflate,
  hashOf,
  LOG,
  pack,
  records,
  replay,
  retained,
  type History,
} from "./historyLog.js";
import { backupNamespace, StoreError } from "./jsonStore.js";
import type { Storage } from "./storage.js";

const LEGACY_LOG = "history/log.json";
const LEGACY_SNAPSHOTS = "history/snapshots";
const VERSION_2_ENTRIES = 50;

export interface Project {
  id: string;
  dir: string;
  storage: Storage;
  temporary: () => Promise<boolean>;
}

type Read = (hash: string) => Promise<Buffer>;

function readable(history: History, ok: Set<string>): History | undefined {
  const states = [history.base, ...history.entries.map((e) => e.snapshot)];
  const kept = [...states.keys()].filter((n) => ok.has(states[n]!));
  const first = kept[0];
  if (first === undefined) return undefined;
  const reached = kept.filter((n) => n <= history.position).length;
  return {
    base: states[first]!,
    entries: kept.slice(1).map((n) => history.entries[n - 1]!),
    position: Math.max(0, reached - 1),
    checkpoints: history.checkpoints.filter((m) => ok.has(m.snapshot)),
  };
}

async function convert(
  stored: History,
  read: Read,
): Promise<Buffer | undefined> {
  const bodies = new Map<string, Buffer>();
  const known = new Set<string>();
  const renamed = new Map<string, string>();
  for (const hash of retained(stored)) {
    const doc = await read(hash)
      .then(inflate)
      .catch(() => undefined);
    if (!doc || typeof doc !== "object") continue;
    const packed = await pack(doc, known);
    renamed.set(hash, packed.hash);
    bodies.set(packed.hash, packed.body);
    for (const [feature, body] of packed.features) bodies.set(feature, body);
  }
  const history = readable(stored, new Set(renamed.keys()));
  if (!history) return undefined;
  const mark = <T extends { snapshot: string }>(m: T): T => ({
    ...m,
    snapshot: renamed.get(m.snapshot)!,
  });
  const upgraded = {
    ...history,
    base: renamed.get(history.base)!,
    entries: history.entries.map(mark),
    checkpoints: history.checkpoints.map(mark),
  };
  return compose(upgraded, (hash) => bodies.get(hash)!);
}

async function backup(project: Project, version: string, files: string[]) {
  if (await project.temporary()) return;
  await backupNamespace(project.storage, project.dir).backup(version, files);
}

const file = (project: Project, name: string) =>
  path.posix.join(project.dir, name);

export async function upgradeLegacy(project: Project): Promise<boolean> {
  const { storage, id } = project;
  const raw = await storage
    .read(file(project, LEGACY_LOG))
    .catch(() => undefined);
  if (!raw) return false;
  let legacy: HistoryLog;
  try {
    legacy = parse(historyLog, JSON.parse(raw.toString("utf8")));
  } catch (err) {
    throw new StoreError(
      `project ${id} history is damaged: ${(err as Error).message}`,
      "internal",
    );
  }
  const snapshots = await storage.list(file(project, LEGACY_SNAPSHOTS));
  await backup(project, "history1", [
    LEGACY_LOG,
    ...snapshots.map((name) => `${LEGACY_SNAPSHOTS}/${name}`),
  ]);
  const blobs = new BlobStore(storage, file(project, LEGACY_SNAPSHOTS));
  const { version: _version, ...history } = legacy;
  const log = await convert(history, (hash) => blobs.get(hash));
  if (log) await storage.writeAtomic(file(project, LOG), log);
  else {
    await storage.remove(file(project, LEGACY_SNAPSHOTS));
    await storage.remove(file(project, LEGACY_LOG));
  }
  return log !== undefined;
}

export async function upgradeLog(project: Project, log: Buffer) {
  await backup(project, "history2", [LOG]);
  const found = records(log);
  const bodies = new Map<string, [number, number]>();
  for (const { head, body } of found)
    if (bodied(head)) bodies.set(hashOf(head), body);
  const history = replay(
    found.map(({ head }) => head),
    VERSION_2_ENTRIES,
  );
  const upgraded = await convert(history, async (hash) => {
    const range = bodies.get(hash);
    if (!range)
      throw new StoreError(
        `project ${project.id} history is damaged: snapshot ${hash} is missing`,
        "internal",
      );
    return log.subarray(...range);
  });
  if (upgraded) await project.storage.writeAtomic(file(project, LOG), upgraded);
  else await project.storage.remove(file(project, LOG));
}

export async function dropLegacy(project: Project): Promise<void> {
  const { storage } = project;
  if ((await storage.list(file(project, "history"))).length === 1) return;
  await storage.remove(file(project, LEGACY_SNAPSHOTS));
  await storage.remove(file(project, LEGACY_LOG));
}
