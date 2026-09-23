import {
  parse,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  projectFileEnvelope,
  SCHEMA_VERSION,
  ValidationError,
  type CadDocument,
  type ProjectFile,
} from "@rockett/shared";
import type { Request, Response } from "express";
import type { ProjectStore } from "../store/projectStore.js";
import { documentMigrations, migrate } from "../store/migrations.js";
import { validateDocument } from "./validate.js";

const ATTR_CHAR = /[A-Za-z0-9!#$&+.^_`|~-]/;

export function safeFileName(name: string): string {
  return name.replace(/[^\w-]+/g, "_").slice(0, 60);
}

function attachment(name: string, ext: string): string {
  const utf8 = [...Buffer.from(`${name}.${ext}`)]
    .map((byte) => {
      const char = String.fromCharCode(byte);
      return ATTR_CHAR.test(char)
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  const ascii = safeFileName(name) || "project";
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${utf8}`;
}

function referencedAssets(doc: CadDocument): Set<string> {
  return new Set(
    doc.features.flatMap((f) =>
      f.type === "referenceImage" ? [f.assetId] : [],
    ),
  );
}

function readJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new ValidationError("This is not a Rockett project file");
  }
}

function decodeAsset(name: string, base64: string | undefined): Buffer {
  if (base64 === undefined) throw new ValidationError(`missing asset ${name}`);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64)
    throw new ValidationError(`asset ${name} is not valid base64`);
  return bytes;
}

export const downloadProjectFile =
  (store: ProjectStore) => async (req: Request, res: Response) => {
    const document = await store.load(String(req.params.id));
    const assets: Record<string, string> = {};
    for (const name of referencedAssets(document))
      assets[name] = (await store.readAsset(document.id, name)).toString(
        "base64",
      );
    const file: ProjectFile = {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      document,
      assets,
    };
    res.setHeader("Content-Disposition", attachment(document.name, "rockett"));
    res.json(file);
  };

export const uploadProjectFile =
  (store: ProjectStore) => async (req: Request, res: Response) => {
    if (!req.file) throw new ValidationError("Choose a .rockett project file");
    const file = parse(projectFileEnvelope, readJson(req.file.buffer));
    if (file.version > PROJECT_FILE_VERSION)
      throw new ValidationError(
        `project file version ${file.version} is newer than this server reads (${PROJECT_FILE_VERSION})`,
      );
    if (file.document.schemaVersion > SCHEMA_VERSION)
      throw new ValidationError(
        `project schema ${file.document.schemaVersion} is newer than this server's schema ${SCHEMA_VERSION}`,
      );
    const document = migrate(documentMigrations, file.document);
    validateDocument(document);
    const referenced = referencedAssets(document);
    for (const name of Object.keys(file.assets))
      if (!referenced.has(name))
        throw new ValidationError(
          `asset ${name} is not referenced by the document`,
        );
    const assets = new Map(
      [...referenced].map((name) => [
        name,
        decodeAsset(name, file.assets[name]),
      ]),
    );
    res.json({ document: await store.importProject(document, assets) });
  };
