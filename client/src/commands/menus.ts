import { useSyncExternalStore } from "react";
import type { Anchored, ContextMenuItem } from "@rockett/plugin-api";
import {
  createRegistry,
  type Feature,
  type FeatureType,
  type PlaneRef,
  type TreeGroup,
} from "@rockett/shared";
import {
  MENU_RELATIONS,
  addSketchConstraints,
  relationsFor,
  sketchSelectionIds,
  type RelationType,
} from "../sketchRelations";
import { NAMED_VIEWS } from "../three/camera";
import { isIdle, useStore, type Selection } from "../store";
import {
  deleteFeatures,
  groupItems,
  selectSketchRegions,
  setBodiesVisible,
  showHide,
  ungroup,
} from "../treeSelection";
import { alignCameraToActiveSketch, type ViewportRef } from "../viewportRef";
import "./design";
import { canExportDxf } from "./export";
import { featureCommand } from "./featureCommand";
import { sketchOnPlane } from "./sketchCreate";
import { moveBodies } from "./treeMove";
import {
  commandById,
  placed,
  registerCommand,
  runCommand,
  runnable,
  useRegistrations,
  type Command,
  type CommandContext,
} from "./registry";

type Kind = TreeGroup["kind"];
type Row = { id: string };
type Renamed = Row & { startRename(id: string): void };
type Rows = { kind: Kind; ids: string[]; startRename(id: string): void };
type Coloured = Row & { pickColour(id: string): void };
type FeatureRow = Row & { feature: Feature };
type SketchPick = Row & { entityId: string; curve: boolean };
type Picked = { sel: Selection };
type FacePicked = { sel: Extract<Selection, { kind: "face" }> };

export interface MenuTargets {
  "design.tree.originPlane": { ref: PlaneRef };
  "design.tree.constructionPlane": FeatureRow & { ref: PlaneRef };
  "design.tree.canvas": FeatureRow;
  "design.tree.sketch": Renamed;
  "design.tree.sketches": Rows;
  "design.tree.body": Renamed & Rows & Coloured;
  "design.tree.bodies": Rows;
  "design.tree.groupRow": Renamed & Rows & { members: Selection[] };
  "design.timeline.chip": FeatureRow &
    Renamed & {
      quickEdit: (() => void) | undefined;
      upgradeNaming: (() => void) | undefined;
    };
  "design.viewport.empty": Record<never, never>;
  "design.viewport.sketchCurve": SketchPick;
  "design.viewport.draftCurve": SketchPick & { dimension(): void };
  "design.viewport.face": FacePicked & { planar: boolean };
  "design.viewport.edge": Picked;
  "design.viewport.region": Picked;
  "design.viewport.pick": Picked;
}

export type Surface = keyof MenuTargets;
type Targeted<T> = CommandContext & { viewport: ViewportRef; target: T };
export type MenuContext<S extends Surface> = Targeted<MenuTargets[S]>;

type SurfaceItem<S extends Surface> = Anchored & {
  surface: S;
  command: string;
  when?(ctx: MenuContext<S>): boolean;
  label?(ctx: MenuContext<S>): string;
  danger?: true;
};

export type MenuItem = { [S in Surface]: SurfaceItem<S> }[Surface];

const menuRegistry = createRegistry<MenuItem>("menu item", (i) => i.id);

export const registerMenuItem = menuRegistry.register;

export const isMenu = (menu: string): menu is Surface =>
  menuRegistry.list().some((item) => item.surface === menu);

export function menuItems<S extends Surface>(
  surface: S,
  target: MenuTargets[S],
  viewport: ViewportRef,
): ContextMenuItem[] {
  const context = (): MenuContext<S> => ({
    ...useStore.getState(),
    viewport,
    target,
  });
  const ctx = context();
  const entries = menuRegistry.list().filter((e) => e.surface === surface);
  return placed(entries).flatMap((entry): ContextMenuItem[] => {
    const item = entry as SurfaceItem<Surface> as SurfaceItem<S>;
    const command = commandById(item.command);
    if (!command?.run || item.when?.(ctx) === false) return [];
    if (command.when?.(ctx) === false) return [];
    return [
      {
        label: item.label?.(ctx) ?? command.label,
        ...(item.danger && { danger: true }),
        action: () => {
          const fresh = context();
          if (runnable(command, fresh)) void command.run?.(fresh);
        },
      },
    ];
  });
}

