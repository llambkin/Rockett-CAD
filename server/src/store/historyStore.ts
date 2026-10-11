import path from "node:path";
import {
  HISTORY_VERSION,
  LABEL_LIMIT,
  MB,
  type CadDocument,
  type HistoryList,
  type HistoryMark,
  type HistoryRecord,
  type HistoryStatus,
} from "@rockett/shared";
import {
  bodied,
  compose,
  featureFrames,
  frame,
  gunzip,
  hashOf,
  LOG,
  logVersion,
  pack,
  records,
  replay,
  trim,
  unpack,
  type History,
} from "./historyLog.js";
import {
  dropLegacy,
  upgradeLegacy,
  upgradeLog,
  type Project,
} from "./historyUpgrade.js";
import { sha256, StoreError, type Write } from "./jsonStore.js";
import type { Storage } from "./storage.js";
import { HISTORY_LIMITS, PREVIEW_LIMITS, TIMING_MS } from "../tunables.js";

const MARKS = new Set<HistoryRecord["kind"]>(["entry", "checkpoint", "cursor"]);

const tooLarge = () =>
  new StoreError(
    `This history snapshot expands past ${HISTORY_LIMITS.snapshotBytes / MB} MB, the limit.`,
    "internal",
  );

type Revision = () => Promise<number>;
type Change = (
  history: History,
  body: (hash: string) => Buffer,
) => Promise<{ history: History; pinned?: number }>;
type Records = (
  opened: Opened | undefined,
  revision: number,
  file: string,
  text: string,
) => Promise<Buffer[]>;

interface HistoryDocuments<T> {
  save(doc: T, actor: string | null, write: Write<T>): Promise<void>;
  exclusive<R>(id: string, operation: () => Promise<R>): Promise<R>;
  isTemporary(id: string): Promise<boolean>;
  historyDir(id: string): string;
  storedRevision(id: string): Promise<number>;
  restored(stored: unknown, current: T): T;
}

interface Opened {
  heads: HistoryRecord[];
  bodies: Map<string, [number, number]>;
  size: number;
  floor: number;
  stamp: string | undefined;
}

export class HistoryStore<
  T extends { id: string; revision: number } = CadDocument,
