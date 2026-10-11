import { Type, type Static } from "typebox";
import type { HistoryList, HistoryMark } from "../api.js";
import { route } from "../routeContract.js";

export const HISTORY_VERSION = 3;
export const LABEL_LIMIT = 200;
export const TX_HEADER = "X-Rockett-Tx";
export const TX_ID = /^[\w-]{1,64}$/;

const txId = Type.String({ pattern: TX_ID.source });

export { blobHashSchema as snapshotHash } from "./assets.js";
import { blobHashSchema as snapshotHash } from "./assets.js";
const label = Type.String({ minLength: 1, maxLength: LABEL_LIMIT });
const markFields = {
  label,
  at: Type.String(),
  snapshot: snapshotHash,
  by: Type.Optional(Type.String({ minLength: 1 })),
};
const mark = Type.Object(markFields);
const entryFields = {
  ...markFields,
  tx: Type.Optional(txId),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
};
const entry = Type.Object(entryFields);

export const historyLog = Type.Object({
  version: Type.Literal(1),
  base: snapshotHash,
  entries: Type.Array(entry),
  position: Type.Integer({ minimum: 0 }),
  checkpoints: Type.Array(mark),
});

export type HistoryLog = Static<typeof historyLog>;

export const historyRecord = Type.Union([
  Type.Object({
    kind: Type.Literal("base"),
    version: Type.Integer({ minimum: 1 }),
    snapshot: snapshotHash,
  }),
  Type.Object({ kind: Type.Literal("snapshot"), snapshot: snapshotHash }),
  Type.Object({ kind: Type.Literal("feature"), hash: snapshotHash }),
  Type.Object({ kind: Type.Literal("checkpoint"), ...markFields }),
  Type.Object({ kind: Type.Literal("entry"), ...entryFields }),
  Type.Object({
    kind: Type.Literal("cursor"),
    position: Type.Integer({ minimum: 0 }),
    revision: Type.Optional(Type.Integer({ minimum: 1 })),
  }),
]);

export type HistoryRecord = Static<typeof historyRecord>;

export const CHECKPOINT_ROUTES = {
  history: route<never, HistoryList>()("GET", "/projects/:id/history"),
  createCheckpoint: route<{ label: string }, { checkpoint: HistoryMark }>()(
    "POST",
    "/projects/:id/checkpoints",
    Type.Object({ label }),
  ),
  deleteCheckpoint: route<
    Pick<HistoryMark, "label" | "at" | "snapshot">,
    { ok: true }
  >()(
    "DELETE",
    "/projects/:id/checkpoints",
    Type.Object(
      { label, at: Type.String(), snapshot: snapshotHash },
      { additionalProperties: false },
    ),
  ),
};
