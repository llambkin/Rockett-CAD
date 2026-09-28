import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { api, saveDownload } from "./api";
import { dropBrowserCopy, followPath } from "./browserSession";
import { Toolbar } from "./components/Toolbar";
import "./commands/design";
import { installKeymap } from "./commands/keymap";
import { registerCommand } from "./commands/registry";
import { ModelTree } from "./components/ModelTree";
import { Timeline } from "./components/Timeline";
import { ViewportView } from "./components/ViewportView";
import { FeatureDialog } from "./components/FeatureDialog";
import { ExportPanel } from "./components/ExportPanel";
import { SketchOffsetPanel } from "./components/SketchOffsetPanel";
import { MeasurePanel } from "./components/MeasurePanel";
import { ControlsHelp } from "./components/ControlsHelp";
import { HistoryPanel } from "./components/HistoryPanel";
import { useSplitter } from "./components/Splitter";
import { ProjectList, backToProjects } from "./components/ProjectList";
import { AccountTotp, LoginScreen } from "./components/LoginScreen";
import { UserMenu } from "./components/UserMenu";
import { UsersPage } from "./components/UsersPage";
import { bootSession, useSession } from "./session";
import { RenameInput } from "./components/RenameInput";
import { VersionLabel } from "./components/VersionLabel";
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
    <Workspace onUsers={() => setUsersOpen(true)} />
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
  const busy = useStore((s) => s.busy);
  return (
    <span className="undo-redo">
      <button
        className="icon-btn"
        disabled={!canUndo || busy}
        title={`${withLabel("Undo", undoLabel)} (Ctrl+Z)`}
        aria-label="Undo"
        onClick={() => void useStore.getState().undo()}
      >
        ↶
      </button>
      <button
        className="icon-btn"
        disabled={!canRedo || busy}
        title={`${withLabel("Redo", redoLabel)} (Ctrl+Y)`}
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
        onClick={() => {
          if (window.confirm("Discard your unsaved change and reload?"))
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
  return (
    <div className="tree-pane" style={{ width: tree.width }}>
      <ModelTree />
      {tree.splitter}
    </div>
  );
}

function Workspace({ onUsers }: { onUsers: () => void }) {
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const busy = useStore((s) => s.busy);
  const projectName = useStore((s) => s.document?.name ?? "");
  const mode = useStore((s) => s.mode);

  useEffect(installKeymap, []);
  useEffect(
    () =>
      registerCommand({
        id: "design.help",
        label: "Controls",
        keys: ["?"],
        keyContext: "global",
        run: () => setShowHelp((v) => !v),
      }),
    [],
  );

  return (
    <div className="workspace">
      <div className="top-bar">
        <button
          className="app-title"
          onClick={() => void backToProjects()}
          title="Back to projects"
        >
          ⬢ Rockett CAD
        </button>
        <ProjectName name={projectName} />
        <UndoRedoButtons />
        {busy && <span className="busy-indicator">⟳ working…</span>}
        <SaveIndicator />
        <UserMenu onUsers={onUsers} />
        <button
          className="icon-btn"
          title="Undo history and checkpoints"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((v) => !v)}
        >
          History
        </button>
        <button
          className="icon-btn"
          title="Keyboard and mouse controls (?)"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((v) => !v)}
        >
          Controls
        </button>
      </div>
      <Toolbar />
      <RecoveryBanner />
      <NotSavedBanner />
      <div className="main-row">
        <TreePane />
        <ViewportView />
        <FeatureDialog />
        <ExportPanel />
        <SketchOffsetPanel />
        <MeasurePanel />
        <VersionLabel />
        {showHelp && <ControlsHelp onClose={() => setShowHelp(false)} />}
        {showHistory && <HistoryPanel onClose={() => setShowHistory(false)} />}
      </div>
      <Timeline />
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
      {mode.name === "pickPlane" && (
        <div className="mode-banner">
          Select a plane or planar face for the sketch (Esc to cancel)
        </div>
      )}
    </div>
  );
}
