import { useContext, useEffect, useRef, useState } from "react";
import { ViewportContext } from "./viewportRef";
import { useStore } from "./store";
import { api, saveDownload } from "./api";
import { dropBrowserCopy, followPath } from "./browserSession";
import { Toolbar } from "./components/Toolbar";
import { WorkbenchSwitcher } from "./shell/WorkbenchSwitcher";
import { useCurrentWorkbench } from "./shell/workbench";
import { activeCommand } from "./commands/active";
import { installKeymap, tooltipOf, useKeymap } from "./commands/keymap";
import { registerCommand } from "./commands/registry";
import { ModelTree } from "./components/ModelTree";
import { Timeline } from "./components/Timeline";
import { ViewportView } from "./components/ViewportView";
import {
  HELP_PANEL,
  HISTORY_PANEL,
  Panels,
  togglePanel,
  usePanelOpen,
} from "./shell/panels";
import { useSplitter } from "./components/Splitter";
import { ProjectList, backToProjects } from "./components/ProjectList";
import { AccountTotp, LoginScreen } from "./components/LoginScreen";
import { UserMenu } from "./components/UserMenu";
import { UsersPage } from "./components/UsersPage";
import { bootSession, useSession } from "./session";
import { RenameInput } from "./components/RenameInput";
import { MenuButton } from "./components/ContextMenu";
import { downloadBrowserProject, getBrowserProject } from "./browserProjects";
import { VersionLabel } from "./components/VersionLabel";
import { confirm } from "./components/ConfirmPanel";
import { PARAMETERS_PANEL } from "./components/ParametersPanel";
import { browserKeyFromPath } from "./paths";
import {
  closeProjectSettings,
  loadAppSettings,
  loadUserSettings,
  openProjectSettings,
} from "./settings";

export function App() {
  const projectId = useStore((s) => s.projectId);
  const session = useSession();
  const [bootError, setBootError] = useState<string | null>(null);
  const [usersOpen, setUsersOpen] = useState(false);
  const booted = useRef(false);
  const retryBoot = () => {
    setBootError(null);
    void bootSession().catch(() => setBootError("Could not check session."));
  };
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    retryBoot();
  }, []);
  useEffect(() => {
    if (session.kind !== "signed-in") return;
    let active = true;
    void Promise.all([loadAppSettings(), loadUserSettings()])
      .catch((error: Error) => {
        if (active) useStore.getState().setError(error.message);
      })
      .then(() => {
        if (active) return followPath();
      });
    window.addEventListener("popstate", followPath);
    window.addEventListener("pagehide", dropBrowserCopy);
    return () => {
      active = false;
      window.removeEventListener("popstate", followPath);
      window.removeEventListener("pagehide", dropBrowserCopy);
    };
  }, [session.kind]);
  useEffect(() => {
    if (
      session.kind !== "signed-in" ||
      projectId === null ||
      browserKeyFromPath(window.location.pathname) !== null
    ) {
      closeProjectSettings();
      return;
    }
    let active = true;
    void openProjectSettings(projectId).catch((error: Error) => {
      if (active) useStore.getState().setError(error.message);
    });
    return () => {
      active = false;
      closeProjectSettings();
    };
  }, [session.kind, projectId]);
  if (session.kind !== "signed-in")
    return (
      <LoginScreen
        session={session}
        bootError={bootError}
        retryBoot={retryBoot}
      />
    );
  if (session.screen) return <AccountTotp screen={session.screen} />;
  if (usersOpen && session.user.role === "admin")
    return <UsersPage onClose={() => setUsersOpen(false)} />;
  return projectId ? (
    <ViewportView>
      {(viewport) => (
        <Workspace onUsers={() => setUsersOpen(true)} viewport={viewport} />
      )}
    </ViewportView>
  ) : (
    <ProjectList onUsers={() => setUsersOpen(true)} />
  );
}

/** The open project's name in the top bar — click to rename. */
function ProjectName({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <RenameInput
        value={name}
        className="doc-name doc-rename"
        onCommit={(n) => {
          setEditing(false);
          void useStore.getState().renameProject(n);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <button
      className="doc-name"
      title="Click to rename this project"
      onClick={() => setEditing(true)}
    >
      {name}
      <span className="doc-name-pen" aria-hidden="true">
        ✎
      </span>
    </button>
  );
}

const withLabel = (verb: string, label: string | null | undefined) =>
  label ? `${verb} ${label}` : verb;

export function UndoRedoButtons() {
  const canUndo = useStore((s) => s.history?.canUndo ?? false);
  const canRedo = useStore((s) => s.history?.canRedo ?? false);
  const undoLabel = useStore((s) => s.history?.undoLabel);
  const redoLabel = useStore((s) => s.history?.redoLabel);
  useKeymap();
  const busy = useStore((s) => s.busy);
  return (
    <span className="undo-redo">
      <button
        className="icon-btn"
        disabled={!canUndo || busy}
        title={tooltipOf({
          id: "design.undo",
          label: withLabel("Undo", undoLabel),
        })}
        aria-label="Undo"
        onClick={() => void useStore.getState().undo()}
      >
        ↶
      </button>
      <button
        className="icon-btn"
        disabled={!canRedo || busy}
        title={tooltipOf({
          id: "design.redo",
          label: withLabel("Redo", redoLabel),
        })}
        aria-label="Redo"
        onClick={() => void useStore.getState().redo()}
      >
        ↷
      </button>
    </span>
  );
}

function useHoldUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [active]);
}

