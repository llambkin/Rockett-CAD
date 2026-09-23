/**
 * Document schema migrations.
 *
 * Every breaking change to the shared model bumps SCHEMA_VERSION and adds a
 * step here so older projects keep opening.
 */

import { SCHEMA_VERSION, type CadDocument } from "@rockett/shared";

type Migration = (doc: any) => any;

/** Keyed by the version the migration upgrades FROM. */
const MIGRATIONS: Record<number, Migration> = {
  1: (doc) => ({ ...doc, schemaVersion: 2 }),
  2: (doc) => ({ ...doc, schemaVersion: 3 }),
  3: (doc) => ({ ...doc, schemaVersion: 4 }),
  4: (doc) => ({ ...doc, schemaVersion: 5 }),
  // 1 → 2 example:
  // 1: (doc) => ({ ...doc, schemaVersion: 2, somethingNew: [] }),
};

export function migrateDocument(doc: any): CadDocument {
  let current = doc;
  let guard = 0;
  while (current.schemaVersion < SCHEMA_VERSION && guard++ < 100) {
    const step = MIGRATIONS[current.schemaVersion];
    if (!step) {
      throw new Error(
        `no migration path from schema ${current.schemaVersion} to ${SCHEMA_VERSION}`,
      );
    }
    current = step(current);
  }
  if (current.schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `project uses schema ${current.schemaVersion}, newer than this server (${SCHEMA_VERSION}) — upgrade the application`,
    );
  }
  return current as CadDocument;
}
