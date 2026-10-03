import { Type } from "typebox";
import type { CadDocument } from "./model.js";

export const PROJECT_FILE_FORMAT = "rockett-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_LIMIT_MB = 64;

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: typeof PROJECT_FILE_VERSION;
  document: CadDocument;
  assets: Record<string, string>;
}

export function referencedAssets(doc: CadDocument): Set<string> {
  return new Set(
    doc.features.flatMap((f) =>
      f.type === "referenceImage"
        ? [f.assetId]
        : f.type === "importStep" || f.type === "importMesh"
          ? [f.blob]
          : [],
    ),
  );
}

export const projectFileEnvelope = Type.Object({
  format: Type.Literal(PROJECT_FILE_FORMAT),
  version: Type.Integer({ minimum: 1 }),
  document: Type.Object({ schemaVersion: Type.Integer({ minimum: 1 }) }),
  assets: Type.Record(Type.String(), Type.String()),
});
