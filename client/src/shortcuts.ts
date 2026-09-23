/**
 * Single-key shortcuts (Fusion 360 defaults). App dispatches them; the toolbar
 * tooltips and the Controls panel read the same lists so labels cannot drift.
 */

import type { DialogType, SketchTool } from "./store";

export type IdleAction =
  | { kind: "sketch" }
  | { kind: "measure" }
  | { kind: "dialog"; dialog: DialogType };

export const IDLE_SHORTCUTS: Array<{
  key: string;
  label: string;
  action: IdleAction;
}> = [
  { key: "S", label: "Sketch", action: { kind: "sketch" } },
  { key: "E", label: "Extrude", action: { kind: "dialog", dialog: "extrude" } },
  { key: "F", label: "Fillet", action: { kind: "dialog", dialog: "fillet" } },
  { key: "M", label: "Move", action: { kind: "dialog", dialog: "move" } },
  { key: "I", label: "Measure", action: { kind: "measure" } },
];

export const SKETCH_SHORTCUTS: Array<{
  key: string;
  label: string;
  tool: SketchTool;
}> = [
  { key: "V", label: "Select", tool: "select" },
  { key: "L", label: "Line", tool: "line" },
  { key: "R", label: "Rectangle", tool: "rect" },
  { key: "C", label: "Circle", tool: "circle" },
  { key: "D", label: "Dimension", tool: "dimension" },
  { key: "P", label: "Point", tool: "point" },
];

export function idleActionFor(key: string): IdleAction | undefined {
  return IDLE_SHORTCUTS.find((s) => s.key === key.toUpperCase())?.action;
}

export function sketchToolFor(key: string): SketchTool | undefined {
  return SKETCH_SHORTCUTS.find((s) => s.key === key.toUpperCase())?.tool;
}

/** Appends " (K)" when the dialog or sketch tool has a shortcut. */
export function withKey(
  title: string,
  id: DialogType | SketchTool | "sketch" | "measure",
): string {
  const key =
    IDLE_SHORTCUTS.find(
      (s) =>
        (s.action.kind === "dialog" ? s.action.dialog : s.action.kind) === id,
    )?.key ?? SKETCH_SHORTCUTS.find((s) => s.tool === id)?.key;
  return key ? `${title} (${key})` : title;
}
