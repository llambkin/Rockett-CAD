import {
  createEmptyDocument,
  formatSize,
  parse,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_LIMIT_MB,
  PROJECT_FILE_VERSION,
  projectView,
  referencedAssets,
  type CadDocument,
  type ProjectFile,
  type ProjectView,
} from "@rockett/shared";
import { api } from "./api";

export { formatSize };

export interface BrowserProject {
  key: string;
  name: string;
  modifiedAt: string;
  featureCount: number;
  size: number;
  revision: number;
  document: CadDocument;
  assets: Record<string, Blob>;
  view: ProjectView | null;
}

const STORE = "projects";
const BACKUPS = "backups";
const FILE_LIMIT = PROJECT_FILE_LIMIT_MB * 1024 * 1024;
const IMAGE_FEATURE_BYTES = 1024;

export class StaleRecord extends Error {
  constructor() {
    super("Project not found");
  }
}

const SHARED = "rockett";
const HEIR = "rockett.browserHeir";
let user: string | null = null;
let database: Promise<IDBDatabase> | undefined;
let handedOver = false;

export function browserUser(id: string | null): void {
  if (id === user) return;
  user = id;
  handedOver = false;
  void database?.then(
    (db) => db.close(),
    () => undefined,
  );
  database = undefined;
}

export function takeHandover(): boolean {
  const shown = handedOver;
  handedOver = false;
  return shown;
}

function open(): Promise<IDBDatabase> {
  if (user === null)
    return Promise.reject(
      new Error("Sign in to keep projects in this browser."),
    );
  const name = `${SHARED}-${user}`;
  database ??= connect(name)
    .then(async (db) => {
      await adopt(db, name).catch((e) => {
        db.close();
        throw e;
      });
      return db;
    })
    .catch((e) => {
      database = undefined;
      throw e;
    });
  return database;
}

function connect(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 2);
    req.onupgradeneeded = (e) => upgrade(req, e.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.addEventListener("error", () => reject(req.error));
  });
}

async function adopt(db: IDBDatabase, own: string): Promise<void> {
  if (!(await indexedDB.databases()).some((d) => d.name === SHARED)) return;
  localStorage.setItem(HEIR, localStorage.getItem(HEIR) ?? own);
  if (localStorage.getItem(HEIR) !== own) return;
  const shared = await connect(SHARED);
  try {
    for (const name of [STORE, BACKUPS]) {
      const records = await run<BrowserProject[]>(
        shared,
        name,
        "readonly",
        (store, done) => {
          const req = store.getAll();
          req.onsuccess = () => done(req.result);
        },
      );
      if (!records.length) continue;
      await run<void>(
        db,
        name,
        "readwrite",
        (store) => {
          for (const r of records) {
            const req = store.get(r.key);
            req.onsuccess = () => {
              if (req.result === undefined) store.put(r);
            };
          }
        },
        "strict",
      );
      await run<void>(shared, name, "readwrite", (store) => {
        for (const r of records) store.delete(r.key);
      });
      handedOver ||= name === STORE;
    }
  } finally {
    shared.close();
  }
}

function upgrade(req: IDBOpenDBRequest, oldVersion: number): void {
  const db = req.result;
  if (oldVersion < 1) db.createObjectStore(STORE, { keyPath: "key" });
  const backups = db.createObjectStore(BACKUPS, { keyPath: "key" });
  if (oldVersion < 1) return;
  const projects = req.transaction!.objectStore(STORE);
  const all = projects.getAll();
  all.onsuccess = () => {
    for (const r of all.result as BrowserProject[]) {
      backups.put(r);
      projects.put({ ...r, view: null });
    }
  };
}

type Work<T> = (
  store: IDBObjectStore,
  done: (value: T) => void,
  abort: (reason?: unknown) => void,
) => void;

function run<T>(
  db: IDBDatabase,
  name: string,
  mode: IDBTransactionMode,
  work: Work<T>,
  durability: IDBTransactionDurability = "default",
): Promise<T> {
  const tx = db.transaction(name, mode, { durability });
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.addEventListener("abort", () =>
      reject(tx.error ?? failure ?? new StaleRecord()),
    );
    work(
      tx.objectStore(name),
      (value) => (result = value),
      (reason) => {
        failure = reason;
        tx.abort();
      },
    );
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  work: Work<T>,
  durability?: IDBTransactionDurability,
): Promise<T> {
  return run(await open(), STORE, mode, work, durability);
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
  view: ProjectView | null,
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
    view,
  };
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
  durability?: IDBTransactionDurability,
): Promise<BrowserProject> {
  return transact<BrowserProject>(
    "readwrite",
    (store, done, abort) => {
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
    },
    durability,
  );
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
          r.view,
        )
      : null,
  );

