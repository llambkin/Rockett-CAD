import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import {
  HISTORY_LIMIT,
  HISTORY_VERSION,
  LABEL_LIMIT,
  historyLog,
  parse,
  type CadDocument,
  type HistoryList,
  type HistoryLog,
  type HistoryMark,
  type HistoryRecord,
  type HistoryStatus,
} from "@rockett/shared";
import { BlobStore } from "./blobStore.js";
import {
  bodied,
  compose,
  frame,
  records,
  replay,
  retained,
  type History,
} from "./historyLog.js";
import { backupNamespace, sha256, StoreError } from "./jsonStore.js";
import { ID_RE } from "./manifestStore.js";
import { documentMigrations, migrate } from "./migrations.js";
import type { ProjectStore } from "./projectStore.js";
import type { Storage } from "./storage.js";
import { PREVIEW_LIMITS, TIMING_MS } from "../tunables.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const FAST = { level: zlib.constants.Z_BEST_SPEED };
const LOG = "history/log.bin";
const LEGACY_LOG = "history/log.json";
const LEGACY_SNAPSHOTS = "history/snapshots";
const MARKS = new Set<HistoryRecord["kind"]>(["entry", "checkpoint", "cursor"]);

type Revision = () => Promise<number>;
type Records = (
  opened: Opened | undefined,
  revision: number,
  file: string,
  text: string,
) => Promise<Buffer[]>;

interface Opened {
  heads: HistoryRecord[];
  bodies: Map<string, [number, number]>;
  size: number;
  stamp: string | undefined;
}

function waste(opened: Opened): number {
  return opened.bodies.size - retained(replay(opened.heads)).size;
}

export class HistoryStore {
  private readonly opened = new Map<string, Opened>();