export function useMenuRegistrations(): void {
  useRegistrations();
  const { subscribe, snapshot } = menuRegistry;
  useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function menuCommand<T>(
  id: string,
  label: string,
  run: (ctx: Targeted<T>) => unknown,
): Command {
  return {
    id,
    label,
    when: (ctx) => "target" in ctx,
    run: (ctx) => run(ctx as Targeted<T>),
  };
}

function showBodies(s: CommandContext, visible: (id: string) => boolean) {
  const bodies = s.evaluation?.bodies ?? [];
  void setBodiesVisible(
    Object.fromEntries(bodies.map((b) => [b.bodyId, visible(b.bodyId)])),
  );
}

async function toggleSketchConstruction(sketchId: string, entityIds: string[]) {
  const s = useStore.getState();
  const sk = s.document?.features.find(
    (f) => f.id === sketchId && f.type === "sketch",
  ) as any;
  if (!sk) return;
  const ids = new Set(entityIds);
  const entities = sk.entities.map((e: any) =>
    ids.has(e.id) && e.kind !== "point"
      ? { ...e, construction: !e.construction }
      : e,
  );
  await s.updateFeature(sketchId, { entities } as any);
}

const relation = (s: CommandContext, type: RelationType) =>
  s.active?.id === "design.sketch" && s.draftSketch
    ? relationsFor(s.draftSketch, sketchSelectionIds(s.selection)).find(
        (r) => r.type === type,
      )
    : undefined;

const counted = (s: CommandContext, one: string, many: string) => {
  const n = sketchSelectionIds(s.selection).length;
  return n > 1 ? many.replace("#", String(n)) : one;
};

const regions = (s: CommandContext) =>
  s.selection.filter((x) => x.kind === "profile");

const regionsLabel = (verb: string) => (s: CommandContext) => {
  const n = regions(s).length;
  return n > 1 ? `${verb} (${n} regions)` : `${verb} region`;
};

const viewId = (label: string) => `design.menu.view.${label.toLowerCase()}`;

const FACE_FEATURES: [string, string, FeatureType][] = [
  ["extrudeFace", "Extrude face", "extrude"],
  ["pressPull", "Press / Pull", "offsetFace"],
  ["shellFace", "Shell (open this face)", "shell"],
  ["fillet", "Fillet edge", "fillet"],
  ["chamfer", "Chamfer edge", "chamfer"],
];

for (const command of [
  menuCommand<Renamed>("design.menu.rename", "Rename", ({ target }) =>
    target.startRename(target.id),
  ),
  menuCommand<Coloured>("design.menu.colour", "Colour…", ({ target }) =>
    target.pickColour(target.id),
  ),
  menuCommand<Row>("design.menu.resetColour", "Reset colour", (s) =>
    s.setBodyMeta(s.target.id, { color: null }),
  ),
  menuCommand<Row>("design.menu.deleteFeature", "Delete", (s) =>
    s.deleteFeature(s.target.id),
  ),
  menuCommand<Row>("design.menu.editSketch", "Edit sketch", (s) =>
    s.editSketch(s.target.id).then(() => alignCameraToActiveSketch(s.viewport)),
  ),
  menuCommand<Row>("design.menu.extrudeRegions", "Extrude regions…", (s) => {
    runCommand("design.extrude");
    selectSketchRegions(s.target.id);
  }),
  menuCommand<Row>("design.menu.revolveRegions", "Revolve regions…", (s) => {
    runCommand("design.revolve");
    selectSketchRegions(s.target.id);
  }),
  menuCommand<Rows>("design.menu.showHide", "Show / Hide", ({ target }) =>
    showHide(target.kind, target.ids),
  ),
  menuCommand<Rows>("design.menu.group", "Group", async ({ target }) => {
    const group = await groupItems(target.kind, target.ids);
    if (group) target.startRename(group.id);
  }),
  menuCommand<Rows>("design.menu.deleteFeatures", "Delete", ({ target }) =>
    deleteFeatures(target.ids),
  ),
  menuCommand<Rows>("design.menu.moveBodies", "Move…", ({ target }) =>
    moveBodies(target.ids),
  ),
  menuCommand<Rows>("design.menu.isolate", "Isolate", (s) =>
    showBodies(s, (id) => s.target.ids.includes(id)),
  ),
  menuCommand<Rows>("design.menu.showAllBodies", "Show all bodies", (s) =>
    showBodies(s, () => true),
  ),
  menuCommand<{ members: Selection[] }>(
    "design.menu.selectMembers",
    "Select members",
    (s) => s.setSelection(s.target.members),
  ),
  menuCommand<Row>("design.menu.ungroup", "Ungroup", ({ target }) =>
    ungroup(target.id),
  ),
  menuCommand<FeatureRow>("design.menu.suppress", "Suppress", (s) =>
    s.suppressFeature(s.target.id, !s.target.feature.suppressed),
  ),
  menuCommand<MenuTargets["design.timeline.chip"]>(
    "design.menu.quickEdit",
    "Quick edit",
    ({ target }) => target.quickEdit?.(),
  ),
  menuCommand<MenuTargets["design.timeline.chip"]>(
    "design.menu.upgradeNaming",
    "Upgrade naming…",
    ({ target }) => target.upgradeNaming?.(),
  ),
  ...MENU_RELATIONS.map(({ type, label }): Command => ({
    id: `design.menu.relation.${type}`,
    label,
    run: (s) => {
      const found = relation(s, type);
      if (found) return addSketchConstraints(found.constraints);
    },
  })),
  ...NAMED_VIEWS.map((v): Command => ({
    id: viewId(v.label),
    label: v.label,
    run: (s) => s.viewport?.current?.setView(v.dir, v.up),
  })),
  menuCommand<SketchPick>(
    "design.menu.toggleConstruction",
    "Toggle construction",
    (s) =>
      toggleSketchConstruction(s.target.id, sketchSelectionIds(s.selection)),
  ),
  menuCommand<SketchPick>("design.menu.deleteEntities", "Delete", (s) =>
    s.deleteSketchEntities(sketchSelectionIds(s.selection)),
  ),
  menuCommand<SketchPick>(
    "design.menu.toggleDraftConstruction",
    "Toggle construction",
    (s) => s.toggleSketchConstruction(sketchSelectionIds(s.selection)),
  ),
  menuCommand<MenuTargets["design.viewport.draftCurve"]>(
    "design.menu.dimension",
    "Dimension…",
    ({ target }) => target.dimension(),
  ),
  menuCommand<FacePicked>(
    "design.menu.sketchOnFace",
    "Create Sketch on face",
    (s) => {
      const { bodyId, faceName } = s.target.sel;
      return sketchOnPlane({
        kind: "face",
        face: { kind: "face", bodyId, faceName },
      }).then(() => alignCameraToActiveSketch(s.viewport));
    },
  ),
  ...FACE_FEATURES.map(([name, label, type]) =>
    menuCommand<Picked>(`design.menu.${name}`, label, ({ target }) =>
      featureCommand.enter(type, { selection: [target.sel] }),
    ),
  ),
  menuCommand<FacePicked>("design.menu.hideBody", "Hide body", (s) =>
    s.setVisible({ bodies: { [s.target.sel.bodyId]: false }, features: {} }),
  ),
  menuCommand<Picked>("design.menu.extrudeRegion", "Extrude region", (s) =>
    featureCommand.enter("extrude", { selection: regions(s) }),
  ),
  menuCommand<Picked>("design.menu.revolveRegion", "Revolve region", (s) =>
    featureCommand.enter("revolve", { selection: regions(s) }),
  ),
  menuCommand<Picked>("design.menu.measure", "Measure", (s) => {
    s.setSelection([s.target.sel]);
    void runCommand(MEASURE, s.viewport);
  }),
])
  registerCommand(command);

type Placed<S extends Surface> =
  string | Omit<SurfaceItem<S>, "id" | "surface">;

function place<S extends Surface>(surface: S, entries: Placed<S>[]) {
  for (const entry of entries) {
    const item = typeof entry === "string" ? { command: entry } : entry;
    const name = item.command.split(".").at(-1);
    registerMenuItem({
      ...item,
      id: `${surface}.${name}`,
      surface,
    } as MenuItem);
  }
}

const MEASURE = "rockett.measure.run";
const measure = {
  command: "design.menu.measure",
  when: () => commandById(MEASURE) !== undefined,
};
const notSketching = (s: CommandContext) => s.active?.id !== "design.sketch";
const relations = MENU_RELATIONS.map(({ type }) => ({
  command: `design.menu.relation.${type}`,
  when: (s: CommandContext) => relation(s, type) !== undefined,
}));

place("design.tree.originPlane", [
  { command: "design.menu.sketchOnPlane", when: notSketching },
]);
place("design.tree.constructionPlane", [
  { command: "design.menu.sketchOnPlane", when: notSketching },
  "design.menu.editFeature",
  "design.menu.toggleFeature",
  { command: "design.menu.deleteFeature", danger: true },
]);
place("design.tree.canvas", [
  "design.menu.editFeature",
  "design.menu.toggleFeature",
  { command: "design.menu.deleteFeature", danger: true },
]);
place("design.tree.sketch", [
  "design.menu.editSketch",
  "design.menu.extrudeRegions",
  "design.menu.revolveRegions",
  { command: "design.menu.exportDxf", when: canExportDxf },
  "design.menu.rename",
  { command: "design.menu.deleteFeature", danger: true },
]);
place("design.tree.sketches", [
  "design.menu.showHide",
  "design.menu.group",
  { command: "design.menu.deleteFeatures", danger: true },
]);
place("design.tree.body", [
  "design.menu.moveBodies",
  "design.menu.rename",
  "design.menu.colour",
  {
    command: "design.menu.resetColour",
    when: (s) => s.document?.bodyMeta[s.target.id]?.color !== undefined,
  },
  "design.menu.showHide",
  "design.menu.isolate",
  "design.menu.showAllBodies",
]);
place("design.tree.bodies", [
  "design.menu.moveBodies",
  "design.menu.group",
  "design.menu.showHide",
  "design.menu.isolate",
  "design.menu.showAllBodies",
]);
place("design.tree.groupRow", [
  "design.menu.rename",
  { command: "design.menu.showHide", label: () => "Show / Hide all" },
  "design.menu.selectMembers",
  "design.menu.ungroup",
]);
place("design.timeline.chip", [
  "design.menu.editFeature",
  {
    command: "design.menu.quickEdit",
    when: (s) => isIdle(s) && s.target.quickEdit !== undefined,
  },
  "design.menu.rename",
  {
    command: "design.menu.suppress",
    label: (s) => (s.target.feature.suppressed ? "Unsuppress" : "Suppress"),
  },
  { command: "design.menu.deleteFeature", danger: true },
  {
    command: "design.menu.upgradeNaming",
    when: (s) => s.target.upgradeNaming !== undefined,
  },
]);
place("design.viewport.empty", [
  ...relations,
  "design.fit",
  ...NAMED_VIEWS.map((v) => viewId(v.label)),
  {
    command: "design.projection",
    label: (s) =>
      s.viewport.current?.projection === "orthographic"
        ? "Perspective"
        : "Orthographic",
  },
]);
place("design.viewport.sketchCurve", [
  {
    command: "design.menu.toggleConstruction",
    when: (s) => s.target.curve,
    label: (s) => counted(s, "Toggle construction", "Toggle construction (#)"),
  },
  "design.menu.editSketch",
]);
place("design.viewport.draftCurve", [
  ...relations,
  {
    command: "design.menu.deleteEntities",
    label: (s) => counted(s, "Delete", "Delete (#)"),
  },
  {
    command: "design.menu.toggleDraftConstruction",
    when: (s) => s.target.curve,
    label: (s) =>
      counted(s, "Toggle construction", "Toggle construction (selection)"),
  },
  {
    command: "design.menu.dimension",
    when: (s) => s.target.curve && draftKind(s) !== undefined,
    label: (s) =>
      draftKind(s) === "line" ? "Length and angle…" : "Dimension…",
  },
]);
const planar = (s: MenuContext<"design.viewport.face">) => s.target.planar;
place("design.viewport.face", [
  { command: "design.menu.sketchOnFace", when: planar },
  { command: "design.menu.extrudeFace", when: planar },
  { command: "design.menu.pressPull", when: planar },
  { command: "design.menu.shellFace", when: planar },
  { command: "design.menu.exportDxf", when: canExportDxf },
  "design.menu.hideBody",
  measure,
]);
place("design.viewport.edge", [
  "design.menu.fillet",
  "design.menu.chamfer",
  measure,
]);
place("design.viewport.region", [
  { command: "design.menu.extrudeRegion", label: regionsLabel("Extrude") },
  { command: "design.menu.revolveRegion", label: regionsLabel("Revolve") },
]);
place("design.viewport.pick", [measure]);

function draftKind(s: MenuContext<"design.viewport.draftCurve">) {
  return s.draftSketch?.entities.find((x) => x.id === s.target.entityId)?.kind;
}
