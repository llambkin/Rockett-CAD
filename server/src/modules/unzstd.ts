import { zstdDecompressSync } from "node:zlib";
import { StoreError, ValidationError } from "@rockett/shared";
import { megabytes, withinImportBudget } from "../api/importers.js";

export function unzstd(bytes: unknown, maxBytes: number, importBytes: number) {
  if (!(bytes instanceof Uint8Array))
    throw new Error("unzstd takes a Uint8Array");
  withinImportBudget({ size: bytes.byteLength }, importBytes);
  try {
    return zstdDecompressSync(bytes, { maxOutputLength: maxBytes });
  } catch (err: any) {
    if (err?.code === "ERR_BUFFER_TOO_LARGE")
      throw new StoreError(
        `The compressed data expands past ${megabytes(maxBytes)}, the limit.`,
        "too_large",
      );
    if (typeof err?.errno === "number")
      throw new ValidationError("The compressed data is not valid Zstandard.");
    throw err;
  }
}
