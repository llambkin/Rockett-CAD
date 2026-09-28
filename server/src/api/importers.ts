import {
  createRegistry,
  MB,
  ValidationError,
  type Feature,
  type ImportFormat,
} from "@rockett/shared";
import { StoreError } from "../store/projectStore.js";

export interface Importer extends ImportFormat {
  bytes: number;
  read(
    bytes: Buffer,
    filename: string,
  ): { features: Feature[]; sources: ReadonlyMap<string, Uint8Array> };
}

export interface ImportUpload {
  name: string;
  bytes: () => Promise<Buffer>;
}

export const importers = createRegistry<Importer>(
  "importer",
  (importer) => importer.format,
);

export const registerImporter = importers.register;

export const megabytes = (bytes: number) =>
  `${Number((bytes / MB).toPrecision(3))} MB`;

export async function importFile(upload: ImportUpload | undefined) {
  const name = upload?.name.toLowerCase() ?? "",
    importer = importers
      .list()
      .find((i) => i.extensions.some((ext) => name.endsWith(ext)));
  if (!upload || !importer)
    throw new ValidationError(
      `Choose a ${importers
        .list()
        .flatMap((i) => i.extensions)
        .join(", ")} file`,
    );
  const bytes = await upload.bytes();
  if (bytes.length > importer.bytes)
    throw new StoreError(
      `${importer.label} imports are limited to ${megabytes(importer.bytes)}.`,
      "too_large",
    );
  const filename = upload.name.replace(/^.*[\\/]/, "").slice(0, 255);
  return { label: importer.label, filename, ...importer.read(bytes, filename) };
}
