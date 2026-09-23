import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_LIMIT_MB,
  PROJECT_FILE_VERSION,
  referencedAssets,
  type CadDocument,
  type ProjectFile,
} from "@rockett/shared";
import { api } from "./api";

export interface BrowserProject {
  key: string;
  name: string;
  modifiedAt: string;
  featureCount: number;
  size: number;
  revision: number;
  document: CadDocument;
  assets: Record<string, Blob>;
}

const STORE = "projects";
const FILE_LIMIT = PROJECT_FILE_LIMIT_MB * 1024 * 1024;
const IMAGE_FEATURE_BYTES = 1024;

export class StaleRecord extends Error {
  constructor() {
    super("Project not found");
  }
}

let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("rockett", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.addEventListener("error", () => reject(req.error));
  }).catch((e) => {
    database = undefined;
    throw e;
  });
  return database;
}

async function transact<T>(
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
    done: (value: T) => void,
    abort: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  const tx = (await open()).transaction(STORE, mode);
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.addEventListener("abort", () =>
      reject(tx.error ?? failure ?? new StaleRecord()),
    );
    work(
      tx.objectStore(STORE),
      (value) => (result = value),
      (reason) => {
        failure = reason;
        tx.abort();
      },
    );
  });
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function record(
  key: string,
  revision: number,
  document: CadDocument,
  assets: Record<string, Blob>,
): BrowserProject {
  const size = Object.values(assets).reduce(
    (sum, blob) => sum + blob.size,
    new Blob([JSON.stringify(document)]).size,
  );
  return {
    key,
    name: document.name,
    modifiedAt: document.modifiedAt,
    featureCount: document.features.length,
    size,
    revision,
    document,
    assets,
  };
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let unit = 0;
  for (; n >= 1024 && unit < units.length - 1; unit++) n /= 1024;
  return unit === 0 ? `${n} B` : `${n.toFixed(1)} ${units[unit]}`;
}

export interface StorageLine {
  text: string;
  warn: boolean;
}

export async function storageLine(): Promise<StorageLine> {
  if (!window.isSecureContext || !navigator.storage)
    return {
      text: "This browser cannot keep these safe. Download a copy.",
      warn: true,
    };
  const [persisted, { usage = 0 }] = await Promise.all([
    navigator.storage.persisted().catch(() => false),
    navigator.storage.estimate().catch(() => ({ usage: 0 })),
  ]);
  return persisted
    ? {
        text: `Kept until you clear this site's data. ${formatSize(usage)} used.`,
        warn: false,
      }
    : {
        text: "The browser may delete these when space runs low. Download a copy.",
        warn: true,
      };
}

export function listBrowserProjects(): Promise<BrowserProject[]> {
  return transact<BrowserProject[]>("readonly", (store, done) => {
    const req = store.getAll();
    req.onsuccess = () =>
      done(
        (req.result as BrowserProject[]).toSorted((a, b) =>
          b.modifiedAt.localeCompare(a.modifiedAt),
        ),
      );
  });
}

export const getBrowserProject = (key: string) =>
  transact<BrowserProject>("readonly", (store, done) => {
    const req = store.get(key);
    req.onsuccess = () =>
      req.result ? done(req.result) : store.transaction.abort();
  });

function rewrite(
  key: string,
  change: (r: BrowserProject, now: string) => BrowserProject | null,
): Promise<BrowserProject> {
  return transact<BrowserProject>("readwrite", (store, done, abort) => {
    const req = store.get(key);
    req.onsuccess = () => {
      const next = req.result && change(req.result, new Date().toISOString());
      if (!next) return abort();
      try {
        store.put(next);
        done(next);
      } catch (e) {
        abort(e);
      }
    };
  });
}

export const saveBrowserDocument = (
  key: string,
  revision: number,
  document: CadDocument,
  added: Record<string, Blob>,
) =>
  rewrite(key, (r) =>
    r.revision === revision
      ? record(
          key,
          revision + 1,
          document,
          Object.fromEntries(
            [...referencedAssets(document)].map((name) => [
              name,
              added[name] ?? r.assets[name]!,
            ]),
          ),
        )
      : null,
  );

export const renameBrowserProject = (key: string, name: string) =>
  rewrite(key, (r, now) =>
    record(
      r.key,
      r.revision + 1,
      { ...r.document, name, modifiedAt: now },
      r.assets,
    ),
  );

export const duplicateBrowserProject = (key: string) =>
  rewrite(key, (r, now) =>
    record(
      newKey(),
      1,
      {
        ...r.document,
        name: `${r.name} (copy)`,
        createdAt: now,
        modifiedAt: now,
      },
      r.assets,
    ),
  );

export const deleteBrowserProject = (key: string) =>
  transact<void>("readwrite", (store) => void store.delete(key));

const keepBrowserProject = (r: BrowserProject) =>
  transact<void>("readwrite", (store) => void store.add(r));

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const base64Size = (bytes: number) => 4 * Math.ceil(bytes / 3);

export function projectFileSize(
  r: Pick<BrowserProject, "document" | "assets">,
): number {
  const envelope: ProjectFile = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    document: r.document,
    assets: Object.fromEntries(Object.keys(r.assets).map((n) => [n, ""])),
  };
  return Object.values(r.assets).reduce(
    (sum, blob) => sum + base64Size(blob.size),
    new Blob([JSON.stringify(envelope)]).size,
  );
}

export const fitsWithImage = (
  r: Pick<BrowserProject, "document" | "assets">,
  imageBytes: number,
) =>
  projectFileSize(r) + base64Size(imageBytes) + IMAGE_FEATURE_BYTES <=
  FILE_LIMIT;

export async function toProjectFile(r: BrowserProject): Promise<ProjectFile> {
  const assets: Record<string, string> = {};
  for (const [name, blob] of Object.entries(r.assets))
    assets[name] = toBase64(new Uint8Array(await blob.arrayBuffer()));
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    document: r.document,
    assets,
  };
}

export function fromProjectFile(file: ProjectFile): BrowserProject {
  const assets = Object.fromEntries(
    Object.entries(file.assets).map(([name, base64]) => [
      name,
      new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]),
    ]),
  );
  return record(newKey(), 1, file.document, assets);
}

export async function downloadBrowserProject(r: BrowserProject) {
  const file = await toProjectFile(r);
  return {
    blob: new Blob([JSON.stringify(file)], { type: "application/json" }),
    fileName: `${r.name}.rockett`,
  };
}

export async function browserProjectFile(r: BrowserProject): Promise<File> {
  const { blob, fileName } = await downloadBrowserProject(r);
  return new File([blob], fileName);
}

export async function moveToBrowser(id: string, name: string): Promise<void> {
  void navigator.storage?.persist().catch(() => false);
  const { blob } = await api.downloadProjectFile(id);
  if (blob.size > FILE_LIMIT)
    throw new Error(
      `"${name}" is over the ${PROJECT_FILE_LIMIT_MB} MB project file limit, so it could not open from this browser.`,
    );
  await keepBrowserProject(fromProjectFile(JSON.parse(await blob.text())));
  await api.deleteProject(id).catch(() => {
    throw new Error(
      `"${name}" is in this browser, but the server copy was not removed.`,
    );
  });
}

export async function moveToServer(
  r: BrowserProject,
  folderId: string | null,
): Promise<void> {
  await api.uploadProjectFile(
    await browserProjectFile(r),
    folderId === null ? {} : { folderId },
  );
  await deleteBrowserProject(r.key).catch(() => {
    throw new Error(
      `"${r.name}" is on the server, but the copy in this browser was not removed.`,
    );
  });
}
