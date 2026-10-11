import { raw, type RequestHandler } from "express";
import multer from "multer";
import {
  importLabels,
  MB,
  THUMBNAIL_LIMITS,
  type ApiErrorBody,
  type ImportFormat,
} from "@rockett/shared";
import { IMAGE_LIMIT_MB } from "../store/projectStore.js";
import { THUMBNAIL_RULE } from "../store/thumbnailStore.js";
import type { Staged, Uploads } from "../store/blobStore.js";
import { megabytes } from "./importers.js";

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

export const receiveProjectFile = (uploads: Uploads, bytes: number) =>
  multipart(
    "file",
    bytes,
    `Upload one .rockett project file, up to ${megabytes(bytes)}.`,
    staging(uploads),
  );

export const receiveImport = (
  uploads: Uploads,
  bytes: number,
  formats: readonly ImportFormat[],
) =>
  multipart(
    "file",
    bytes,
    `Upload one ${importLabels(formats)} file, up to ${megabytes(bytes)}.`,
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
