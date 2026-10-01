import { createRegistry } from "@rockett/shared";
import { activeCommand } from "./active";
import { sketchToolFor } from "../shortcuts";
import { useStore } from "../store";
import { useWorkbench } from "../shell/workbench";
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

export interface HoldKey {
  id: string;
  keys: readonly string[];
  press(ctx: CommandContext): unknown;
  release(ctx: CommandContext): unknown;
}

const holdKeys = createRegistry<HoldKey>("hold key", (h) => h.id);
export const registerHoldKey = holdKeys.register;
const held = new Set<HoldKey>();

function pressHold(e: KeyEvent): boolean {
  const hold = holdKeys.list().find((h) => h.keys.includes(e.key));
  if (!hold) return false;
  if (!held.has(hold)) {
    held.add(hold);
    hold.press(useStore.getState());
  }
  return true;
}

export function releaseHolds(key?: string): void {
  for (const hold of held) {
    if (key !== undefined && !hold.keys.includes(key)) continue;
    held.delete(hold);
    if (holdKeys.get(hold.id) === hold) hold.release(useStore.getState());
  }
}

export function handleKeyUp(e: Pick<KeyboardEvent, "key">): void {
  releaseHolds(e.key);
}

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
  if (s.active) return [activeCommand(s)?.keyContext ?? s.active.id, "global"];
  return s.mode.name === "idle"
    ? [useWorkbench.getState().current, "global"]
    : ["global"];
}

function inText(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable
  );
}

function sketchKey(e: KeyEvent, s: CommandContext): boolean {
  if (s.mode.name !== "sketch") return false;
  if (e.key === "Delete" || e.key === "Backspace") {
    const ids = s.selection.flatMap((x) =>
      x.kind === "sketchEntity" || x.kind === "sketchPoint" ? [x.entityId] : [],
    );
    if (ids.length === 0) return false;
    e.preventDefault();
    void s.deleteSketchEntities(ids);
    return true;
  }
  const tool = sketchToolFor(e.key);
  if (tool) {
    s.setSketchTool(tool);
    return true;
  }
  if (e.key.toLowerCase() !== "x") return false;
  s.setMode({ ...s.mode, constructionMode: !s.mode.constructionMode });
  return true;
}

export function handleKey(e: KeyEvent): void {
  if (e.repeat || pressHold(e) || inText(e.target)) return;
  const s = useStore.getState();
  const plain = !(e.ctrlKey || e.metaKey || e.altKey || e.shiftKey);
  if (s.mode.name === "sketch" && plain && !s.busy && sketchKey(e, s)) return;
  const chord = chordOf(e);
  for (const context of keyContexts(s)) {
    const command = bound().find(
      (c) =>
        (c.keyContext === context ||
          (c.id === s.active?.id &&
            context === activeCommand(s)?.keyContext)) &&
        c.keys.includes(chord) &&
        runnable(c, s),
    );
    if (!command) continue;
    e.preventDefault();
    void runCommand(command.id);
    return;
  }
}

const releaseAll = () => releaseHolds();

export function installKeymap(): () => void {
  document.addEventListener("keydown", handleKey, true);
  document.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("blur", releaseAll);
  return () => {
    document.removeEventListener("keydown", handleKey, true);
    document.removeEventListener("keyup", handleKeyUp, true);
    window.removeEventListener("blur", releaseAll);
    releaseAll();
  };
}
