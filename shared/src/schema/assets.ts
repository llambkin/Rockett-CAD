import { Type } from "typebox";
import { MODULE_DATA_MAX_BYTES } from "../units.js";

export const BLOB_HASH = /^[0-9a-f]{64}$/;
export const blobHashSchema = Type.String({ pattern: BLOB_HASH.source });
export const MODULE_ASSET_LIMIT = MODULE_DATA_MAX_BYTES / 64;
export const moduleAssetHashesSchema = Type.Refine(
  Type.Array(blobHashSchema, { maxItems: MODULE_ASSET_LIMIT }),
  (hashes) => new Set(hashes).size === hashes.length,
  () => "has repeated module asset hashes",
);
