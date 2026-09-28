import type { SketchTool } from "./store";

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
  { key: "T", label: "Trim", tool: "trim" },
];

export const ANGLE_LOCK_KEY = "A";

export const LINE_SHORTCUTS: Array<{ key: string; label: string }> = [
  { key: "Shift", label: "hold to snap the angle to your snap angles" },
  { key: ANGLE_LOCK_KEY, label: "lock or unlock the angle" },
];

export function sketchToolFor(key: string): SketchTool | undefined {
  return SKETCH_SHORTCUTS.find((s) => s.key === key.toUpperCase())?.tool;
}
