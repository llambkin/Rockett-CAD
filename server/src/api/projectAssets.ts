import {
  moduleAssetHashesSchema,
  moduleAssetsSchema,
  parse,
  ValidationError,
  type CadDocument,
} from "@rockett/shared";

const declarations = (assets: CadDocument["moduleAssets"]) =>
  new Map(
    Object.entries(assets?.namespaces ?? {}).map(([id, hashes]) => [
      id,
      JSON.stringify(hashes),
    ]),
  );

export function projectAssets(doc: CadDocument, namespace: string | undefined) {
  const owned = structuredClone(doc.moduleAssets);
  const before = declarations(owned);
  let declared: string[] | undefined;
  return {
    capability: {
      set(hashes: readonly string[]): void {
        if (namespace === undefined)
          throw new ValidationError("This route has no module asset namespace");
        declared = [...parse(moduleAssetHashesSchema, hashes)];
      },
    },
    apply(next: CadDocument): void {
      if (next.moduleAssets !== undefined) {
        parse(moduleAssetsSchema, next.moduleAssets);
        const after = declarations(next.moduleAssets);
        for (const id of new Set([...before.keys(), ...after.keys()]))
          if (before.get(id) !== after.get(id))
            throw new ValidationError(
              `Asset declarations for ${id} must use the module capability`,
            );
      }
      if (owned === undefined) delete next.moduleAssets;
      else next.moduleAssets = owned;
      if (declared !== undefined && namespace !== undefined) {
        next.moduleAssets ??= { namespaces: {} };
        next.moduleAssets.namespaces[namespace] = declared;
      }
    },
  };
}
