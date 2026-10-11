import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import {
  createBrowserProject,
  keepProjectFile,
  listBrowserProjects,
  moveToServer,
  takeHandover,
} from "../browserProjects";
import { openBrowserProject } from "../browserSession";
import {
  BROWSER_PATH,
  browserKeyFromPath,
  folderIdFromPath,
  folderPath,
  isBrowserPath,
  showPath,
} from "../paths";
import { byName, EMPTY_TREE } from "../projectTree";
import { useStore } from "../store";
import { BrowserItems, ProjectItems, type Renaming } from "./ProjectItems";
import { StepImportButton } from "./StepImportButton";
import { VersionLabel } from "./VersionLabel";
import { UserMenu } from "./UserMenu";

export { backToProjects } from "../projectNavigation";

type Load = "loading" | "ready" | { failed: string };

const HANDOVER = "Projects kept in this browser before sign-in are now yours.";

function Tagline({ handedOver }: { handedOver: boolean }) {
  return (
    <>
      <p className="tagline">Your CAD. Your server. Your plugins.</p>
      {handedOver && <div className="storage-line">{HANDOVER}</div>}
    </>
  );
}

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
  const [handedOver, setHandedOver] = useState(false);
  useEffect(() => {
    window.addEventListener("focus", kept.refresh);
    return () => window.removeEventListener("focus", kept.refresh);
  }, [kept.refresh]);
  useEffect(() => {
    if (kept.load === "ready" && takeHandover()) setHandedOver(true);
  }, [kept.load]);
  return { ...kept, handedOver };
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

const openProject = (id: string) => useStore.getState().openProject(id);

const createProject = (
  inBrowser: boolean,
  name: string,
  folderId: string | null,
) =>
  inBrowser
    ? createBrowserProject(name).then(({ key }) => openBrowserProject(key))
    : api
        .createProject(name, folderId)
        .then(({ document }) => openProject(document.id));

function OpenProjectFile({
  inBrowser,
  onError,
}: {
  inBrowser: boolean;
  onError: (e: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const openFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      if (inBrowser)
        await openBrowserProject((await keepProjectFile(file, file.name)).key);
      else await openProject((await api.uploadProjectFile(file)).document.id);
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

function useListView(projects: Awaited<ReturnType<typeof api.listProjects>>) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState("modified");
  return {
    filter,
    projects: projects.toSorted((a, b) =>
      sort === "name" ? byName(a, b) : b.modifiedAt.localeCompare(a.modifiedAt),
    ),
    controls: (
      <div className="new-project">
        <input
          placeholder="Filter by name…"
          aria-label="Filter by name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setFilter("")}
        />
        <label>
          Sort{" "}
          <select
            className="tb-select"
            aria-label="Sort projects"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="modified">Modified</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
    ),
  };
}

export function ProjectList({ onUsers }: { onUsers: () => void }) {
  const server = useLoaded(readProjects, { projects: [], tree: EMPTY_TREE });
  const { projects, tree } = server.value;
  const view = useListView(projects);
  const kept = useBrowserProjects();
  const { inBrowser, folderId, openFolder, openBrowser } = usePlace();
  const { load, refresh } = inBrowser ? kept : server;
  const [name, setName] = useState("");
  const [listError, setError] = useState<string | null>(null);
  const loadError = useStore((s) => s.error);
  const error = listError ?? loadError;
  const [renaming, setRenaming] = useState<Renaming>(null);
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
  const run = runThen(() => Promise.all([server.refresh(), kept.refresh()]));
  const create = () =>
    createProject(inBrowser, name || "Untitled", folderId).catch((e) =>
      setError(e.message),
    );
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
          <UserMenu onUsers={onUsers} />
        </h1>
        <Tagline handedOver={kept.handedOver} />
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
          {!inBrowser && (
            <button className="btn" onClick={newFolder}>
              New folder
            </button>
          )}
        </div>
        <div className="projects">
          {!inBrowser && <StepImportButton newProject onError={setError} />}
          <OpenProjectFile inBrowser={inBrowser} onError={setError} />
          {load === "loading" && (
            <div className="tree-empty">Loading projects…</div>
          )}
          {load === "ready" &&
            (inBrowser ? (
              <BrowserItems
                records={kept.value}
                tree={tree}
                renaming={renaming}
                setRenaming={setRenaming}
                onOpenFolder={openFolder}
                onMove={(r, to) => run(moveToServer(r, to))}
                run={runThen(kept.refresh)}
              />
            ) : (
              <ProjectItems
                {...view}
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
