import {
  featureSpec,
  PROJECT_FILE_LIMIT_MB,
  MB,
  resolvedFeatureInputs,
  resolvedModuleInputFeatures,
  type CadDocument,
  type Feature,
  type FeatureStatus,
  type ResolvedFeatureInputs,
} from "@rockett/shared";
import type { Sources } from "../geometry/importers.js";
import { HASH_RE } from "../store/blobStore.js";
import { sha256, StoreError } from "../store/jsonStore.js";

function importBlobs(doc: CadDocument): string[] {
  return doc.features.flatMap((f) =>
    f.type === "importStep" || f.type === "importMesh" ? [f.blob] : [],
  );
}

export function imageBlobs(doc: CadDocument): string[] {
  return doc.features.flatMap((f) =>
    f.type === "referenceImage" && HASH_RE.test(f.assetId) ? [f.assetId] : [],
  );
}

function checkedSource(
  hash: string,
  bytes: Uint8Array | undefined,
  total: number,
): number {
  if (!bytes)
    throw new StoreError(`module source ${hash} not found`, "not_found");
  total += bytes.byteLength;
  if (total > PROJECT_FILE_LIMIT_MB * MB)
    throw new StoreError(
      "module feature source bytes are too large",
      "too_large",
    );
  if (sha256(bytes) !== hash)
    throw new StoreError(`module source ${hash} is corrupted`, "internal");
  return total;
}

export function checkedFeatureInputs(
  feature: Feature,
  doc: Pick<CadDocument, "extensions">,
  sources: Sources,
): ResolvedFeatureInputs | undefined {
  const input = resolvedFeatureInputs(feature, doc);
  if (!input) return;
  let total = 0;
  for (const hash of input.assets) {
    total = checkedSource(hash, sources.get(hash), total);
  }
  return input;
}

export function featureKey(
  feature: object,
  doc?: Pick<CadDocument, "extensions">,
  sources: Sources = new Map(),
): string {
  if (
    !("type" in feature) ||
    typeof feature.type !== "string" ||
    !featureSpec(feature.type)?.resolveInputs
  )
    return JSON.stringify(feature);
  if (!doc)
    throw new StoreError("module feature inputs need committed extension data");
  const input = checkedFeatureInputs(feature as Feature, doc, sources);
  return JSON.stringify([feature, input]);
}

export function featureKeys(
  feature: Feature,
  key: string,
  { targets }: FeatureStatus,
  doc: CadDocument,
  sources: Sources,
): string[] {
  return targets && !("targets" in feature)
    ? [key, featureKey({ ...feature, targets }, doc, sources)]
    : [key];
}

export async function projectSources(
  doc: CadDocument,
  held: Sources,
  blob: (projectId: string, hash: string) => Promise<Uint8Array>,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const hash of importBlobs(doc)) {
    if (out.has(hash)) continue;
    const bytes =
      held.get(hash) ?? (await blob(doc.id, hash).catch(() => undefined));
    if (bytes) out.set(hash, bytes);
  }
  let total = 0;
  const collected = new Set<string>();
  for (const feature of resolvedModuleInputFeatures(doc)) {
    const input = resolvedFeatureInputs(feature, doc);
    if (!input) continue;
    for (const hash of input.assets) {
      if (collected.has(hash)) continue;
      collected.add(hash);
      const bytes = await blob(doc.id, hash);
      total = checkedSource(hash, bytes, total);
      const cached = held.get(hash);
      out.set(
        hash,
        cached?.byteLength && sha256(cached) === hash ? cached : bytes,
      );
    }
  }
  return out;
}
