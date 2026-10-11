import {
  PREVIEW_HEADER,
  TX_HEADER,
  TX_ID,
  type CadDocument,
  type EvaluateResult,
  type HistoryStatus,
} from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";

export class RevisionConflict extends StoreError {
  constructor(
    readonly revision: number,
    readonly draft?: CadDocument,
  ) {
    super(
      "This project changed since you last loaded it. Reload to continue.",
      "conflict",
    );
  }
}

export function ifMatchRevision(header: string | undefined): number {
  if (header === undefined)
    throw new StoreError(
      "Send If-Match with the document revision you last received.",
      "precondition_required",
    );
  const match = /^"(\d+)"$/.exec(header);
  if (!match)
    throw new StoreError(
      'If-Match must be one quoted document revision, such as "3".',
    );
  return Number(match[1]);
}

export function transactionId(header: string | undefined): string | undefined {
  if (header === undefined || TX_ID.test(header)) return header;
  throw new StoreError(
    `${TX_HEADER} must be 1 to 64 letters, digits, underscores or dashes.`,
  );
}

export function previewSequence(header: string): number {
  if (/^[1-9]\d{0,8}$/.test(header)) return Number(header);
  throw new StoreError(
    `${PREVIEW_HEADER} must be a whole number from 1 to 999999999.`,
  );
}

export function checkRevision<T extends { revision: number }>(
  doc: T,
  expected: number,
): T {
  if (doc.revision !== expected) throw new RevisionConflict(doc.revision);
  return doc;
}

export function reply(
  res: { set(field: string, value: string): { json(body: unknown): unknown } },
  body: {
    document: { revision: number };
    evaluation?: EvaluateResult;
    history?: HistoryStatus;
  },
): void {
  res.set("ETag", `"${body.document.revision}"`).json(body);
}
