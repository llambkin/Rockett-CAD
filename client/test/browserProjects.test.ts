import { expect, it } from "vitest";
import {
  createEmptyDocument,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  type ProjectFile,
} from "@rockett/shared";
import { fromProjectFile, toProjectFile } from "../src/browserProjects";

it("converts an EXCH-013 file to a record and back unchanged", async () => {
  const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
  const file: ProjectFile = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    document: createEmptyDocument("d1", "Motor mount"),
    assets: { a1: Buffer.from(bytes).toString("base64") },
  };
  const record = fromProjectFile(file);
  expect(record.key).toMatch(/^[0-9a-f]{32}$/);
  expect(record).toMatchObject({
    name: "Motor mount",
    featureCount: 0,
    revision: 1,
    size: Buffer.byteLength(JSON.stringify(file.document)) + bytes.length,
  });
  expect(record.assets.a1).toBeInstanceOf(Blob);
  expect(fromProjectFile(file).key).not.toBe(record.key);
  expect(await toProjectFile(record)).toEqual(file);
});
