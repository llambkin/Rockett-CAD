import { createRegistry } from "@rockett/shared";
import { activeCommand, activeOwner } from "./active";
import type { ViewportRef } from "../viewportRef";
import { getSetting, useSetting } from "../settings";
import { useStore } from "../store";
import { useWorkbench } from "../shell/workbench";
import {
  commands,
  runCommand,
  runnable,
  useRegistrations,
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

const MODIFIERS: Readonly<Record<string, string>> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  meta: "Ctrl",
  cmd: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};
const ORDER = ["Ctrl", "Alt", "Shift"];
const KEY_NAMES = new Map(
  [
    "Escape",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ContextMenu",
  ].map((name) => [name.toLowerCase(), name]),
);

function keyName(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  return (
    KEY_NAMES.get(key.toLowerCase()) ?? key[0]!.toUpperCase() + key.slice(1)
  );
}

export function normalizeChord(chord: string): string {
  const parts = chord.split("+");
  const last = parts.pop() ?? "";
  const key = last === "" ? "+" : last;
  const named = parts
    .filter(Boolean)
    .map((part) => MODIFIERS[part.toLowerCase()] ?? part);
  const mods = [
    ...ORDER.filter((mod) => named.includes(mod)),
    ...new Set(named.filter((mod) => !ORDER.includes(mod))),
  ];
  return [...mods, keyName(key)].join("+");
}

type Keyable = { id: string; keys?: readonly string[]; keyContext?: string };

interface KeyBinding<C extends Keyable> {
  command: C;
  context: string;
  chords: readonly string[];
  override: boolean;
}

interface KeyConflict {
  chord: string;
  ids: [string, string];
}

const clash = (a: KeyBinding<Keyable>, b: KeyBinding<Keyable>) =>
  a.context === b.context || a.context === "global" || b.context === "global";

function conflictsOf(bindings: readonly KeyBinding<Keyable>[]): KeyConflict[] {
  const ranked = bindings.toSorted((a, b) => +b.override - +a.override);
  return ranked.flatMap((a, i) =>
    ranked.slice(i + 1).flatMap((b) =>
      clash(a, b)
        ? a.chords
            .filter((chord) => b.chords.includes(chord))
            .map((chord) => ({
              chord,
              ids: [a.command.id, b.command.id] as [string, string],
            }))
        : [],
    ),
  );
}

export function resolveKeymap<C extends Keyable>(
  list: readonly C[],
  overrides: Readonly<Record<string, readonly string[]>>,
) {
  const declared = list.flatMap((command): KeyBinding<C>[] => {
    if (command.keyContext === undefined) return [];
    const own = Object.hasOwn(overrides, command.id)
      ? overrides[command.id]
      : undefined;
    const keys = own ?? command.keys ?? [];
    return [
      {
        command,
        context: command.keyContext,
        chords: [...new Set(keys.map(normalizeChord))],
        override: own !== undefined,
      },
    ];
  });
  const taken = (b: KeyBinding<C>, chord: string) =>
    declared.some((o) => o.override && clash(o, b) && o.chords.includes(chord));
  const bindings = declared.map((b) =>
    b.override ? b : { ...b, chords: b.chords.filter((c) => !taken(b, c)) },
  );
  let conflicts: KeyConflict[] | undefined;
  return {
    bindings,
    get conflicts() {
      return (conflicts ??= conflictsOf(declared));
    },
  };
}

let cached: {
  list: readonly Command[];
  overrides: Readonly<Record<string, readonly string[]>>;
  keymap: ReturnType<typeof resolveKeymap<Command>>;
} | null = null;

export function activeKeymap() {
  const list = commands();
  const overrides = getSetting("keys.overrides");
  if (cached?.list !== list || cached.overrides !== overrides)
    cached = { list, overrides, keymap: resolveKeymap(list, overrides) };
  return cached.keymap;
}

export function useKeymap(): void {
  useRegistrations();
  useSetting("keys.overrides");
}

export const chordFor = (id: string): string | undefined =>
  activeKeymap().bindings.find((b) => b.command.id === id)?.chords[0];

export function chordText(id: string, format: (chord: string) => string) {
  const chord = chordFor(id);
  return chord ? format(chord) : "";
}

export const tooltipOf = (command: {
  id: string;
  label: string;
  tooltip?: string | undefined;
}): string =>
  (command.tooltip ?? command.label) +
  chordText(command.id, (chord) => ` (${chord})`);

export function keyBindings(context: string) {
  return activeKeymap()
    .bindings.filter((b) => b.context === context)
    .flatMap((b) =>
      b.chords.slice(0, 1).map((chord) => ({
        id: b.command.id,
        chord,
        label: b.command.label,
      })),
    );
}

function chordOf(e: KeyEvent): string {
  const cased = e.key.length > 1 || e.key.toUpperCase() !== e.key.toLowerCase();
  const mods = [
    (e.ctrlKey || e.metaKey) && "Ctrl",
    e.altKey && "Alt",
    e.shiftKey && cased && "Shift",
  ];
  return normalizeChord([...mods, e.key].filter(Boolean).join("+"));
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
  const { bindings } = activeKeymap();
  for (const context of keyContexts(s)) {
    const binding = bindings.find(
      (b) =>
        (b.context === context ||
          (b.command.id === activeOwner(s) &&
            context === activeCommand(s)?.keyContext)) &&
        b.chords.includes(chord) &&
        runnable(b.command, s),
    );
    if (!binding) continue;
    e.preventDefault();
    void runCommand(binding.command.id, viewport);
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
