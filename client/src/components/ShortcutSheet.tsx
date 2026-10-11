import { Fragment, useLayoutEffect, useRef, type RefObject } from "react";
import type { Workbench } from "@rockett/plugin-api";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import { activeKeymap, chordFor, useKeymap } from "../commands/keymap";
import { commandById } from "../commands/registry";
import { useWorkbenches } from "../shell/workbench";

let lastSize: { width: string; height: string } | null = null;

type Binding = ReturnType<typeof activeKeymap>["bindings"][number];

const GESTURES: [string, string][] = [
  ["Orbit", "Right-drag, Shift+middle-drag, or drag the ViewCube"],
  ["Pan", "Middle-drag or two-finger scroll"],
  ["Zoom", "Wheel or pinch, toward the cursor"],
];

const SKETCHING = [
  "Ctrl or ⌘ + click adds or removes selections, including profiles.",
  "While drawing, type a size to lock it, Tab to move between sizes, Enter to place the shape.",
  "Right-click a sketch region for Extrude or Revolve, or a sketch line to toggle construction; right-click a sketch in the tree to extrude its free regions.",
  "Sketches stay visible after use. Used regions shade faintly but stay selectable; the eye in the tree hides a sketch.",
  "While editing an extrude or revolve, hold Ctrl or ⌘ to see the model without it and pick regions to add or remove.",
];

const belongs = (w: Workbench, context: string) =>
  context === w.id ||
  context.startsWith(`${w.id}.`) ||
  w.panels.includes(context);

const contextLabel = (context: string) =>
  commandById(context)?.label ?? context;

function Row({ binding: { command, chords } }: { binding: Binding }) {
  const chord = chords[0];
  const text = [command.label, command.description].filter(Boolean);
  return (
    <p>
      {chord && <kbd>{chord}</kbd>}
      {`${chord ? " " : ""}${text.join(": ")}`}
    </p>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <p className="help-heading">
      <b>{children}</b>
    </p>
  );
}

function Contexts({
  title,
  bindings,
  label,
}: {
  title: string;
  bindings: Binding[];
  label: (context: string) => string | undefined;
}) {
  const contexts = [...new Set(bindings.map((b) => b.context))];
  return (
    <>
      <Heading>{title}</Heading>
      {contexts.length === 0 && (
        <p className="tree-empty">No shortcuts are bound in {title}.</p>
      )}
      {contexts.map((context) => {
        const name = label(context);
        return (
          <Fragment key={context}>
            {name && <p className="help-heading">{name}</p>}
            {bindings
              .filter((b) => b.context === context)
              .map((b) => (
                <Row key={b.command.id} binding={b} />
              ))}
          </Fragment>
        );
      })}
    </>
  );
}

function Gestures() {
  const fit = chordFor("design.fit");
  return (
    <table>
      <tbody>
        {GESTURES.map(([name, how]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            <td>{how}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">Fit</th>
          <td>
            The Fit button
            {fit && (
              <>
                {" or "}
                <kbd>{fit}</kbd>
              </>
            )}
          </td>
        </tr>
        <tr>
          <th scope="row">Standard view</th>
          <td>Click a ViewCube face</td>
        </tr>
      </tbody>
    </table>
  );
}

function useLastSize(body: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const panel = body.current!.parentElement!;
    if (lastSize) Object.assign(panel.style, lastSize);
    return () => {
      const { width, height } = panel.style;
      if (width || height) lastSize = { width, height };
    };
  }, [body]);
}

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  useKeymap();
  const workbenches = useWorkbenches();
  const body = useRef<HTMLDivElement>(null);
  useLastSize(body);
  const { bindings } = activeKeymap();
  const owner = (b: Binding) => workbenches.find((w) => belongs(w, b.context));
  const global = bindings.filter((b) => b.context === "global");
  const other = bindings.filter((b) => b.context !== "global" && !owner(b));
  return (
    <DraggablePanel
      id="design.help"
      title="Keyboard & mouse controls"
      className="controls-help"
    >
      <div className="dialog-body" ref={body}>
        <div className="shortcut-sheet">
          <Heading>Viewport</Heading>
          <Gestures />
          <Heading>Sketching</Heading>
          {SKETCHING.map((tip) => (
            <p key={tip}>{tip}</p>
          ))}
          <Contexts
            title="All workbenches"
            bindings={global}
            label={() => undefined}
          />
          {workbenches.map((w) => (
            <Contexts
              key={w.id}
              title={w.label}
              bindings={bindings.filter(
                (b) => b.context !== "global" && owner(b) === w,
              )}
              label={(context) =>
                context === w.id ? undefined : contextLabel(context)
              }
            />
          ))}
          {other.length > 0 && (
            <Contexts title="Other" bindings={other} label={contextLabel} />
          )}
        </div>
      </div>
      <DialogFooter onCancel={onClose} cancelLabel="Close controls" />
    </DraggablePanel>
  );
}
