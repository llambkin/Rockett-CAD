import {
  createRegistry,
  MB,
  StoreError,
  ValidationError,
  type Feature,
  type ImportFormat,
} from "@rockett/shared";

interface Importer extends ImportFormat {
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
  `${Number((bytes / MB).toPrecision(4))} MB`;

export function withinImportBudget(file: { size: number }, bytes: number) {
  if (file.size > bytes)
    throw new StoreError(
      `This file is ${megabytes(file.size)}; imports are limited to ${megabytes(bytes)}.`,
      "too_large",
    );
}

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
  const filename = upload.name.replace(/^.*[\\/]/, "").slice(0, 255);
  return { label: importer.label, filename, ...importer.read(bytes, filename) };
}