  constructor(
    private readonly storage: Storage,
    private readonly store: ProjectStore,
  ) {}

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    this.opened.delete(id);
  }

  save(
    doc: CadDocument,
    label?: string,
    tx?: string,
    actor: string | null = null,
  ): Promise<void> {
    if (label === undefined) return this.commit(doc, actor);
    return this.commit(doc, actor, async (opened, revision, file, text) => {
      const added: Buffer[] = [];
      if (!opened) {
        const stored = await gzip(await this.storage.read(file), FAST);
        const base = sha256(stored);
        added.push(
          frame(
            { kind: "base", version: HISTORY_VERSION, snapshot: base },
            stored,
          ),
        );
      }
      const body = await gzip(text, FAST);
      added.push(
        frame(
          {
            kind: "entry",
            label: label.slice(0, LABEL_LIMIT),
            at: new Date().toISOString(),
            snapshot: sha256(body),
            revision,
            ...(tx !== undefined && { tx }),
            ...(actor !== null && { by: actor }),
          },
          body,
        ),
      );
      return added;
    });
  }

  async peek(
    current: CadDocument,
    step: -1 | 1,
  ): Promise<{ document: CadDocument; cursor: number }> {
    const state = await this.read(current.id);
    const cursor = (state?.position ?? 0) + step;
    if (!state || cursor < 0 || cursor > state.entries.length)
      throw new StoreError(
        step < 0 ? "Nothing to undo." : "Nothing to redo.",
        "conflict",
      );
    const hash = state.entries[cursor - 1]?.snapshot ?? state.base;
    return { document: await this.restored(current, hash), cursor };
  }

  async restore(
    current: CadDocument,
    hash: string,
  ): Promise<{ document: CadDocument; label: string }> {
    const state = await this.read(current.id);
    const mark = [
      ...(state?.checkpoints ?? []),
      ...(state?.entries ?? []),
    ].find((m) => m.snapshot === hash);
    if (!mark) throw new StoreError(`snapshot ${hash} not found`, "not_found");
    return {
      document: await this.restored(current, hash),
      label: `Restore ${mark.label}`,
    };
  }

  private async restored(
    current: CadDocument,
    hash: string,
  ): Promise<CadDocument> {
    const stored = await this.snapshot(current.id, hash);
    const document = migrate<CadDocument>(documentMigrations, stored);
    return { ...document, name: current.name };
  }

  move(
    doc: CadDocument,
    cursor: number,
    actor: string | null = null,
  ): Promise<void> {
    return this.commit(doc, actor, async (opened, revision) => {
      if (!opened)
        throw new StoreError(`project ${doc.id} has no history to move`);
      return [frame({ kind: "cursor", position: cursor, revision })];
    });
  }

  async status(id: string): Promise<HistoryStatus> {
    const { entries = [], position = 0 } = (await this.read(id)) ?? {};
    return {
      canUndo: position > 0,
      canRedo: position < entries.length,
      undoLabel: entries[position - 1]?.label ?? null,
      redoLabel: entries[position]?.label ?? null,
    };
  }

  private async commit(
    doc: CadDocument,
    actor: string | null,
    makeRecords?: Records,
  ): Promise<void> {
    const { id } = doc;
    await this.store.save(doc, actor, async (file, text, saved) => {
      const opened = await this.open(id, async () => saved.revision - 1);
      if (!makeRecords) return this.storage.writeAtomic(file, text);
      const added = await makeRecords(opened, saved.revision, file, text);
      await this.append(id, opened, added, () =>
        this.storage.writeAtomic(file, text),
      );
    });
    const opened = this.opened.get(id);
    if (opened && waste(opened) >= HISTORY_LIMIT)
      void this.store
        .exclusive(id, () => this.compact(id))
        .catch((err: Error) =>
          console.error(`[rockett] project ${id} history: ${err.message}`),
        );
  }

  checkpoint(
    id: string,
    label: string,
    actor: string | null = null,
  ): Promise<HistoryMark> {
    return this.store.exclusive(id, async () => {
      const opened = await this.open(id, () => this.revision(id));
      if (!opened) {
        await this.revision(id);
        throw new StoreError(`project ${id} has no history to checkpoint`);
      }
      const { base, entries, position } = replay(opened.heads);
      const mark = {
        label: label.slice(0, LABEL_LIMIT),
        at: new Date().toISOString(),
        snapshot: entries[position - 1]?.snapshot ?? base,
        ...(actor !== null && { by: actor }),
      };
      await this.append(id, opened, [frame({ kind: "checkpoint", ...mark })]);
      return mark;
    });
  }

  async list(id: string): Promise<HistoryList> {
    await this.revision(id);
    const {
      entries = [],
      position = 0,
      checkpoints = [],
    } = (await this.read(id)) ?? {};
    const marks = entries.map(
      ({ tx: _tx, revision: _revision, ...mark }) => mark,
    );
    return { entries: marks, position, checkpoints };
  }

  read(id: string): Promise<History | undefined> {
    return this.store.exclusive(id, async () => {
      const opened = await this.open(id, () => this.revision(id));
      return opened && replay(opened.heads);
    });
  }

  snapshot(id: string, hash: string): Promise<unknown> {
    return this.store.exclusive(id, async () => {
      const range = (await this.open(id, () => this.revision(id)))?.bodies.get(
        hash,
      );
      if (!range)
        throw new StoreError(`snapshot ${hash} not found`, "not_found");
      const bytes = await this.storage.readRange(this.path(id, LOG), ...range);
      if (sha256(bytes) !== hash)
        throw new StoreError(`snapshot ${hash} is corrupted`, "internal");
      return JSON.parse((await gunzip(bytes)).toString("utf8"));
    });
  }

  private path(id: string, file: string): string {
    if (!ID_RE.test(id)) throw new StoreError("invalid project id");
    return path.posix.join("projects", id, file);
  }

  private async revision(id: string): Promise<number> {
    const stored = (await this.store.documents.stored(id)) as {
      revision?: unknown;
    };
    return typeof stored.revision === "number" ? stored.revision : 0;
  }

  private async append(
    id: string,
    opened: Opened | undefined,
    added: Buffer[],
    then?: () => Promise<void>,
  ): Promise<void> {
    const bytes = Buffer.concat(added);
    const file = this.path(id, LOG);
    try {
      await this.storage.append(file, bytes);
      await then?.();
    } catch (err) {
      this.opened.delete(id);
      await this.open(id, () => this.revision(id));
      throw err;
    }
    const size = opened?.size ?? 0;
    const bodies = new Map(opened?.bodies);
    const heads = [...(opened?.heads ?? [])];
    for (const { head, body } of records(bytes)) {
      heads.push(head);
      if (bodied(head))
        bodies.set(head.snapshot, [body[0] + size, body[1] + size]);
    }
    this.opened.set(id, {
      heads,
      bodies,
      size: size + bytes.length,
      stamp: await this.storage.stamp(file),
    });
  }

  private async open(
    id: string,
    revision: Revision,
  ): Promise<Opened | undefined> {
    const file = this.path(id, LOG);
    const stamp = await this.storage.stamp(file);
    const known = this.opened.get(id);
    if (known && stamp !== undefined && known.stamp === stamp) return known;
    this.opened.delete(id);
    if (stamp === undefined) return this.migrate(id, revision);
    const log = await this.storage.read(file);
    const found = records(log);
    const first = found[0]?.head;
    if (first && (first.kind !== "base" || first.version !== HISTORY_VERSION))
      throw new StoreError(
        `project ${id} history is damaged or too new`,
        "internal",
      );
    const last = found.at(-1)?.head;
    if (
      (last?.kind === "entry" || last?.kind === "cursor") &&
      (last.revision ?? 0) > (await revision())
    )
      found.pop();
    while (found.length && !MARKS.has(found.at(-1)!.head.kind)) found.pop();
    const size = found.at(-1)?.body[1] ?? 0;
    if (size === 0) {
      await this.storage.remove(file);
      return undefined;
    }
    if (size < log.length)
      await this.storage.writeAtomic(file, log.subarray(0, size));
    await this.dropLegacy(id);
    return this.index(id, log.subarray(0, size));
  }

  private async index(id: string, log: Buffer): Promise<Opened> {
    const heads: HistoryRecord[] = [];
    const bodies = new Map<string, [number, number]>();
    for (const { head, body } of records(log)) {
      heads.push(head);
      if (bodied(head)) bodies.set(head.snapshot, body);
    }
    const opened: Opened = {
      heads,
      bodies,
      size: log.length,
      stamp: await this.storage.stamp(this.path(id, LOG)),
    };
    this.opened.set(id, opened);
    return opened;
  }

  private async compact(id: string): Promise<void> {
    const opened = await this.open(id, () => this.revision(id));
    if (!opened || waste(opened) < HISTORY_LIMIT) return;
    const file = this.path(id, LOG);
    const log = await this.storage.read(file);
    const bytes = await compose(replay(opened.heads), async (hash) =>
      log.subarray(...opened.bodies.get(hash)!),
    );
    await this.storage.writeAtomic(file, bytes);
    await this.index(id, bytes);
  }

  private async migrate(
    id: string,
    revision: Revision,
  ): Promise<Opened | undefined> {
    const raw = await this.storage
      .read(this.path(id, LEGACY_LOG))
      .catch(() => undefined);
    if (!raw) return undefined;
    let legacy: HistoryLog;
    try {
      legacy = parse(historyLog, JSON.parse(raw.toString("utf8")));
    } catch (err) {
      throw new StoreError(
        `project ${id} history is damaged: ${(err as Error).message}`,
        "internal",
      );
    }
    const snapshots = await this.storage.list(this.path(id, LEGACY_SNAPSHOTS));
    if (!(await this.store.isTemporary(id)))
      await backupNamespace(this.storage, this.path(id, ".")).backup(
        "history1",
        [LEGACY_LOG, ...snapshots.map((name) => `${LEGACY_SNAPSHOTS}/${name}`)],
      );
    const blobs = new BlobStore(this.storage, this.path(id, LEGACY_SNAPSHOTS));
    const { version: _version, ...history } = legacy;
    await this.storage.writeAtomic(
      this.path(id, LOG),
      await compose(history, (hash) => blobs.get(hash)),
    );
    return this.open(id, revision);
  }

  private async dropLegacy(id: string): Promise<void> {
    if ((await this.storage.list(this.path(id, "history"))).length === 1)
      return;
    await this.storage.remove(this.path(id, LEGACY_SNAPSHOTS));
    await this.storage.remove(this.path(id, LEGACY_LOG));
  }
}