> {
  private readonly opened = new Map<string, Opened>();

  constructor(
    private readonly storage: Storage,
    private readonly store: HistoryDocuments<T>,
    private readonly budget: number = HISTORY_LIMITS.bytes,
  ) {}

  forget(id: string): void {
    this.opened.delete(id);
  }

  save(
    doc: T,
    label?: string,
    tx?: string,
    actor: string | null = null,
  ): Promise<void> {
    if (label === undefined) return this.commit(doc, actor);
    return this.commit(doc, actor, async (opened, revision, file, text) => {
      const added: Buffer[] = [];
      const known = new Set(opened?.bodies.keys());
      if (!opened) {
        const stored = await this.storage.read(file);
        const base = await pack(JSON.parse(stored.toString("utf8")), known);
        added.push(
          frame(
            { kind: "base", version: HISTORY_VERSION, snapshot: base.hash },
            base.body,
          ),
          ...featureFrames(base.features),
        );
      }
      const next = await pack(JSON.parse(text), known);
      added.push(
        ...featureFrames(next.features),
        frame(
          {
            kind: "entry",
            label: label.slice(0, LABEL_LIMIT),
            at: new Date().toISOString(),
            snapshot: next.hash,
            revision,
            ...(tx !== undefined && { tx }),
            ...(actor !== null && { by: actor }),
          },
          next.body,
        ),
      );
      return added;
    });
  }

  async peek(
    current: T,
    step: -1 | 1,
  ): Promise<{ document: T; cursor: number }> {
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
    current: T,
    hash: string,
  ): Promise<{ document: T; label: string }> {
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

  private async restored(current: T, hash: string): Promise<T> {
    return this.store.restored(await this.snapshot(current.id, hash), current);
  }

  move(doc: T, cursor: number, actor: string | null = null): Promise<void> {
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
    doc: T,
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
    if (opened && this.over(opened))
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
      const { base, entries, position, checkpoints } = replay(opened.heads);
      if (checkpoints.length >= HISTORY_LIMITS.checkpoints)
        throw new StoreError(
          `This project has ${checkpoints.length} checkpoints, the most it keeps. Delete one to save another.`,
          "conflict",
        );
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

  deleteCheckpoint(id: string, { label, at, snapshot }: HistoryMark) {
    return this.store.exclusive(id, async () => {
      const opened = await this.open(id, () => this.revision(id));
      const history = replay(opened?.heads ?? []);
      const index = history.checkpoints.findIndex(
        (m) => m.label === label && m.at === at && m.snapshot === snapshot,
      );
      if (!opened || index < 0)
        throw new StoreError("This checkpoint is already gone.", "not_found");
      history.checkpoints.splice(index, 1);
      await this.rewrite(id, opened, async () => ({ history }));
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
      const { bodies } = (await this.open(id, () => this.revision(id))) ?? {};
      const corrupted = () =>
        new StoreError(`snapshot ${hash} is corrupted`, "internal");
      let left = HISTORY_LIMITS.snapshotBytes;
      const read = async (part: string) => {
        const range = bodies?.get(part);
        if (!range)
          throw new StoreError(`snapshot ${hash} not found`, "not_found");
        if (left < 1) throw tooLarge();
        const bytes = await this.storage.readRange(
          this.path(id, LOG),
          ...range,
        );
        const text = await gunzip(bytes, { maxOutputLength: left }).catch(
          (error: unknown) => {
            const { code } = error as { code?: string };
            throw code === "ERR_BUFFER_TOO_LARGE" ? tooLarge() : corrupted();
          },
        );
        left -= text.length;
        if (sha256(text) !== part) throw corrupted();
        return JSON.parse(text.toString("utf8"));
      };
      return unpack(await read(hash), read);
    });
  }

  private path(id: string, file: string): string {
    return path.posix.join(this.store.historyDir(id), file);
  }

  private revision(id: string): Promise<number> {
    return this.store.storedRevision(id);
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
        bodies.set(hashOf(head), [body[0] + size, body[1] + size]);
    }
    this.opened.set(id, {
      heads,
      bodies,
      size: size + bytes.length,
      floor: opened?.floor ?? 0,
      stamp: await this.storage.stamp(file),
    });
  }

  private project(id: string): Project {
    return {
      id,
      dir: this.path(id, "."),
      storage: this.storage,
      temporary: () => this.store.isTemporary(id),
    };
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
    if (stamp === undefined)
      return (await upgradeLegacy(this.project(id)))
        ? this.open(id, revision)
        : undefined;
    const log = await this.storage.read(file);
    const found = records(log);
    const version = logVersion(found[0]?.head, `project ${id} history`);
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
    if (version < HISTORY_VERSION) {
      await upgradeLog(this.project(id), log.subarray(0, size));
      return this.open(id, revision);
    }
    if (size < log.length)
      await this.storage.writeAtomic(file, log.subarray(0, size));
    await dropLegacy(this.project(id));
    return this.index(id, log.subarray(0, size));
  }

  private async index(id: string, log: Buffer): Promise<Opened> {
    const heads: HistoryRecord[] = [];
    const bodies = new Map<string, [number, number]>();
    for (const { head, body } of records(log)) {
      heads.push(head);
      if (bodied(head)) bodies.set(hashOf(head), body);
    }
    const opened: Opened = {
      heads,
      bodies,
      size: log.length,
      floor: 0,
      stamp: await this.storage.stamp(this.path(id, LOG)),
    };
    this.opened.set(id, opened);
    return opened;
  }

  private over({ size, floor }: Opened): boolean {
    const { budget } = this;
    return size > (floor < budget ? budget : floor + budget / 2);
  }

  private async compact(id: string): Promise<void> {
    const opened = await this.open(id, () => this.revision(id));
    if (!opened || !this.over(opened)) return;
    await this.rewrite(id, opened, (history, body) =>
      trim(history, body, this.budget),
    );
  }

  private async rewrite(id: string, opened: Opened, change: Change) {
    const file = this.path(id, LOG);
    const log = await this.storage.read(file);
    const body = (hash: string) => log.subarray(...opened.bodies.get(hash)!);
    const { history, pinned = 0 } = await change(replay(opened.heads), body);
    const bytes = await compose(history, body);
    await this.storage.writeAtomic(file, bytes);
    (await this.index(id, bytes)).floor = pinned;
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