export const saveBrowserView = (key: string, view: ProjectView) =>
  rewrite(key, (r) => ({ ...r, view }));

export const renameBrowserProject = (key: string, name: string) =>
  rewrite(key, (r, now) =>
    record(
      r.key,
      r.revision + 1,
      { ...r.document, name, modifiedAt: now },
      r.assets,
      r.view,
    ),
  );

const copyBrowserProject = (
  key: string,
  document: (r: BrowserProject, now: string) => CadDocument,
  durability?: IDBTransactionDurability,
) =>
  rewrite(
    key,
    (r, now) => record(newKey(), 1, document(r, now), r.assets, r.view),
    durability,
  );

export const duplicateBrowserProject = (key: string) =>
  copyBrowserProject(key, (r, now) => ({
    ...r.document,
    name: `${r.name} (copy)`,
    createdAt: now,
    modifiedAt: now,
  }));

export async function upgradeBrowserNaming<T>(
  key: string,
  commit: () => Promise<T>,
): Promise<T> {
  await copyBrowserProject(
    key,
    (r) => ({ ...r.document, name: `${r.name} (before naming upgrade)` }),
    "strict",
  ).catch((e: Error) => {
    throw new Error(
      `Naming not upgraded: the version 1 copy could not be kept in this browser. ${e.message.replace(/\.$/, "")}.`,
    );
  });
  return commit();
}

export const deleteBrowserProject = (key: string) =>
  transact<void>("readwrite", (store) => void store.delete(key));

async function keepBrowserProject(r: BrowserProject): Promise<BrowserProject> {
  void navigator.storage?.persist().catch(() => false);
  await transact<void>("readwrite", (store) => void store.add(r));
  return r;
}

export function createBrowserProject(name: string): Promise<BrowserProject> {
  const key = newKey();
  return keepBrowserProject(
    record(key, 1, createEmptyDocument(key, name), {}, null),
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const base64Size = (bytes: number) => 4 * Math.ceil(bytes / 3);

export function projectFileSize(
  r: Pick<BrowserProject, "document" | "assets" | "view">,
): number {
  const envelope: ProjectFile = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    document: r.document,
    assets: Object.fromEntries(Object.keys(r.assets).map((n) => [n, ""])),
    ...(r.view && { view: r.view }),
  };
  return Object.values(r.assets).reduce(
    (sum, blob) => sum + base64Size(blob.size),
    new Blob([JSON.stringify(envelope)]).size,
  );
}

export const fitsWithImage = (
  r: Pick<BrowserProject, "document" | "assets" | "view">,
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
    ...(r.view && { view: r.view }),
  };
}

export function fromProjectFile(file: ProjectFile): BrowserProject {
  if (file.assemblies?.length)
    throw new Error(
      "This project has assemblies, which a browser project cannot hold yet.",
    );
  const assets = Object.fromEntries(
    Object.entries(file.assets).map(([name, base64]) => [
      name,
      new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]),
    ]),
  );
  const view =
    file.view === undefined
      ? null
      : { camera: null, ...parse(projectView, file.view, "view") };
  return record(newKey(), 1, file.document, assets, view);
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

export async function keepProjectFile(
  blob: Blob,
  name: string,
): Promise<BrowserProject> {
  if (blob.size > FILE_LIMIT)
    throw new Error(
      `"${name}" is over the ${PROJECT_FILE_LIMIT_MB} MB project file limit, so it could not open from this browser.`,
    );
  let file: ProjectFile | undefined;
  try {
    file = JSON.parse(await blob.text());
  } catch {}
  if (file?.format !== PROJECT_FILE_FORMAT)
    throw new Error("This is not a Rockett project file");
  return keepBrowserProject(fromProjectFile(file));
}

export async function moveToBrowser(id: string, name: string): Promise<void> {
  const { blob } = await api.downloadProjectFile(id);
  const { document } = await keepProjectFile(blob, name);
  await api.deleteProject(id, false, document.revision).catch(() => {
    throw new Error(
      `"${name}" is in this browser, but the server copy was not removed.`,
    );
  });
}

export async function moveToServer(
  r: BrowserProject,
  folderId: string | null,
): Promise<string> {
  const { document } = await api.uploadProjectFile(
    await browserProjectFile(r),
    folderId === null ? {} : { folderId },
  );
  await Promise.all([api.getProject(document.id), api.getView(document.id)]);
  await api.evaluate(document.id);
  await deleteBrowserProject(r.key).catch(() => {
    throw new Error(
      `"${r.name}" is on the server, but the copy in this browser was not removed.`,
    );
  });
  return document.id;
}
