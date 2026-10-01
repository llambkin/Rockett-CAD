import { sketchCreateCommand } from "./sketchCreate";
import { measureCommand } from "./measure";
import { exitActive } from "./active";
import { featureCommand } from "./featureCommand";
import { exportCommand } from "./export";
import type { IconId } from "../icons";
import type { DialogType } from "../store";
import { viewportHandle } from "../viewportRef";
import { NamedViewSelect } from "../components/NamedViewSelect";
import { StepImportButton } from "../components/StepImportButton";
import {
  registerCommand,
  registerToolbarGroup,
  type CommandContext,
} from "./registry";

export function openDialog(dialog: DialogType) {
  if (dialog === "export") return exportCommand.enter();
  featureCommand.enter(dialog);
}

export function toggleProjection() {
  const vp = viewportHandle.current;
  if (!vp) return;
  vp.setProjection(
    vp.projection === "orthographic" ? "perspective" : "orthographic",
  );
}

const idle = (s: CommandContext) => !s.busy || "Wait for the current job";

function cancel(s: CommandContext) {
  const { mode } = s;
  if (mode.name === "sketch" && mode.tool !== "select")
    return s.setSketchTool("select");
  if (s.active && s.active.id !== "inspect.measure") return exitActive();
  s.setSelection([]);
}

const GROUPS = [
  ["sketch", "SKETCH"],
  ["create", "CREATE"],
  ["modify", "MODIFY"],
  ["construct", "CONSTRUCT"],
  ["pattern", "PATTERN"],
  ["inspect", "INSPECT"],
  ["insert", "INSERT"],
  ["export", "EXPORT"],
] as const;

for (const [name, label] of GROUPS)
  registerToolbarGroup({
    id: `design.group.${name}`,
    label,
    context: "design",
  });
registerToolbarGroup({
  id: "design.group.view",
  label: "",
  context: "design",
  end: true,
});

registerCommand({
  id: "design.sketch.create",
  label: "Create Sketch",
  icon: "sketch",
  group: "design.group.sketch",
  tooltip: "Create Sketch on a plane or planar face",
  keys: ["S"],
  keyContext: "design",
  primary: true,
  enabled: idle,
  interaction: sketchCreateCommand,
  active: (s) => s.active?.id === "design.sketch.create",
  run: () => sketchCreateCommand.enter(),
});

registerCommand({
  id: "design.feature",
  label: "Feature",
  interaction: featureCommand,
  run() {},
});

const DIALOG_KEYS: Partial<Record<DialogType, string>> = {
  extrude: "E",
  fillet: "F",
  move: "M",
};

const DIALOGS: Array<
  [DialogType & IconId, string, string, (typeof GROUPS)[number][0]]
> = [
  ["extrude", "Extrude", "Extrude profiles", "create"],
  ["revolve", "Revolve", "Revolve profiles around an axis", "create"],
  ["sweep", "Sweep", "Sweep a profile along a path", "create"],
  ["loft", "Loft", "Loft between profiles", "create"],
  ["emboss", "Emboss", "Emboss/deboss sketch onto a face", "create"],
  ["fillet", "Fillet", "Fillet edges", "modify"],
  ["chamfer", "Chamfer", "Chamfer edges", "modify"],
  ["shell", "Shell", "Shell: hollow the body", "modify"],
  ["combine", "Combine", "Combine: join, cut or intersect", "modify"],
  ["splitBody", "Split", "Split a body with a plane", "modify"],
  ["offsetFace", "Press/Pull", "Press/Pull a planar face", "modify"],
  ["move", "Move", "Move bodies", "modify"],
  [
    "constructionPlane",
    "Plane",
    "Construction plane (offset / midplane)",
    "construct",
  ],
  ["mirror", "Mirror", "Mirror bodies across a plane", "pattern"],
  [
    "linearPattern",
    "Rect Pattern",
    "Rect Pattern: repeat in rows and columns",
    "pattern",
  ],
  [
    "circularPattern",
    "Circ Pattern",
    "Circ Pattern: repeat around an axis",
    "pattern",
  ],
];

for (const [type, label, tooltip, group] of DIALOGS) {
  const key = DIALOG_KEYS[type];
  registerCommand({
    id: `design.${type}`,
    label,
    icon: type,
    group: `design.group.${group}`,
    tooltip,
    ...(key ? { keys: [key], keyContext: "design" } : {}),
    enabled: idle,
    run: () => openDialog(type),
  });
}

registerCommand({
  id: "inspect.measure",
  label: "Measure",
  icon: "measure",
  group: "design.group.inspect",
  keys: ["I"],
  keyContext: "design",
  interaction: measureCommand,
  active: (s) => s.active?.id === "inspect.measure",
  run: (s) => (s.active ? exitActive() : measureCommand.enter()),
});

registerCommand({
  id: "design.importStep",
  label: "Import STEP",
  group: "design.group.insert",
  Control: StepImportButton,
});

registerCommand({
  id: "design.referenceImage",
  label: "Canvas",
  icon: "referenceImage",
  group: "design.group.insert",
  tooltip: "Canvas: insert a reference image",
  enabled: idle,
  run: () => openDialog("referenceImage"),
});

registerCommand({
  id: "design.export",
  label: "STL / 3MF",
  icon: "export",
  group: "design.group.export",
  tooltip: "STL / 3MF export",
  enabled: idle,
  interaction: exportCommand,
  run: () => exportCommand.enter(),
});

registerCommand({
  id: "design.namedViews",
  label: "View",
  group: "design.group.view",
  Control: NamedViewSelect,
});

registerCommand({
  id: "design.fit",
  label: "Fit",
  icon: "fit",
  group: "design.group.view",
  tooltip: "Zoom to fit",
  keys: ["Shift+F"],
  keyContext: "global",
  run: () => viewportHandle.current?.zoomToFit(),
});

registerCommand({
  id: "design.cancel",
  label: "Cancel",
  keys: ["Escape"],
  keyContext: "global",
  enabled: (s) =>
    !["design.feature", "design.export"].includes(s.active?.id ?? "") ||
    idle(s),
  run: cancel,
});

registerCommand({
  id: "design.undo",
  label: "Undo",
  keys: ["Ctrl+Z"],
  keyContext: "global",
  run: (s) => s.undo(),
});

registerCommand({
  id: "design.redo",
  label: "Redo",
  keys: ["Ctrl+Y", "Ctrl+Shift+Z"],
  keyContext: "global",
  run: (s) => s.redo(),
});

registerCommand({
  id: "design.projection",
  label: "Ortho/Persp",
  icon: "projection",
  group: "design.group.view",
  tooltip: "Ortho/Persp: toggle orthographic or perspective",
  run: toggleProjection,
});
