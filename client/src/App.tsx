import { useEffect, useState } from "react";
import type { ProjectSummary } from "@rockett/shared";
import { api } from "./api";
import { followPath, useStore } from "./store";
import { Toolbar, openDialog } from "./components/Toolbar";
import { ModelTree } from "./components/ModelTree";
import { Timeline } from "./components/Timeline";
import { ViewportView } from "./components/ViewportView";
import { FeatureDialog } from "./components/FeatureDialog";
import { SketchOffsetPanel } from "./components/SketchOffsetPanel";
import { MeasurePanel } from "./components/MeasurePanel";
import { StepImportButton } from "./components/StepImportButton";
import { DraggablePanel } from "./components/DraggablePanel";
import { viewportHandle } from "./viewportRef";
import { versionLabel } from "./versionLabel";
import {
  IDLE_SHORTCUTS,
  LINE_SHORTCUTS,
  SKETCH_SHORTCUTS,
  idleActionFor,
  sketchToolFor,
} from "./shortcuts";

export function App() {
  const projectId = useStore((s) => s.projectId);
  useEffect(() => {
    void followPath();
    window.addEventListener("popstate", followPath);
    return () => window.removeEventListener("popstate", followPath);
  }, []);
  return projectId ? <Workspace /> : <ProjectList />;
}

