import type { Command } from "./registry";

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
