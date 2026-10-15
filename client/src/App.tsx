import { useEffect, useState } from "react";
import { useStore } from "./store";
import { api, saveDownload } from "./api";
import { dropBrowserCopy, followPath } from "./browserSession";
import { Toolbar, openDialog } from "./components/Toolbar";
import { ModelTree } from "./components/ModelTree";
import { Timeline } from "./components/Timeline";
import { ViewportView } from "./components/ViewportView";
import { FeatureDialog } from "./components/FeatureDialog";
import { SketchOffsetPanel } from "./components/SketchOffsetPanel";
import { MeasurePanel } from "./components/MeasurePanel";
import { ControlsHelp } from "./components/ControlsHelp";
import { ProjectList, backToProjects } from "./components/ProjectList";
import { RenameInput } from "./components/RenameInput";
import { VersionLabel } from "./components/VersionLabel";
import { viewportHandle } from "./viewportRef";
import { idleActionFor, sketchToolFor } from "./shortcuts";

export function App() {
  const projectId = useStore((s) => s.projectId);
  useEffect(() => {
    void followPath();
    window.addEventListener("popstate", followPath);
    window.addEventListener("pagehide", dropBrowserCopy);
    return () => {
      window.removeEventListener("popstate", followPath);
      window.removeEventListener("pagehide", dropBrowserCopy);
    };
  }, []);
  return projectId ? <Workspace /> : <ProjectList />;
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

function UndoRedoButtons() {
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const canRedo = useStore((s) => s.redoStack.length > 0);
  const busy = useStore((s) => s.busy);
  return (
    <span className="undo-redo">
      <button
        className="icon-btn"
        disabled={!canUndo || busy}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        onClick={() => void useStore.getState().undo()}
      >
        ↶
      </button>
      <button
        className="icon-btn"
        disabled={!canRedo || busy}
        title="Redo (Ctrl+Y)"
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

function Workspace() {
  const [showHelp, setShowHelp] = useState(false);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const busy = useStore((s) => s.busy);
  const projectName = useStore((s) => s.document?.name ?? "");
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const mode = useStore((s) => s.mode);

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      const s = useStore.getState();
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
      if (s.busy || e.repeat) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        viewportHandle.current?.zoomToFit();
        return;
      }
      if (e.shiftKey) return;
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        s.mode.name === "sketch"
      ) {
        const ids = s.selection
          .filter((x) => x.kind === "sketchEntity" || x.kind === "sketchPoint")
          .map((x: any) => x.entityId);
        if (ids.length > 0) {
          e.preventDefault();
          void s.deleteSketchEntities(ids);
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (s.mode.name === "sketch") {
        const tool = sketchToolFor(k);
        if (tool) s.setSketchTool(tool);
        if (k === "x") {
          s.setMode({
            ...(s.mode as any),
            constructionMode: !(s.mode as any).constructionMode,
          });
        }
        return;
      }
      if (s.mode.name === "idle") {
        const action = idleActionFor(k);
        if (action?.kind === "sketch")
          s.setMode({ name: "pickPlane", purpose: "sketch" });
        if (action?.kind === "measure") s.setMode({ name: "measure" });
        if (action?.kind === "dialog") openDialog(action.dialog);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

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
        <ModelTree />
        <ViewportView />
        <FeatureDialog />
        <SketchOffsetPanel />
        <MeasurePanel />
        <VersionLabel />
        {showHelp && <ControlsHelp onClose={() => setShowHelp(false)} />}
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
