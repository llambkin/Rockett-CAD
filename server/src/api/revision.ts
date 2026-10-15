import type { CadDocument, EvaluateResult } from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";

export class RevisionConflict extends StoreError {
  constructor(readonly revision: number) {
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

export function checkRevision(doc: CadDocument, expected: number): CadDocument {
  if (doc.revision !== expected) throw new RevisionConflict(doc.revision);
  return doc;
}

export function reply(
  res: { set(field: string, value: string): { json(body: unknown): unknown } },
  body: { document: CadDocument; evaluation?: EvaluateResult },
): void {
  res.set("ETag", `"${body.document.revision}"`).json(body);
}