function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");
  const [listError, setError] = useState<string | null>(null);
  const loadError = useStore((s) => s.error);
  const error = listError ?? loadError;
  /** id of the project whose name is being edited in place */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const openProject = useStore((s) => s.openProject);

  const refresh = () => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e) => setError(e.message));
  };
  useEffect(refresh, []);

  const create = async () => {
    try {
      const { document } = await api.createProject(name || "Untitled");
      await openProject(document.id);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="project-list-page">
      <div className="project-list-card">
        <h1>
          <span className="logo">⬢</span> Rockett CAD
        </h1>
        <p className="tagline">Your CAD. Your server. Your plugins.</p>
        {error && <div className="error-banner">{error}</div>}
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
        </div>
        <div className="projects">
          <StepImportButton newProject onError={setError} />
          {projects.map((p) => (
            <div key={p.id} className="project-row">
              {renamingId === p.id ? (
                <div className="project-open project-renaming">
                  <RenameInput
                    value={p.name}
                    className="project-rename"
                    onCommit={(n) => {
                      setRenamingId(null);
                      api
                        .renameProject(p.id, n)
                        .then(refresh)
                        .catch((e) => setError(e.message));
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                  <span>
                    {p.featureCount} features ·{" "}
                    {new Date(p.modifiedAt).toLocaleString()}
                  </span>
                </div>
              ) : (
                <button
                  className="project-open"
                  onClick={() => void openProject(p.id)}
                  onDoubleClick={(e) => e.preventDefault()}
                >
                  <b>{p.name}</b>
                  <span>
                    {p.featureCount} features ·{" "}
                    {new Date(p.modifiedAt).toLocaleString()}
                  </span>
                </button>
              )}
              <button
                className="icon-btn"
                title="Rename"
                aria-label={`Rename ${p.name}`}
                onClick={() => setRenamingId(p.id)}
              >
                ✎
              </button>
              <button
                className="icon-btn"
                title="Duplicate"
                onClick={() => {
                  void api.duplicateProject(p.id).then(refresh);
                }}
              >
                ⎘
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                onClick={() => {
                  if (window.confirm(`Delete project "${p.name}"?`)) {
                    void api.deleteProject(p.id).then(refresh);
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {projects.length === 0 && (
            <div className="tree-empty">No projects yet</div>
          )}
        </div>
      </div>
      <VersionLabel />
    </div>
  );
}

function VersionLabel() {
  const [label, setLabel] = useState<ReturnType<typeof versionLabel>>();
  useEffect(() => {
    api
      .health()
      .then((h) => setLabel(versionLabel(h)))
      .catch(() => setLabel(undefined));
  }, []);
  if (!label) return null;
  return (
    <div className="version-label" title={label.title}>
      {label.text}
    </div>
  );
}

/**
 * Inline text editor used for renaming (project header + project list).
 * Enter / blur commit, Escape cancels; an empty name is ignored.
 */
function RenameInput({
  value,
  className,
  onCommit,
  onCancel,
}: {
  value: string;
  className: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const commit = () => {
    const t = text.trim();
    if (t && t !== value) onCommit(t);
    else onCancel();
  };
  return (
    <input
      autoFocus
      className={className}
      aria-label="Project name"
      value={text}
      maxLength={200}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
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

function Workspace() {
  const [showHelp, setShowHelp] = useState(false);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const busy = useStore((s) => s.busy);
  const document_ = useStore((s) => s.document);
  const closeProject = useStore((s) => s.closeProject);
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
          onClick={closeProject}
          title="Back to projects"
        >
          ⬢ Rockett CAD
        </button>
        <ProjectName name={document_?.name ?? ""} />
        <UndoRedoButtons />
        {busy && <span className="busy-indicator">⟳ working…</span>}
        <span
          className="save-indicator"
          aria-live="polite"
          title="Changes save automatically after each operation"
        >
          {busy ? "Working…" : error ? "Check message" : "Changes saved"}
        </span>
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
      <div className="main-row">
        <ModelTree />
        <ViewportView />
        <FeatureDialog />
        <SketchOffsetPanel />
        <MeasurePanel />
        <VersionLabel />
        {showHelp && (
          <DraggablePanel title="Keyboard & mouse controls">
            <div className="dialog-body shortcut-help">
              <p>
                <b>Viewport</b>
              </p>
              <p>
                Drag the ViewCube to orbit; click a face for a standard view.
              </p>
              <p>
                Middle-drag pans; right-drag or Shift+middle-drag orbits. Scroll
                to zoom.
              </p>
              <p>
                <kbd>Shift</kbd> + <kbd>F</kbd> — fit model in view
              </p>
              <p>
                <b>Modelling</b>
              </p>
              <p>
                {IDLE_SHORTCUTS.map((x, i) => (
                  <span key={x.key}>
                    {i > 0 && " · "}
                    <kbd>{x.key}</kbd> {x.label}
                  </span>
                ))}
              </p>
              <p>
                <b>Sketching</b>
              </p>
              <p>
                {SKETCH_SHORTCUTS.map((x, i) => (
                  <span key={x.key}>
                    {i > 0 && " · "}
                    <kbd>{x.key}</kbd> {x.label}
                  </span>
                ))}
              </p>
              <p>
                <kbd>X</kbd> Construction (applies to whatever tool you draw
                with next: lines, rectangles, circles, arcs, polygons, slots)
              </p>
              <p>
                Double-click a curve to edit its size. Drag a dimension label to
                move it. Dimensioning something that already has a dimension
                edits the existing one; the ✕ beside the value (or{" "}
                <kbd>Delete</kbd> on an empty box) removes it.
              </p>
              <p>
                <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + click adds/removes selections,
                including profiles. In Extrude, <kbd>Shift</kbd> + click picks a
                face instead of a profile. <kbd>Esc</kbd> ends the drawing tool.
              </p>
              <p>
                While drawing, type a size to lock it, <kbd>Tab</kbd> to move
                between sizes, <kbd>Enter</kbd> to place the shape.
              </p>
              <p>
                Line:{" "}
                {LINE_SHORTCUTS.map((x, i) => (
                  <span key={x.key}>
                    {i > 0 && " · "}
                    <kbd>{x.key}</kbd> {x.label}
                  </span>
                ))}
              </p>
              <p>
                A line within 4° of a right angle to a line it starts from snaps
                to exactly 90° (and gets a perpendicular constraint); move
                further off or type an angle for anything else.
              </p>
              <p>
                Right-click a sketch region for Extrude / Revolve, or a sketch
                line to toggle construction; right-click a sketch in the tree to
                extrude its free regions.
              </p>
              <p>
                Extrude <b>Start offset</b> begins the extrusion on a plane that
                far along the sketch or face normal (Fusion's Start → Offset);
                the arrow and ghost move with it.
              </p>
              <p>
                Extrude distance is signed: type a negative value (or drag the
                arrow into the part) to go the other way; a typed negative
                switches Join to Cut and the preview turns red.
              </p>
              <p>
                Sketches stay visible after use — used regions shade faintly but
                stay selectable; the eye in the tree hides a sketch. While
                editing an extrude or revolve, hold <kbd>Ctrl</kbd> /{" "}
                <kbd>⌘</kbd> to see the model without it and pick regions to add
                or remove.
              </p>
              <p>
                <kbd>Delete</kbd> removes selected sketch geometry.
              </p>
              <p>
                <kbd>Ctrl</kbd> + <kbd>Z</kbd> Undo · <kbd>Ctrl</kbd> +{" "}
                <kbd>Y</kbd> Redo
              </p>
            </div>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setShowHelp(false)}>
                Close controls
              </button>
            </div>
          </DraggablePanel>
        )}
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
