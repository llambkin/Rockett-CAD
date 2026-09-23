import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  type CadDocument,
  type ProjectFile,
} from "@rockett/shared";

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

let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("rockett", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    database = undefined;
    throw e;
  });
  return database;
}

async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  const tx = (await open()).transaction(STORE, mode);
  return new Promise<T>((resolve, reject) => {
    let result: T;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error("Project not found"));
    work(tx.objectStore(STORE), (value) => (result = value));
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

function rewrite(
  key: string,
  change: (r: BrowserProject, now: string) => BrowserProject,
): Promise<BrowserProject> {
  return transact<BrowserProject>("readwrite", (store, done) => {
    const req = store.get(key);
    req.onsuccess = () => {
      if (!req.result) return store.transaction.abort();
      const next = change(req.result, new Date().toISOString());
      store.put(next);
      done(next);
    };
  });
}

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

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

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
