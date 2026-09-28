import { sketchToolFor } from "../shortcuts";
import { useStore } from "../store";
import {
  commands,
  runCommand,
  runnable,
  type Command,
  type CommandContext,
} from "./registry";

export type KeyEvent = Pick<
  KeyboardEvent,
  | "key"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "target"
  | "preventDefault"
>;

type Bound = Command & { keys: readonly string[]; keyContext: string };

const bound = (): Bound[] =>
  commands().filter((c): c is Bound => c.keyContext !== undefined);

export function keyBindings(context: string) {
  return bound()
    .filter((c) => c.keyContext === context)
    .flatMap((c) =>
      c.keys.slice(0, 1).map((chord) => ({ id: c.id, chord, label: c.label })),
    );
}

export function keyConflicts() {
  const pairs = bound().flatMap((c) =>
    [...new Set(c.keys)].map((chord) => ({
      context: c.keyContext,
      chord,
      id: c.id,
    })),
  );
  return pairs
    .map((p) => ({
      context: p.context,
      chord: p.chord,
      ids: pairs
        .filter((q) => q.context === p.context && q.chord === p.chord)
        .map((q) => q.id),
    }))
    .filter((x, i) => x.ids.length > 1 && x.ids[0] === pairs[i]?.id);
}

function chordOf(e: KeyEvent): string {
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const shift = e.shiftKey && (e.key.length > 1 || key !== e.key.toLowerCase());
  return [
    (e.ctrlKey || e.metaKey) && "Ctrl",
    e.altKey && "Alt",
    shift && "Shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

function keyContexts(s: CommandContext): string[] {
  return s.mode.name === "idle" ? ["design", "global"] : ["global"];
}

function inText(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable
  );
}

function sketchKey(e: KeyEvent, s: CommandContext): void {
  if (s.mode.name !== "sketch") return;
  if (e.key === "Delete" || e.key === "Backspace") {
    const ids = s.selection.flatMap((x) =>
      x.kind === "sketchEntity" || x.kind === "sketchPoint" ? [x.entityId] : [],
    );
    if (ids.length === 0) return;
    e.preventDefault();
    void s.deleteSketchEntities(ids);
    return;
  }
  const tool = sketchToolFor(e.key);
  if (tool) s.setSketchTool(tool);
  if (e.key.toLowerCase() === "x")
    s.setMode({ ...s.mode, constructionMode: !s.mode.constructionMode });
}

export function handleKey(e: KeyEvent): void {
  if (e.repeat || inText(e.target)) return;
  const s = useStore.getState();
  const plain = !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey);
  if (s.mode.name === "sketch" && plain && !s.busy) return sketchKey(e, s);
  const chord = chordOf(e);
  for (const context of keyContexts(s)) {
    const command = bound().find(
      (c) =>
        c.keyContext === context && c.keys.includes(chord) && runnable(c, s),
    );
    if (!command) continue;
    e.preventDefault();
    void runCommand(command.id);
    return;
  }
}

export function installKeymap(): () => void {
  document.addEventListener("keydown", handleKey, true);
  return () => document.removeEventListener("keydown", handleKey, true);
}
