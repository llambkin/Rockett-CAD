import { useLayoutEffect, useRef } from "react";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { IDLE_SHORTCUTS, LINE_SHORTCUTS, SKETCH_SHORTCUTS } from "../shortcuts";

let lastSize: { width: string; height: string } | null = null;

export function ControlsHelp({ onClose }: { onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = body.current!.parentElement!;
    if (lastSize) Object.assign(panel.style, lastSize);
    return () => {
      const { width, height } = panel.style;
      if (width || height) lastSize = { width, height };
    };
  }, []);
  return (
    <DraggablePanel title="Keyboard & mouse controls" className="controls-help">
      <div className="dialog-body" ref={body}>
        <div className="shortcut-help">
          <p className="help-heading">
            <b>Viewport</b>
          </p>
          <p>Drag the ViewCube to orbit; click a face for a standard view.</p>
          <p>
            Middle-drag or two-finger scroll pans; right-drag or
            Shift+middle-drag orbits. Wheel or pinch zooms to the cursor.
          </p>
          <p>
            <kbd>Shift</kbd> + <kbd>F</kbd> — fit model in view
          </p>
          <p>
            In the model tree, <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + click adds or
            removes a body or sketch and <kbd>Shift</kbd> + click selects a
            range; right-click a selected row to act on all of them.{" "}
            <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>G</kbd> groups the selected
            rows.
          </p>
          <p className="help-heading">
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
          <p className="help-heading">
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
            <kbd>X</kbd> Construction (applies to whatever tool you draw with
            next: lines, rectangles, circles, arcs, polygons, slots)
          </p>
          <p>
            Double-click a curve to edit its size. Drag a dimension label to
            move it. Dimensioning something that already has a dimension edits
            the existing one; the ✕ beside the value (or <kbd>Delete</kbd> on an
            empty box) removes it.
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
            A line within 4° of a right angle to a line it starts from snaps to
            exactly 90° (and gets a perpendicular constraint); move further off
            or type an angle for anything else.
          </p>
          <p>
            Right-click a sketch region for Extrude / Revolve, or a sketch line
            to toggle construction; right-click a sketch in the tree to extrude
            its free regions.
          </p>
          <p>
            Extrude <b>Start offset</b> begins the extrusion on a plane that far
            along the sketch or face normal (Fusion's Start → Offset); the arrow
            and ghost move with it.
          </p>
          <p>
            Extrude distance is signed: type a negative value (or drag the arrow
            into the part) to go the other way; a typed negative switches Join
            to Cut and the preview turns red.
          </p>
          <p>
            Sketches stay visible after use — used regions shade faintly but
            stay selectable; the eye in the tree hides a sketch. While editing
            an extrude or revolve, hold <kbd>Ctrl</kbd> / <kbd>⌘</kbd> to see
            the model without it and pick regions to add or remove.
          </p>
          <p>
            <kbd>Delete</kbd> removes selected sketch geometry.
          </p>
          <p>
            <kbd>Ctrl</kbd> + <kbd>Z</kbd> Undo · <kbd>Ctrl</kbd> + <kbd>Y</kbd>{" "}
            Redo
          </p>
        </div>
      </div>
      <DialogFooter onCancel={onClose} cancelLabel="Close controls" />
    </DraggablePanel>
  );
}
