import type { Command, CommandContext, ToolbarGroup } from "./registry";

export type SketchTool =
  | "select"
  | "line"
  | "rect"
  | "centerRect"
  | "circle"
  | "arc3"
  | "ellipse"
  | "fitSpline"
  | "controlSpline"
  | "conic"
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
  polygonType: "inscribed" | "circumscribed";
  polygonAngle: number | null;
  conicRho: number;
  offsetEditId: string | null;
  offsetManualSelection: boolean;
  offsetDistance: number;
  offsetChain: boolean;
  offsetJoinTolerance: number;
  moveCopy: boolean;
  projectPick: ProjectPick;
}

export type ProjectPick =
  "entities" | "bodies" | "faceSections" | "bodySections";

export const DEFAULT_RHO = 0.5;

export function sketchState(sketchId: string, tool: SketchTool): SketchState {
  return {
    sketchId,
    tool,
    constructionMode: false,
    polygonSides: 6,
    polygonType: "inscribed",
    polygonAngle: null,
    conicRho: DEFAULT_RHO,
    offsetEditId: null,
    offsetManualSelection: false,
    offsetDistance: 2,
    offsetChain: true,
    offsetJoinTolerance: 0.01,
    moveCopy: false,
    projectPick: "entities",
  };
}

export const sketchHints: Record<SketchTool, string> = {
  select: "Drag points to adjust · click to select",
  line: "Click points to chain lines · double-click to end",
  rect: "Click two corners",
  centerRect: "Click centre, then a corner",
  circle: "Click centre, then a point on the circle",
  arc3: "Click start, end, then a point on the arc",
  ellipse: "Click centre, then a major axis end, then a minor axis point",
  fitSpline:
    "Click points for the spline to pass through · double-click to end · drag the end handles to set its tangents",
  controlSpline: "Click control points · double-click to end",
  conic:
    "Click start, end, then the apex · Rho sets how far the curve bulges toward the apex",
  polygon: "Click centre, then a vertex",
  slot: "Click two centres, then the radius",
  point: "Click to place points",
  dimension:
    "Click an entity or two points · Ctrl-click a line, then a line or point · right-click a dimension to change its kind",
  project:
    "Click a model edge, face or earlier sketch curve, or a body with Bodies chosen, to create a linked purple reference · source must precede this sketch",
  trim: "Click a section between intersections, or drag across sections, to remove",
  extend: "Click near the endpoint to extend to the next boundary",
  offset:
    "Ctrl-click to add/remove curves · select a connected chain · preview then Create offset",
};

const CANCELLED = new Set<SketchTool>(["line", "trim", "extend"]);

export const sketchHint = (tool: SketchTool, cancel: string | undefined) =>
  cancel && CANCELLED.has(tool)
    ? `${sketchHints[tool]} · ${cancel} cancels`
    : sketchHints[tool];

export const sketchCommand = {
  id: "design.sketch",
  label: "Sketch",
  run: (s) => s.finishSketch(),
} satisfies Command;

export const ANGLE_LOCK_KEY = "A";
export const lineShortcuts = [
  { key: "Shift", label: "hold to snap the angle to your snap angles" },
  { key: ANGLE_LOCK_KEY, label: "lock or unlock the angle" },
];

type CurveTool = "fitSpline" | "controlSpline" | "conic";

export const sketchTools: {
  id: Exclude<SketchTool, CurveTool>;
  label: string;
  keys: string[];
  description?: string;
}[] = [
  { id: "select", label: "Select", keys: ["V"] },
  {
    id: "line",
    label: "Line",
    keys: ["L"],
    description: `${lineShortcuts.map((x) => `${x.key}: ${x.label}`).join(". ")}. A line within 4° of a right angle to a line it starts from snaps to exactly 90° and gets a perpendicular constraint; move further off or type an angle for anything else.`,
  },
  { id: "rect", label: "Rect", keys: ["R"] },
  { id: "centerRect", label: "C-Rect", keys: [] },
  { id: "circle", label: "Circle", keys: ["C"] },
  { id: "arc3", label: "Arc", keys: [] },
  { id: "ellipse", label: "Ellipse", keys: [] },
  { id: "polygon", label: "Polygon", keys: [] },
  { id: "slot", label: "Slot", keys: [] },
  { id: "point", label: "Point", keys: ["P"] },
  {
    id: "dimension",
    label: "Dimension",
    keys: ["D"],
    description:
      "Double-click a curve to edit its size. Drag a dimension label to move it. Dimensioning something that already has a dimension edits the existing one; the ✕ beside the value, or Delete on an empty box, removes it.",
  },
  { id: "project", label: "Project", keys: [] },
  { id: "trim", label: "Trim", keys: ["T"] },
  { id: "extend", label: "Extend", keys: [] },
  { id: "offset", label: "Offset", keys: [] },
];

