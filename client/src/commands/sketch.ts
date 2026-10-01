import type { Command, CommandContext } from "./registry";

export type SketchTool =
  | "select"
  | "line"
  | "rect"
  | "centerRect"
  | "circle"
  | "arc3"
  | "polygon"
  | "slot"
  | "point"
  | "project"
  | "trim"
  | "extend"
  | "offset"
  | "dimension";

export interface SketchState {
  sketchId: string;
  tool: SketchTool;
  constructionMode: boolean;
  polygonSides: number;
}

export function sketchState(sketchId: string, tool: SketchTool): SketchState {
  return { sketchId, tool, constructionMode: false, polygonSides: 6 };
}

export const sketchHints: Record<SketchTool, string> = {
  select: "Drag points to adjust · click to select",
  line: "Click points to chain lines · double-click / Esc to end",
  rect: "Click two corners",
  centerRect: "Click centre, then a corner",
  circle: "Click centre, then a point on the circle",
  arc3: "Click start, end, then a point on the arc",
  polygon: "Click centre, then a vertex",
  slot: "Click two centres, then the radius",
  point: "Click to place points",
  dimension:
    "Click an entity or two points · Ctrl-click a line, then a line or point · right-click a dimension to change its kind",
  project:
    "Click a model edge to create a linked purple reference · source must precede this sketch",
  trim: "Click a section between intersections, or drag across sections, to remove · Esc cancels",
  extend:
    "Click near the endpoint to extend to the next boundary · Esc cancels",
  offset:
    "Ctrl-click to add/remove curves · select a connected chain · preview then Create offset",
};

export const sketchCommand = {
  id: "design.sketch",
  label: "Sketch",
  run: (s) => s.finishSketch(),
} satisfies Command;

export const sketchTools: { id: SketchTool; label: string; keys: string[] }[] =
  [
    { id: "select", label: "Select", keys: ["V"] },
    { id: "line", label: "Line", keys: ["L"] },
    { id: "rect", label: "Rect", keys: ["R"] },
    { id: "centerRect", label: "C-Rect", keys: [] },
    { id: "circle", label: "Circle", keys: ["C"] },
    { id: "arc3", label: "Arc", keys: [] },
    { id: "polygon", label: "Polygon", keys: [] },
    { id: "slot", label: "Slot", keys: [] },
    { id: "point", label: "Point", keys: ["P"] },
    { id: "dimension", label: "Dimension", keys: ["D"] },
    { id: "project", label: "Project", keys: [] },
    { id: "trim", label: "Trim", keys: ["T"] },
    { id: "extend", label: "Extend", keys: [] },
    { id: "offset", label: "Offset", keys: [] },
  ];

const enabled = (s: CommandContext) =>
  (!s.busy && s.active?.id === "design.sketch") || "Sketch is not editable";

export const sketchCommands: Command[] = [
  ...sketchTools.map((tool): Command => ({
    id: `design.sketch.${tool.id}`,
    label: tool.label,
    keys: tool.keys,
    keyContext: "design.sketch",
    enabled,
    run: (s) => s.setSketchTool(tool.id),
  })),
  {
    id: "design.sketch.construction",
    label: "Construction",
    keys: ["X"],
    keyContext: "design.sketch",
    enabled,
    run: (s) => {
      if (s.active?.id === "design.sketch")
        s.setSketchState({
          constructionMode: !s.active.state.constructionMode,
        });
    },
  },
  {
    id: "design.sketch.delete",
    label: "Delete sketch geometry",
    keys: ["Delete", "Backspace"],
    keyContext: "design.sketch",
    enabled,
    run: (s) => {
      const ids = s.selection.flatMap((item) =>
        item.kind === "sketchEntity" || item.kind === "sketchPoint"
          ? [item.entityId]
          : [],
      );
      if (ids.length > 0) return s.deleteSketchEntities(ids);
    },
  },
];

export const ANGLE_LOCK_KEY = "A";
export const lineShortcuts = [
  { key: "Shift", label: "hold to snap the angle to your snap angles" },
  { key: ANGLE_LOCK_KEY, label: "lock or unlock the angle" },
];
