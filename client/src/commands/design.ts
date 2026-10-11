import { groupSelectionCommand } from "../treeSelection";
import { sketchCommand, sketchCommands, sketchGroups } from "./sketch";
import { constraintCommands } from "./constraints";
import { sketchCreateCommand } from "./sketchCreate";
import { exitActive } from "./active";
import { featureCommand } from "./featureCommand";
import { exportCommand } from "./export";
import type { FeatureType } from "@rockett/shared";
import type { IconId } from "../icons";
import { useStore } from "../store";
import { NamedViewSelect } from "../components/NamedViewSelect";
import { StepImportButton } from "../components/StepImportButton";
import { SketchInsertButtons } from "../components/SketchInsertButtons";
import { PolygonFields } from "../components/PolygonFields";
import { ConicFields } from "../components/ConicFields";
import { ProjectFields } from "../components/ProjectFields";
import { selectedConic } from "../splineTools";
import { EVERY_WORKBENCH } from "@rockett/plugin-api";
import {
  registerCommand,
  registerToolbarGroup,
  type CommandContext,
} from "./registry";

export function openDialog(dialog: FeatureType | "export") {
  if (dialog === "export") return exportCommand.enter();
  featureCommand.enter(dialog);
}

function toggleProjection(ctx: CommandContext) {
  const vp = ctx.viewport?.current;
  if (!vp) return;
  vp.setProjection(
    vp.projection === "orthographic" ? "perspective" : "orthographic",
  );
}

const idle = (s: CommandContext) => !s.busy || "Wait for the current job";

function cancel(s: CommandContext) {
  const { active } = s;
  if (active?.id === "design.sketch")
    return active.state.tool !== "select"
      ? s.setSketchTool("select")
      : s.setSelection([]);
  if (s.active) return exitActive();
  s.setSelection([]);
}

registerCommand(sketchCommand);
registerCommand(groupSelectionCommand);
for (const command of [...sketchCommands, ...constraintCommands])
  registerCommand(command);
for (const group of sketchGroups) registerToolbarGroup(group);

registerCommand({
  id: "design.sketch.polygonFields",
  label: "Polygon",
  group: "design.sketch.group.sketch",
  before: "design.sketch.construction",
  when: (s) =>
    s.active?.id === "design.sketch" && s.active.state.tool === "polygon",
  Control: PolygonFields,
});

registerCommand({
  id: "design.sketch.projectFields",
  label: "Project",
  group: "design.sketch.group.sketch",
  before: "design.sketch.construction",
  when: (s) =>
    s.active?.id === "design.sketch" && s.active.state.tool === "project",
  Control: ProjectFields,
});

registerCommand({
  id: "design.sketch.conicFields",
  label: "Conic",
  group: "design.sketch.group.sketch",
  before: "design.sketch.construction",
  when: (s) =>
    s.active?.id === "design.sketch" &&
    (s.active.state.tool === "conic" || !!selectedConic(s)),
  Control: ConicFields,
});

registerCommand({
  id: "design.sketch.insert",
  label: "Insert",
  group: "design.sketch.group.insert",
  Control: SketchInsertButtons,
});

registerCommand({
  id: "design.sketch.extrude",
  label: "Extrude",
  icon: "extrude",
  group: "design.sketch.group.finish",
  before: "design.sketch.finish",
  tooltip: "Finish Sketch and extrude a profile",
  enabled: idle,
  run: async (s) => {
    if (s.active?.id !== "design.sketch") return;
    const { sketchId } = s.active.state;
    const selected = s.selection.filter(
      (item) => item.kind === "profile" && item.sketchId === sketchId,
    );
    await s.finishSketch();
    if (useStore.getState().active?.id === "design.sketch") return;
    s.setSelection(selected);
    openDialog("extrude");
  },
});

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
  context: EVERY_WORKBENCH,
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
  run: (ctx) => sketchCreateCommand.enter(ctx.viewport),
});

registerCommand({
  id: "design.feature",
  label: "Feature",
  interaction: featureCommand,
  run() {},
});

const DIALOG_KEYS: Partial<Record<FeatureType, string>> = {
  extrude: "E",
  fillet: "F",
  move: "M",
};

const DIALOG_DESCRIPTIONS: Partial<Record<FeatureType, string>> = {
  extrude:
    "Shift + click picks a face instead of a profile. Start offset begins the extrusion on a plane that far along the sketch or face normal (Fusion's Start → Offset); the arrow and ghost move with it. Distance is signed: type a negative value, or drag the arrow into the part, to go the other way; a typed negative switches Join to Cut and the preview turns red.",
};

const DIALOGS: Array<
  [FeatureType & IconId, string, string, (typeof GROUPS)[number][0]]
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
  const description = DIALOG_DESCRIPTIONS[type];
  registerCommand({
    id: `design.${type}`,
    label,
    icon: type,
    group: `design.group.${group}`,
    tooltip,
    ...(description && { description }),
    ...(key ? { keys: [key], keyContext: "design" } : {}),
    enabled: idle,
    run: () => openDialog(type),
  });
}

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
  run: (ctx) => ctx.viewport?.current?.zoomToFit(),
});

registerCommand({
  id: "design.cancel",
  label: "Cancel",
  description: "Ends the drawing tool.",
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