const curveTools: { id: CurveTool; label: string; keys: string[] }[] = [
  { id: "fitSpline", label: "Fit Point Spline", keys: ["N"] },
  { id: "controlSpline", label: "Control Point Spline", keys: ["B"] },
  { id: "conic", label: "Conic", keys: ["K"] },
];

export const sketchGroups: ToolbarGroup[] = [
  {
    id: "design.sketch.group.sketch",
    label: "SKETCH",
    context: "design.sketch",
  },
  {
    id: "design.sketch.group.constrain",
    label: "CONSTRAIN",
    context: "design.sketch",
  },
  {
    id: "design.sketch.group.insert",
    label: "INSERT",
    context: "design.sketch",
  },
  {
    id: "design.sketch.group.finish",
    label: "",
    context: "design.sketch",
    end: true,
  },
];

const sketching = (s: CommandContext) =>
  s.active?.id === "design.sketch" || "Sketch is not editable";
const editable = (s: CommandContext) =>
  (!s.busy && s.active?.id === "design.sketch") || "Sketch is not editable";

export function deleteSketchSelection(s: CommandContext) {
  const ids = s.selection.flatMap((item) =>
    item.kind === "sketchEntity" || item.kind === "sketchPoint"
      ? [item.entityId]
      : [],
  );
  if (ids.length > 0) return s.deleteSketchEntities(ids);
}

export const sketchCommands: Command[] = [
  ...sketchTools.map((tool): Command => ({
    id: `design.sketch.${tool.id}`,
    label: tool.label,
    icon: tool.id,
    group: "design.sketch.group.sketch",
    keys: tool.keys,
    keyContext: "design.sketch",
    ...(tool.description && { description: tool.description }),
    enabled: sketching,
    active: (s) =>
      s.active?.id === "design.sketch" && s.active.state.tool === tool.id,
    run: (s) => {
      s.setSketchState({ moveCopy: false });
      s.setSketchTool(tool.id);
    },
  })),
  ...curveTools.map((tool): Command => ({
    id: `design.sketch.${tool.id}`,
    label: tool.label,
    keys: tool.keys,
    keyContext: "design.sketch",
    enabled: sketching,
    run: (s) => s.setSketchTool(tool.id),
  })),
  {
    id: "design.sketch.moveCopy",
    label: "Move",
    icon: "move",
    group: "design.sketch.group.sketch",
    tooltip:
      "Move/Copy: move, rotate, copy, mirror or pattern the selected sketch geometry",
    enabled: sketching,
    active: (s) =>
      s.active?.id === "design.sketch" &&
      s.active.state.tool === "select" &&
      s.active.state.moveCopy,
    run: (s) => {
      if (s.active?.id !== "design.sketch") return;
      const open = s.active.state.tool === "select" && s.active.state.moveCopy;
      if (s.active.state.tool !== "select") s.setSketchTool("select");
      s.setSketchState({ moveCopy: !open });
    },
  },
  {
    id: "design.sketch.construction",
    label: "Construction",
    icon: "construction",
    group: "design.sketch.group.sketch",
    tooltip: "Toggle construction geometry",
    description:
      "Applies to whatever tool you draw with next: lines, rectangles, circles, arcs, polygons, slots.",
    keys: ["X"],
    keyContext: "design.sketch",
    enabled: sketching,
    active: (s) =>
      s.active?.id === "design.sketch" && s.active.state.constructionMode,
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
    enabled: editable,
    run: deleteSketchSelection,
  },
  {
    id: "design.sketch.finish",
    label: "Finish Sketch",
    icon: "finishSketch",
    group: "design.sketch.group.finish",
    primary: true,
    run: (s) => s.finishSketch(),
  },
];
