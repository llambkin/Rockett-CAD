import {
  HISTORY_LIMIT,
  HISTORY_VERSION,
  historyRecord,
  parse,
  type HistoryLog,
  type HistoryRecord,
} from "@rockett/shared";
import { sha256, StoreError } from "./jsonStore.js";

const FRAME = 8;

export type History = Omit<HistoryLog, "version">;
type Bodied = Exclude<HistoryRecord, { kind: "checkpoint" | "cursor" }>;

export const bodied = (head: HistoryRecord): head is Bodied =>
  head.kind !== "checkpoint" && head.kind !== "cursor";

interface Framed {
  head: HistoryRecord;
  body: [number, number];
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

function decode(text: string): HistoryRecord | undefined {
  try {
    return parse(historyRecord, JSON.parse(text));
  } catch {
    return undefined;
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
    sha256(log.subarray(start, end)) !== found.snapshot
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

export function snapshotBodies(log: Buffer): Buffer[] {
  const found = records(log);
  const first = found[0]?.head;
  if (
    (found.at(-1)?.body[1] ?? 0) !== log.length ||
    (first && (first.kind !== "base" || first.version !== HISTORY_VERSION))
  )
    throw new StoreError("history log is damaged or too new", "internal");
  return found.flatMap(({ head, body }) =>
    bodied(head) ? [log.subarray(...body)] : [],
  );
}

export function replay(heads: HistoryRecord[]): History {
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
        if (entries.length > HISTORY_LIMIT) base = entries.shift()!.snapshot;
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

export async function compose(
  history: History,
  body: (hash: string) => Promise<Buffer>,
): Promise<Buffer> {
  const { base, entries, position, checkpoints } = history;
  const inEntries = new Set(entries.map((e) => e.snapshot));
  const pinned = new Set(checkpoints.map((c) => c.snapshot));
  pinned.delete(base);
  const out = [
    frame(
      { kind: "base", version: HISTORY_VERSION, snapshot: base },
      await body(base),
    ),
  ];
  for (const snapshot of pinned)
    if (!inEntries.has(snapshot))
      out.push(frame({ kind: "snapshot", snapshot }, await body(snapshot)));
  for (const mark of checkpoints)
    out.push(frame({ kind: "checkpoint", ...mark }));
  for (const [at, entry] of entries.entries()) {
    if (entry.tx !== undefined && entries[at - 1]?.tx === entry.tx)
      out.push(frame({ kind: "cursor", position: at }));
    out.push(frame({ kind: "entry", ...entry }, await body(entry.snapshot)));
  }
  if (position < entries.length) out.push(frame({ kind: "cursor", position }));
  return Buffer.concat(out);
}
