import { promisify } from "node:util";
import zlib from "node:zlib";
import {
  HISTORY_VERSION,
  historyRecord,
  parse,
  type HistoryLog,
  type HistoryRecord,
} from "@rockett/shared";
import { sha256, StoreError } from "./jsonStore.js";

export const LOG = "history/log.bin";
const FRAME = 8;
const FAST = { level: zlib.constants.Z_BEST_SPEED };
const gzip = promisify(zlib.gzip);
export const gunzip = promisify(zlib.gunzip);

export type History = Omit<HistoryLog, "version">;
type Bodied = Exclude<HistoryRecord, { kind: "checkpoint" | "cursor" }>;
type Snapshot = Exclude<Bodied, { kind: "feature" }>;
type Body = (hash: string) => Buffer | Promise<Buffer>;

export const bodied = (head: HistoryRecord): head is Bodied =>
  head.kind !== "checkpoint" && head.kind !== "cursor";

export const hashOf = (head: Bodied): string =>
  head.kind === "feature" ? head.hash : head.snapshot;

interface Framed {
  head: HistoryRecord;
  body: [number, number];
}

interface Packed {
  hash: string;
  body: Buffer;
  features: Map<string, Buffer>;
}

export function frame(
  head: HistoryRecord,
  body: Uint8Array = Buffer.alloc(0),
): Buffer {
  const text = Buffer.from(JSON.stringify(head));
  const lengths = Buffer.alloc(FRAME);
  lengths.writeUInt32BE(text.length, 0);
  lengths.writeUInt32BE(body.length, 4);
  return Buffer.concat([lengths, text, body]);
}

export const featureFrames = (features: Map<string, Buffer>): Buffer[] =>
  [...features].map(([hash, body]) => frame({ kind: "feature", hash }, body));

function decode(text: string): HistoryRecord | undefined {
  try {
    return parse(historyRecord, JSON.parse(text));
  } catch {
    return undefined;
  }
}

function intact(body: Buffer, hash: string): boolean {
  if (sha256(body) === hash) return true;
  try {
    return sha256(zlib.gunzipSync(body)) === hash;
  } catch {
    return false;
  }
}

function unframe(log: Buffer, at: number): Framed | undefined {
  if (log.length - at < FRAME) return undefined;
  const start = at + FRAME + log.readUInt32BE(at);
  const end = start + log.readUInt32BE(at + 4);
  if (end > log.length) return undefined;
  const found = decode(log.toString("utf8", at + FRAME, start));
  if (!found || bodied(found) === (start === end)) return undefined;
  if (
    bodied(found) &&
    end === log.length &&
    !intact(log.subarray(start, end), hashOf(found))
  )
    return undefined;
  return { head: found, body: [start, end] };
}

export function records(log: Buffer): Framed[] {
  const out: Framed[] = [];
  for (let at = 0, next = unframe(log, 0); next; next = unframe(log, at)) {
    out.push(next);
    at = next.body[1];
  }
  return out;
}

export function logVersion(
  head: HistoryRecord | undefined,
  label = "history log",
): number {
  const version = head?.kind === "base" ? head.version : 0;
  if (head && (version < 2 || version > HISTORY_VERSION))
    throw new StoreError(`${label} is damaged or too new`, "internal");
  return version;
}

export async function inflate(body: Buffer): Promise<unknown> {
  return JSON.parse((await gunzip(body)).toString("utf8"));
}

export async function pack(doc: unknown, known: Set<string>): Promise<Packed> {
  const features = new Map<string, Buffer>();
  const record = doc as { features?: unknown };
  let manifest = doc;
  if (Array.isArray(record.features)) {
    const hashes: string[] = [];
    for (const feature of record.features) {
      const text = JSON.stringify(feature);
      const hash = sha256(text);
      hashes.push(hash);
      if (known.has(hash)) continue;
      known.add(hash);
      features.set(hash, await gzip(text, FAST));
    }
    manifest = { ...record, features: hashes };
  }
  const text = JSON.stringify(manifest);
  return { hash: sha256(text), body: await gzip(text, FAST), features };
}

export async function unpack(
  manifest: unknown,
  read: (hash: string) => Promise<unknown>,
): Promise<unknown> {
  const { features } = manifest as { features?: unknown };
  if (!Array.isArray(features)) return manifest;
  const out: unknown[] = [];
  for (const hash of features) out.push(await read(String(hash)));
  return { ...(manifest as object), features: out };
}

async function featureHashes(manifest: Buffer): Promise<string[]> {
  const { features } = (await inflate(manifest)) as { features?: unknown };
  return Array.isArray(features) ? features.map(String) : [];
}

