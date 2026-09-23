import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { listBrowserProjects } from "../browserProjects";
import {
  BROWSER_PATH,
  browserKeyFromPath,
  folderIdFromPath,
  folderPath,
  isBrowserPath,
  showPath,
} from "../paths";
import { EMPTY_TREE, folderOf } from "../projectTree";
import { useStore } from "../store";
import { leaveBrowserProject } from "../browserSession";
import { BrowserItems, ProjectItems, type Renaming } from "./ProjectItems";
import { StepImportButton } from "./StepImportButton";
import { VersionLabel } from "./VersionLabel";

export async function backToProjects(): Promise<void> {
  const { projectId, closeProject } = useStore.getState();
  if (leaveBrowserProject()) showPath(BROWSER_PATH);
  else
    showPath(
      folderPath(
        await api.listFolders().then(
          (tree) => (projectId === null ? null : folderOf(tree, projectId)),
          () => null,
        ),
      ),
    );
  closeProject();
}

type Load = "loading" | "ready" | { failed: string };

function useLoaded<T>(read: () => Promise<T>, empty: T) {
  const [value, setValue] = useState(empty);
  const [load, setLoad] = useState<Load>("loading");
  const refresh = useCallback(
    () =>
      read().then(
        (v) => {
          setValue(v);
          setLoad("ready");
        },
        (e) => setLoad({ failed: e.message }),
      ),
    [],
  );
  useEffect(() => void refresh(), [refresh]);
  return { value, load, refresh };
}

const readProjects = () =>
  Promise.all([api.listProjects(), api.listFolders()]).then(
    ([projects, tree]) => ({ projects, tree }),
  );

function useBrowserProjects() {
  const kept = useLoaded(listBrowserProjects, []);
  useEffect(() => {
    window.addEventListener("focus", kept.refresh);
    return () => window.removeEventListener("focus", kept.refresh);
  }, [kept.refresh]);
  return kept;
}

function usePlace() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const follow = () => setPath(window.location.pathname);
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  const go = (to: string) => {
    showPath(to);
    setPath(to);
  };
  return {
    inBrowser: isBrowserPath(path) || browserKeyFromPath(path) !== null,
    folderId: folderIdFromPath(path),
    openFolder: (id: string | null) => go(folderPath(id)),
    openBrowser: () => go(BROWSER_PATH),
  };
}

function OpenProjectFile({ onError }: { onError: (e: string) => void }) {
  const openProject = useStore((s) => s.openProject);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const openFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const { document } = await api.uploadProjectFile(file);
      await openProject(document.id);
    } catch (e: any) {
      onError(e.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".rockett"
        hidden
        aria-label="Project file"
        onChange={(e) => void openFile(e.target.files?.[0])}
      />
      <button
        className="btn"
        disabled={uploading}
        title="Open a .rockett project file as a new project"
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? "Opening project file…" : "Open project file"}
      </button>
    </>
  );
}

export function ProjectList() {
  const server = useLoaded(readProjects, { projects: [], tree: EMPTY_TREE });
  const { projects, tree } = server.value;
  const kept = useBrowserProjects();
  const { inBrowser, folderId, openFolder, openBrowser } = usePlace();
  const { load, refresh } = inBrowser ? kept : server;
  const [name, setName] = useState("");
  const [listError, setError] = useState<string | null>(null);
  const loadError = useStore((s) => s.error);
  const error = listError ?? loadError;
  const [renaming, setRenaming] = useState<Renaming>(null);
  const openProject = useStore((s) => s.openProject);
  const missing =
    load === "ready" &&
    folderId !== null &&
    !tree.folders.some((f) => f.id === folderId);

  useEffect(() => {
    if (!missing) return;
    window.history.replaceState(null, "", folderPath(null));
    openFolder(null);
    setError("Folder not found.");
  }, [missing]);

  const runThen = (reread: () => unknown) => (work: Promise<unknown>) => {
    setError(null);
    void work.then(reread, (e) => setError(e.message));
  };
  const run = runThen(server.refresh);
  const create = () =>
    api
      .createProject(name || "Untitled", folderId)
      .then(({ document }) => openProject(document.id))
      .catch((e) => setError(e.message));
  const newFolder = () =>
    run(
      api.createFolder("New folder", folderId).then(({ folder }) => {
        setRenaming({ kind: "folder", id: folder.id });
      }),
    );

  return (
    <div className="project-list-page">
      <div className="project-list-card">
        <h1>
          <span className="logo">⬢</span> Rockett CAD
        </h1>
        <p className="tagline">Your CAD. Your server. Your plugins.</p>
        {error && <div className="error-banner">{error}</div>}
        {typeof load === "object" && (
          <div className="error-banner">
            Projects did not load: {load.failed}.{" "}
            <button className="btn" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}
        <div className="new-project">
          <input
            placeholder="New project name…"
            aria-label="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
          <button className="btn primary" onClick={() => void create()}>
            Create
          </button>
          <button className="btn" onClick={newFolder}>
            New folder
          </button>
        </div>
        <div className="projects">
          <StepImportButton newProject onError={setError} />
          <OpenProjectFile onError={setError} />
          {load === "loading" && (
            <div className="tree-empty">Loading projects…</div>
          )}
          {load === "ready" &&
            (inBrowser ? (
              <BrowserItems
                records={kept.value}
                renaming={renaming}
                setRenaming={setRenaming}
                onOpenFolder={openFolder}
                run={runThen(kept.refresh)}
              />
            ) : (
              <ProjectItems
                projects={projects}
                tree={tree}
                folderId={folderId}
                kept={kept.load === "ready" ? kept.value.length : null}
                renaming={renaming}
                setRenaming={setRenaming}
                onOpenFolder={openFolder}
                onOpenBrowser={openBrowser}
                onOpenProject={(id) => void openProject(id)}
                run={run}
              />
            ))}
        </div>
      </div>
      <VersionLabel />
    </div>
  );
}
