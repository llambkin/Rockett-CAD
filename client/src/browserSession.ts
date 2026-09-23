import {
  PROJECT_FILE_LIMIT_MB,
  referencedAssets,
  type CadDocument,
} from "@rockett/shared";
import { api, watchProject } from "./api";
import {
  browserProjectFile,
  fitsWithImage,
  getBrowserProject,
  saveBrowserDocument,
  StaleRecord,
} from "./browserProjects";
import { BROWSER_PATH, browserKeyFromPath, browserProjectPath } from "./paths";
import { followPath as followProjectPath, useStore } from "./store";

interface Session {
  key: string;
  id: string;
  revision: number;
  assets: Set<string>;
  opened: boolean;
  stopped: boolean;
  unsaved: CadDocument | null;
  saving: Promise<void> | null;
}

let open: Session | null = null;
let pending: string | null = null;
let ticket = 0;

const changedElsewhere = (name: string) =>
  `"${name}" changed in another tab. Reload to continue.`;

async function save(session: Session): Promise<void> {
  for (
    let document = session.unsaved;
    document && !session.stopped;
    document = session.unsaved
  ) {
    session.unsaved = null;
    try {
      const added: Record<string, Blob> = {};
      for (const name of referencedAssets(document))
        if (!session.assets.has(name))
          added[name] = await api.readAsset(document.id, name);
      const saved = await saveBrowserDocument(
        session.key,
        session.revision,
        document,
        added,
      );
      session.revision = saved.revision;
      session.assets = new Set(Object.keys(saved.assets));
      if (open === session) useStore.setState({ notSaved: null });
    } catch (e: any) {
      session.stopped = e instanceof StaleRecord;
      if (session.stopped)
        useStore.setState({ error: changedElsewhere(document.name) });
      else if (open === session)
        useStore.setState({
          notSaved: `Not saved in this browser: ${String(e.message).replace(/\.$/, "")}.`,
        });
    }
  }
  session.saving = null;
}

function keep(session: Session, document: CadDocument) {
  if (session.stopped) {
    useStore.setState({ error: changedElsewhere(document.name) });
    return;
  }
  session.unsaved = document;
  session.saving ??= save(session);
}

export function leaveBrowserProject(): boolean {
  ticket++;
  pending = null;
  if (!open) return false;
  useStore.setState({ notSaved: null });
  watchProject(null);
  void api.deleteProject(open.id).catch(() => {});
  open = null;
  return true;
}

export function dropBrowserCopy(): void {
  if (open) void api.deleteProject(open.id, true).catch(() => {});
}

async function refuseOversizeImage(key: string, image: File): Promise<void> {
  if (!fitsWithImage(await getBrowserProject(key), image.size))
    throw new Error(
      `This image would take the project file past ${PROJECT_FILE_LIMIT_MB} MB, and a browser project that large could not open again.`,
    );
}

function fail(message: string) {
  window.history.replaceState(null, "", BROWSER_PATH);
  useStore.getState().closeProject();
  useStore.setState({ error: message });
}

export async function openBrowserProject(
  key: string,
  recreated = false,
): Promise<void> {
  leaveBrowserProject();
  const mine = ++ticket;
  pending = key;
  let session: Session;
  try {
    const record = await getBrowserProject(key);
    const { document } = await api.uploadProjectFile(
      await browserProjectFile(record),
      { temporary: "true" },
    );
    session = {
      key,
      id: document.id,
      revision: record.revision,
      assets: new Set(Object.keys(record.assets)),
      opened: false,
      stopped: false,
      unsaved: null,
      saving: null,
    };
  } catch (e: any) {
    if (mine === ticket) fail(e.message);
    return;
  }
  if (mine !== ticket) {
    void api.deleteProject(session.id).catch(() => {});
    return;
  }
  pending = null;
  open = session;
  watchProject({
    id: session.id,
    onDocument: (document) => keep(session, document),
    checkImage: (image) => refuseOversizeImage(key, image),
    onMissing: () => {
      if (!session.opened || open !== session || recreated) return;
      session.opened = false;
      api.getProject(session.id).then(
        () => (session.opened = true),
        async (e) => {
          await session.saving;
          if (e.status !== 404) session.opened = true;
          else if (open === session) void openBrowserProject(key, true);
        },
      );
    },
  });
  await useStore.getState().openProject(session.id, browserProjectPath(key));
  if (open !== session) return;
  session.opened = useStore.getState().projectId === session.id;
  if (!session.opened) {
    leaveBrowserProject();
    fail(useStore.getState().error ?? "Project not found");
  }
}

export function followPath(): Promise<void> | void {
  const path = window.location.pathname;
  const key = browserKeyFromPath(path);
  if (key !== null)
    return key === (open?.key ?? pending) ? undefined : openBrowserProject(key);
  leaveBrowserProject();
  return followProjectPath();
}