export async function eachSnapshot(
  log: Buffer,
  visit: (doc: unknown) => void,
): Promise<void> {
  const found = records(log);
  const version = logVersion(found[0]?.head);
  if ((found.at(-1)?.body[1] ?? 0) !== log.length)
    throw new StoreError("history log is damaged or too new", "internal");
  const texts = new Map<string, string>();
  for (const { head, body } of found)
    if (head.kind === "feature")
      texts.set(head.hash, (await gunzip(log.subarray(...body))).toString());
  for (const { head, body } of found) {
    if (!bodied(head) || head.kind === "feature") continue;
    const doc = await inflate(log.subarray(...body));
    if (version < HISTORY_VERSION) visit(doc);
    else
      visit(
        await unpack(doc, async (hash) => {
          const text = texts.get(hash);
          if (text === undefined)
            throw new StoreError(`feature ${hash} is missing`, "internal");
          return JSON.parse(text);
        }),
      );
  }
}

export function replay(heads: HistoryRecord[], cap = Infinity): History {
  let base = "";
  let position = 0;
  let joinable = false;
  const entries: History["entries"] = [];
  const checkpoints: History["checkpoints"] = [];
  for (const record of heads)
    switch (record.kind) {
      case "base":
        base = record.snapshot;
        break;
      case "checkpoint": {
        const { kind: _kind, ...mark } = record;
        checkpoints.push(mark);
        break;
      }
      case "cursor":
        position = record.position;
        joinable = false;
        break;
      case "entry": {
        const { kind: _kind, ...entry } = record;
        entries.splice(position);
        if (
          joinable &&
          entry.tx !== undefined &&
          entries.at(-1)?.tx === entry.tx
        )
          entry.label = entries.pop()!.label;
        entries.push(entry);
        if (entries.length > cap) base = entries.shift()!.snapshot;
        position = entries.length;
        joinable = true;
      }
    }
  return { base, entries, position, checkpoints };
}

export function retained(history: History): Set<string> {
  const marks = [...history.entries, ...history.checkpoints];
  return new Set([history.base, ...marks.map((m) => m.snapshot)]);
}

type Planned = [HistoryRecord, string | undefined];
type Parts = Map<string, string[]>;

async function partsOf(history: History, body: Body): Promise<Parts> {
  const parts: Parts = new Map();
  for (const hash of retained(history))
    parts.set(hash, await featureHashes(await body(hash)));
  return parts;
}

function plan(history: History, parts: Parts): Planned[] {
  const { base, entries, position, checkpoints } = history;
  const written = new Set<string>();
  const out: Planned[] = [];
  const add = (head: Snapshot) => {
    const features: Planned[] = [];
    for (const hash of parts.get(head.snapshot)!)
      if (!written.has(hash)) {
        written.add(hash);
        features.push([{ kind: "feature", hash }, hash]);
      }
    const own: Planned = [head, head.snapshot];
    if (head.kind === "base") out.push(own, ...features);
    else out.push(...features, own);
  };
  const inEntries = new Set(entries.map((e) => e.snapshot));
  const pinned = new Set(checkpoints.map((c) => c.snapshot));
  pinned.delete(base);
  add({ kind: "base", version: HISTORY_VERSION, snapshot: base });
  for (const snapshot of pinned)
    if (!inEntries.has(snapshot)) add({ kind: "snapshot", snapshot });
  for (const mark of checkpoints)
    out.push([{ kind: "checkpoint", ...mark }, undefined]);
  for (const [at, entry] of entries.entries()) {
    if (entry.tx !== undefined && entries[at - 1]?.tx === entry.tx)
      out.push([{ kind: "cursor", position: at }, undefined]);
    add({ kind: "entry", ...entry });
  }
  if (position < entries.length)
    out.push([{ kind: "cursor", position }, undefined]);
  return out;
}

export async function trim(
  history: History,
  body: (hash: string) => Buffer,
  budget: number,
): Promise<{ history: History; pinned: number }> {
  const parts = await partsOf(history, body);
  const dropped = (k: number): History =>
    k === 0
      ? history
      : {
          ...history,
          base: history.entries[k - 1]!.snapshot,
          entries: history.entries.slice(k),
          position: history.position - k,
        };
  const size = (k: number) =>
    plan(dropped(k), parts).reduce(
      (total, [head, hash]) =>
        total +
        FRAME +
        Buffer.byteLength(JSON.stringify(head)) +
        (hash === undefined ? 0 : body(hash).length),
      0,
    );
  const pinned = size(history.position);
  const target = pinned + Math.max(0, budget - pinned) / 2;
  let low = 0;
  let high = history.position;
  if (high > 0 && size(high - 1) <= budget) high -= 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (size(mid) <= target) high = mid;
    else low = mid + 1;
  }
  return { history: dropped(low), pinned };
}

export async function compose(history: History, body: Body): Promise<Buffer> {
  const out: Buffer[] = [];
  for (const [head, hash] of plan(history, await partsOf(history, body)))
    out.push(frame(head, hash === undefined ? undefined : await body(hash)));
  return Buffer.concat(out);
}
