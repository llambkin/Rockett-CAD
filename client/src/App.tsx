import { useEffect, useState } from "react";
import { followPath, useStore } from "./store";
import { Toolbar, openDialog } from "./components/Toolbar";
import { ModelTree } from "./components/ModelTree";
import { Timeline } from "./components/Timeline";
import { ViewportView } from "./components/ViewportView";
import { FeatureDialog } from "./components/FeatureDialog";
import { SketchOffsetPanel } from "./components/SketchOffsetPanel";
import { MeasurePanel } from "./components/MeasurePanel";
import { DraggablePanel } from "./components/DraggablePanel";
import { DialogFooter } from "./components/form/DialogFooter";
import { ProjectList, backToProjects } from "./components/ProjectList";
import { RenameInput } from "./components/RenameInput";
import { VersionLabel } from "./components/VersionLabel";
import { viewportHandle } from "./viewportRef";
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
                In the model tree, <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + click adds
                or removes a body or sketch and <kbd>Shift</kbd> + click selects
                a range; right-click a selected row to act on all of them.{" "}
                <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>G</kbd> groups the
                selected rows.
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
            <DialogFooter
              onCancel={() => setShowHelp(false)}
              cancelLabel="Close controls"
            />
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
