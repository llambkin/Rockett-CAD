import { filterSelectionFor } from "../dialogPicks";
import type { IconId } from "../icons";
import { useStore, type DialogType } from "../store";
import { alignCameraToActiveSketch, viewportHandle } from "../viewportRef";
import { NamedViewSelect } from "../components/NamedViewSelect";
import { StepImportButton } from "../components/StepImportButton";
import {
  registerCommand,
  registerToolbarGroup,
  type CommandContext,
} from "./registry";

export function openDialog(dialog: DialogType) {
  const s = useStore.getState();
  const kept = filterSelectionFor(dialog, s.selection);
  s.setMode({ name: "dialog", dialog });
  s.setSelection(kept);
}

export function toggleProjection() {
  const vp = viewportHandle.current;
  if (!vp) return;
  vp.setProjection(
    vp.projection === "orthographic" ? "perspective" : "orthographic",
  );
}

async function createSketch(s: CommandContext) {
  const plane = s.selection.find((x) => x.kind === "plane");
  if (plane) {
    await s.startSketchOnPlane(plane.ref);
    alignCameraToActiveSketch();
    return;
  }
  const face = s.selection.find((x) => x.kind === "face");
  if (face) {
    const body = s.evaluation?.bodies.find((b) => b.bodyId === face.bodyId);
    const surf = body?.faces.find((f) => f.name === face.faceName)?.surface;
    if (surf?.type === "plane") {
      await s.startSketchOnPlane({
        kind: "face",
        face: { kind: "face", bodyId: face.bodyId, faceName: face.faceName },
      });
      alignCameraToActiveSketch();
      return;
    }
  }
  s.setMode({ name: "pickPlane", purpose: "sketch" });
}

const idle = (s: CommandContext) => !s.busy || "Wait for the current job";

function cancel(s: CommandContext) {
  const { mode } = s;
  if (mode.name === "sketch" && mode.tool !== "select")
    return s.setSketchTool("select");
  if (mode.name === "pickPlane") return s.setMode({ name: "idle" });
  if (mode.name === "dialog") return s.cancelDialog();
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
  id: "design.sketch",
  label: "Create Sketch",
  icon: "sketch",
  group: "design.group.sketch",
  tooltip: "Create Sketch on a plane or planar face",
  keys: ["S"],
  keyContext: "design",
  primary: true,
  enabled: idle,
  run: createSketch,
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
  active: (s) => s.mode.name === "measure",
  run: (s) =>
    s.setMode({ name: s.mode.name === "measure" ? "idle" : "measure" }),
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
  run: () => openDialog("export"),
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
  enabled: (s) => s.mode.name !== "dialog" || idle(s),
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
