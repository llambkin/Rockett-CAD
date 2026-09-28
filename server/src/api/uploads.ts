import { raw, type RequestHandler } from "express";
import multer from "multer";
import {
  MAX_IMPORT_BYTES,
  MB,
  PROJECT_FILE_LIMIT_MB,
  THUMBNAIL_LIMITS,
  type ApiErrorBody,
} from "@rockett/shared";
import { IMAGE_LIMIT_MB, StoreError } from "../store/projectStore.js";
import { THUMBNAIL_RULE } from "../store/thumbnailStore.js";
import type { Staged, Uploads } from "../store/blobStore.js";

const megabytes = (bytes: number) =>
  `${Number((bytes / MB).toPrecision(3))} MB`;

export interface ImportLimits {
  uploadBytes: number;
  importBytes: number;
}

export const IMPORT_LIMITS: ImportLimits = {
  uploadBytes: MAX_IMPORT_BYTES,
  importBytes: MAX_IMPORT_BYTES,
};

export const JSON_BODY_LIMIT_BYTES = 50 * MB;

export type Upload = Staged & { originalname: string };

function multipart(
  field: string,
  bytes: number,
  error: string,
  storage: multer.StorageEngine = multer.memoryStorage(),
) {
  const receive = multer({
    storage,
    limits: { fileSize: bytes, files: 1 },
  }).single(field);
  return (req: any, res: any, next: any) =>
    receive(req, res, (err: any) => {
      if (!err) return next();
      const body: ApiErrorBody = {
        error,
        code: err.code === "LIMIT_FILE_SIZE" ? "too_large" : "validation",
      };
      res.status(body.code === "too_large" ? 413 : 400).json(body);
    });
}

const staging = (uploads: Uploads): multer.StorageEngine => ({
  _handleFile: (_req, file, done) =>
    void uploads.stage(file.stream).then((staged) => done(null, staged), done),
  _removeFile: (_req, file, done) =>
    void (file.path ? uploads.discard(file) : Promise.resolve()).then(
      () => done(null),
      done,
    ),
});

export const receiveImage = multipart(
  "image",
  IMAGE_LIMIT_MB * MB,
  `Upload one PNG, JPEG or WebP image, up to ${IMAGE_LIMIT_MB} MB.`,
);

const rawThumbnail = raw({ type: () => true, limit: THUMBNAIL_LIMITS.bytes });

export const receiveThumbnail: RequestHandler = (req, res, next) =>
  rawThumbnail(req, res, (err?: unknown) => {
    if (!err) return next();
    const body: ApiErrorBody = { error: THUMBNAIL_RULE, code: "validation" };
    res.status(400).json(body);
  });

export const receiveProjectFile = multipart(
  "file",
  PROJECT_FILE_LIMIT_MB * MB,
  `Upload one .rockett project file, up to ${PROJECT_FILE_LIMIT_MB} MB.`,
);

export const receiveImport = (uploads: Uploads, bytes: number) =>
  multipart(
    "file",
    bytes,
    `Upload one STEP, IGES, BREP, STL, OBJ or 3MF file, up to ${megabytes(bytes)}.`,
    staging(uploads),
  );

export const discarding =
  <Context>(
    uploads: Uploads,
    handle: (req: any, res: any, ctx: Context) => Promise<void>,
  ) =>
  async (req: any, res: any, ctx: Context) => {
    try {
      await handle(req, res, ctx);
    } finally {
      if (req.file) await uploads.discard(req.file);
    }
  };

export function readUpload(
  uploads: Uploads,
  file: Upload,
  limit: number,
): Promise<Buffer> {
  if (file.size > limit)
    throw new StoreError(
      `Imports are limited to ${megabytes(limit)}.`,
      "too_large",
    );
  return uploads.read(file);
}
