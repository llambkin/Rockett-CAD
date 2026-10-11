import {
  resolvedFeatureInputs,
  resolvedModuleInputFeatures,
} from "./featureInputs.js";
import { Type } from "typebox";
import type { ProjectView } from "./api.js";
import type { AssemblyDocument } from "./assembly.js";
import type { CadDocument } from "./model.js";
import { projectView } from "./routes.js";

export const PROJECT_FILE_FORMAT = "rockett-project";
export const PROJECT_FILE_VERSION = 3;
export const PROJECT_FILE_LIMIT_MB = 64;

export interface ProjectFile {
  format: typeof PROJECT_FILE_FORMAT;
  version: typeof PROJECT_FILE_VERSION;
  document: CadDocument;
  assemblies?: AssemblyDocument[];
  assets: Record<string, string>;
  view?: ProjectView;
}

export function moduleAssetHashes(doc: CadDocument): string[] {
  return Object.values(doc.moduleAssets?.namespaces ?? {}).flat();
}

export function referencedAssets(doc: CadDocument): Set<string> {
  return new Set([
    ...moduleAssetHashes(doc),
    ...resolvedModuleInputFeatures(doc).flatMap((f) =>
      f.type === "referenceImage"
        ? [f.assetId]
        : f.type === "importStep" || f.type === "importMesh"
          ? [f.blob]
          : [...(resolvedFeatureInputs(f, doc)?.assets ?? [])],
    ),
  ]);
}

export const projectFileEnvelope = Type.Object({
  format: Type.Literal(PROJECT_FILE_FORMAT),
  version: Type.Integer({ minimum: 1 }),
  document: Type.Object({ schemaVersion: Type.Integer({ minimum: 1 }) }),
  assemblies: Type.Optional(Type.Array(Type.Unknown())),
  assets: Type.Record(Type.String(), Type.String()),
  view: Type.Optional(projectView),
});
