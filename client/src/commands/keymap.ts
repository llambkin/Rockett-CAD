import { createRegistry } from "@rockett/shared";
import { activeCommand } from "./active";
import type { ViewportRef } from "../viewportRef";
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
> & { isComposing?: boolean; keyCode?: number; stopPropagation?(): void };

export interface HoldKey {
  id: string;
  keys: readonly string[];
  press(ctx: CommandContext): unknown;
  release(ctx: CommandContext): unknown;
}

const holdKeys = createRegistry<HoldKey>("hold key", (h) => h.id);
const held = new Set<HoldKey>();

export function registerHoldKey(hold: HoldKey): () => void {
  const unregister = holdKeys.register(hold);
  return () => {
    held.delete(hold);
    unregister();
  };
}

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
  return [useWorkbench.getState().current, "global"];
}

function inText(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable
  );
}

type KeyContext = {
  kind: "text-entry" | "overlay";
  handle(event: KeyEvent): boolean;
};

const contexts: KeyContext[] = [];

export function pushKeyContext(context: KeyContext): () => void {
  contexts.push(context);
  const uninstall = installKeymap();
  return () => {
    const index = contexts.indexOf(context);
    if (index < 0) return;
    contexts.splice(index, 1);
    uninstall();
  };
}

export function handleKey(e: KeyEvent, viewport?: ViewportRef): void {
  if (e.isComposing || e.keyCode === 229) return;
  const typing = inText(e.target);
  const stack = contexts.toReversed();
  for (const kind of ["overlay", "text-entry"] as const) {
    if (kind === "text-entry" && typing) continue;
    for (const context of stack) {
      if (context.kind !== kind || !context.handle(e)) continue;
      e.preventDefault();
      e.stopPropagation?.();
      return;
    }
  }
  if (e.repeat || pressHold(e) || typing) return;
  const s = useStore.getState();
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
    void runCommand(command.id, viewport);
    return;
  }
}

const releaseAll = () => releaseHolds();

const installations: { viewport?: ViewportRef }[] = [];
const onKey = (event: KeyboardEvent) =>
  handleKey(event, installations.findLast((entry) => entry.viewport)?.viewport);

export function installKeymap(viewport?: ViewportRef): () => void {
  const installation = { ...(viewport && { viewport }) };
  if (installations.length === 0) {
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", releaseAll);
  }
  installations.push(installation);
  return () => {
    const index = installations.indexOf(installation);
    if (index < 0) return;
    installations.splice(index, 1);
    if (installations.length !== 0) return;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", handleKeyUp, true);
    window.removeEventListener("blur", releaseAll);
    releaseAll();
  };
}