export interface Preview {
  owner: string;
  seq: number;
  label: string;
  document: CadDocument;
}

interface Held {
  preview: Preview;
  bytes: number;
  touched: number;
}

export class Previews {
  private readonly open = new Map<string, Held>();
  private bytes = 0;

  constructor(private readonly budget: number = PREVIEW_LIMITS.bytes) {}

  find(project: string, tx: string, owner: string): Preview | undefined {
    const now = Date.now();
    for (const [key, held] of this.open)
      if (now - held.touched >= TIMING_MS.previewIdle) this.drop(key);
    const found = this.open.get(`${project}/${tx}`)?.preview;
    if (found && found.owner !== owner)
      throw new StoreError(
        "This preview belongs to another user or session.",
        "forbidden",
      );
    return found;
  }

  keep(project: string, tx: string, preview: Preview): void {
    const key = `${project}/${tx}`;
    const held = this.open.get(key);
    const bytes =
      held?.preview.document === preview.document
        ? held.bytes
        : Buffer.byteLength(JSON.stringify(preview.document));
    this.drop(key);
    this.open.set(key, { preview, bytes, touched: Date.now() });
    this.bytes += bytes;
    for (const oldest of this.open.keys()) {
      if (this.bytes <= this.budget) break;
      this.drop(oldest);
    }
  }

  documents(project: string): CadDocument[] {
    return [...this.open]
      .filter(([key]) => key.startsWith(`${project}/`))
      .map(([, held]) => held.preview.document);
  }

  end(project: string, tx: string): void {
    this.drop(`${project}/${tx}`);
  }

  private drop(key: string): void {
    this.bytes -= this.open.get(key)?.bytes ?? 0;
    this.open.delete(key);
  }
}