export function RecoveryBanner() {
  const recovery = useStore((s) => s.recovery);
  const recover = useStore((s) => s.recover);
  useHoldUnload(recovery !== null);
  if (!recovery) return null;
  return (
    <div className="error-banner" role="alert">
      {recovery.message}{" "}
      <button className="btn" onClick={() => void recover("reapply")}>
        {recovery.kind === "offline" ? "Retry" : "Reload and reapply my change"}
      </button>{" "}
      <button
        className="btn"
        onClick={async () => {
          if (await confirm("Discard your unsaved change and reload?"))
            void recover("discard");
        }}
      >
        Discard my change
      </button>
    </div>
  );
}

function NotSavedBanner() {
  const notSaved = useStore((s) => s.notSaved);
  const projectId = useStore((s) => s.projectId);
  const setError = useStore((s) => s.setError);
  useHoldUnload(notSaved !== null);
  if (!notSaved || !projectId) return null;
  return (
    <div className="error-banner" role="alert">
      {notSaved}{" "}
      <button
        className="btn"
        onClick={() =>
          void api
            .downloadProjectFile(projectId)
            .then(saveDownload, (e) => setError(e.message))
        }
      >
        Download
      </button>
    </div>
  );
}

export function FileMenu() {
  const projectId = useStore((s) => s.projectId);
  const setError = useStore((s) => s.setError);
  const download = () => {
    const key = browserKeyFromPath(window.location.pathname);
    const file =
      key === null
        ? api.downloadProjectFile(projectId!)
        : getBrowserProject(key).then(downloadBrowserProject);
    void file.then(saveDownload, (e) => setError(e.message));
  };
  return (
    <MenuButton
      label="File"
      title="Project file"
      items={[{ label: "Download", action: download }]}
    />
  );
}

function SaveIndicator() {
  const saveState = useStore((s) => s.saveState);
  const busy = useStore((s) => s.busy);
  const error = useStore((s) => s.error);
  const saved = busy ? "Working…" : error ? "Check message" : "Changes saved";
  return (
    <span
      className="save-indicator"
      aria-live="polite"
      title="Changes save automatically after each operation"
    >
      {{ unsaved: "Not saved", saving: "Saving…", saved }[saveState]}
    </span>
  );
}

export function TreePane() {
  const tree = useSplitter("ui.treeWidth", "Model tree width");
  const Tree = useCurrentWorkbench()?.tree ?? ModelTree;
  return (
    <div className="tree-pane" style={{ width: tree.width }}>
      <Tree />
      {tree.splitter}
    </div>
  );
}

function TimelineRow() {
  const Bar = useCurrentWorkbench()?.bar ?? Timeline;
  return <Bar />;
}

function Workspace({
  onUsers,
  viewport,
}: {
  onUsers: () => void;
  viewport: React.ReactNode;
}) {
  const viewportRef = useContext(ViewportContext);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const active = useStore((s) => s.active);
  useKeymap();
  const banner = active && activeCommand()?.banner;

  useEffect(() => installKeymap(viewportRef), [viewportRef]);
  useEffect(
    () =>
      registerCommand({
        id: "design.help",
        label: "Controls",
        keys: ["?"],
        keyContext: "global",
        run: () => togglePanel(HELP_PANEL),
      }),
    [],
  );

  return (
    <div className="workspace">
      <WorkspaceTopbar onUsers={onUsers} />
      <Toolbar />
      <RecoveryBanner />
      <NotSavedBanner />
      <div className="main-row">
        <TreePane />
        {viewport}
        <VersionLabel />
        <Panels />
      </div>
      <TimelineRow />
      {error && (
        <div className="error-toast" role="alert">
          <span>⚠ {error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss message"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {banner && <div className="mode-banner">{banner}</div>}
    </div>
  );
}

export function WorkspaceTopbar({ onUsers }: { onUsers: () => void }) {
  const showHelp = usePanelOpen(HELP_PANEL);
  const showHistory = usePanelOpen(HISTORY_PANEL);
  const showParameters = usePanelOpen(PARAMETERS_PANEL);
  const busy = useStore((s) => s.busy);
  const projectName = useStore((s) => s.document?.name ?? "");
  useKeymap();
  return (
    <div className="top-bar">
      <button
        className="app-title"
        onClick={() => void backToProjects()}
        title="Back to projects"
      >
        ⬢ Rockett CAD
      </button>
      <FileMenu />
      <ProjectName name={projectName} />
      <UndoRedoButtons />
      <WorkbenchSwitcher />
      {busy && <span className="busy-indicator">⟳ working…</span>}
      <SaveIndicator />
      <UserMenu onUsers={onUsers} />
      <button
        className="icon-btn"
        title="Named parameters for numeric fields"
        aria-expanded={showParameters}
        onClick={() => togglePanel(PARAMETERS_PANEL)}
      >
        Parameters
      </button>
      <button
        className="icon-btn"
        title="Undo history and checkpoints"
        aria-expanded={showHistory}
        onClick={() => togglePanel(HISTORY_PANEL)}
      >
        History
      </button>
      <button
        className="icon-btn"
        title={tooltipOf({
          id: "design.help",
          label: "Keyboard and mouse controls",
        })}
        aria-expanded={showHelp}
        onClick={() => togglePanel(HELP_PANEL)}
      >
        Controls
      </button>
    </div>
  );
}
