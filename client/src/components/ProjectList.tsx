import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderTree, ProjectSummary } from "@rockett/shared";
import { api } from "../api";
import { folderIdFromPath, folderPath, showPath } from "../paths";
import { EMPTY_TREE, folderOf } from "../projectTree";
import { useStore } from "../store";
import { ProjectItems, type Renaming } from "./ProjectItems";
import { StepImportButton } from "./StepImportButton";
import { VersionLabel } from "./VersionLabel";

export async function backToProjects(): Promise<void> {
  const { projectId, closeProject } = useStore.getState();
  const folderId = await api.listFolders().then(
    (tree) => (projectId === null ? null : folderOf(tree, projectId)),
    () => null,
  );
  showPath(folderPath(folderId));
  closeProject();
}

type Load = "loading" | "ready" | { failed: string };

function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tree, setTree] = useState<FolderTree>(EMPTY_TREE);
  const [load, setLoad] = useState<Load>("loading");
  const refresh = useCallback(
    () =>
      Promise.all([api.listProjects(), api.listFolders()]).then(
        ([p, t]) => {
          setProjects(p);
          setTree(t);
          setLoad("ready");
        },
        (e) => setLoad({ failed: e.message }),
      ),
    [],
  );
  useEffect(() => void refresh(), [refresh]);
  return { projects, tree, load, refresh };
}

const here = () => folderIdFromPath(window.location.pathname);

function useFolderPath() {
  const [folderId, setFolderId] = useState(here);
  useEffect(() => {
    const follow = () => setFolderId(here());
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  const go = (id: string | null) => {
    showPath(folderPath(id));
    setFolderId(id);
  };
  return [folderId, go] as const;
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
  const { projects, tree, load, refresh } = useProjects();
  const [folderId, openFolder] = useFolderPath();
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

  const run = (work: Promise<unknown>) => {
    setError(null);
    void work.then(refresh, (e) => setError(e.message));
  };
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
          {load === "ready" && (
            <ProjectItems
              projects={projects}
              tree={tree}
              folderId={folderId}
              renaming={renaming}
              setRenaming={setRenaming}
              onOpenFolder={openFolder}
              onOpenProject={(id) => void openProject(id)}
              run={run}
            />
          )}
        </div>
      </div>
      <VersionLabel />
    </div>
  );
}
