import type { PanelLayouts } from "@rockett/shared";
import { panelPlacement, panelSize } from "../panelPlacement";

export type PanelLayout = PanelLayouts[string];
export type PanelState = PanelLayout[string];
type Docked = Extract<PanelState, { kind: "docked" }>;
type Floating = Extract<PanelState, { kind: "floating" }>;
export type DockEdge = Docked["edge"];
export type PanelRoom = {
  viewport: Parameters<typeof panelPlacement>[2];
  cube?: Parameters<typeof panelPlacement>[3];
};
type Point = { x: number; y: number };
type Size = { width: number; height: number };

const EDGES: readonly DockEdge[] = ["left", "right", "bottom"];

const own = <T>(record: Readonly<Record<string, T>>, id: string) =>
  Object.hasOwn(record, id) ? record[id] : undefined;

function placed({ x, y }: Point, size: Size, room: PanelRoom): Floating {
  const fitted = panelSize(size, room.viewport);
  return {
    kind: "floating",
    ...panelPlacement({ x, y }, fitted, room.viewport, room.cube),
    ...fitted,
  };
}

function dense(layout: PanelLayout): PanelLayout {
  const orders = new Map<string, number>();
  for (const edge of EDGES)
    Object.entries(layout)
      .flatMap(([id, p]) =>
        p.kind === "docked" && p.edge === edge ? [[id, p.order] as const] : [],
      )
      .toSorted((a, b) => a[1] - b[1])
      .forEach(([id], order) => orders.set(id, order));
  return Object.fromEntries(
    Object.entries(layout).map(([id, p]) => {
      const order = orders.get(id);
      return [
        id,
        p.kind === "docked" && order !== undefined && order !== p.order
          ? { ...p, order }
          : p,
      ];
    }),
  );
}

function update(
  layout: PanelLayout,
  id: string,
  next: (state: PanelState) => PanelState,
): PanelLayout {
  const state = own(layout, id);
  if (!state) return layout;
  const changed = next(state);
  return changed === state ? layout : dense({ ...layout, [id]: changed });
}

export function resolveLayout(
  layouts: PanelLayouts,
  workbench: string,
  defaults: PanelLayout,
  room: PanelRoom,
): PanelLayout {
  const stored = own(layouts, workbench) ?? {};
  const merged = { ...defaults, ...stored };
  return dense(
    Object.fromEntries(
      Object.entries(merged).map(([id, p]) => [
        id,
        p.kind === "floating" ? placed(p, p, room) : p,
      ]),
    ),
  );
}

export const resetLayout = (layouts: PanelLayouts, workbench: string) =>
  Object.hasOwn(layouts, workbench)
    ? Object.fromEntries(
        Object.entries(layouts).filter(([id]) => id !== workbench),
      )
    : layouts;

export const movePanel = (
  layout: PanelLayout,
  id: string,
  to: Point,
  room: PanelRoom,
) =>
  update(layout, id, (p) => (p.kind === "floating" ? placed(to, p, room) : p));

export const floatPanel = (
  layout: PanelLayout,
  id: string,
  rect: Point & Size,
  room: PanelRoom,
) => update(layout, id, () => placed(rect, rect, room));

export const closePanel = (layout: PanelLayout, id: string) =>
  update(layout, id, (p) => (p.kind === "closed" ? p : { kind: "closed" }));

export const resizePanel = (
  layout: PanelLayout,
  id: string,
  size: Size,
  room: PanelRoom,
) =>
  update(layout, id, (p) => {
    if (p.kind === "floating") return placed(p, size, room);
    if (p.kind === "docked")
      return {
        ...p,
        size: Math.max(0, p.edge === "bottom" ? size.height : size.width),
      };
    return p;
  });

export function dockPanel(
  layout: PanelLayout,
  id: string,
  edge: DockEdge,
  size: number,
  at = Infinity,
): PanelLayout {
  if (!own(layout, id)) return layout;
  const without = dense({ ...layout, [id]: { kind: "closed" } });
  return dense({
    ...without,
    [id]: { kind: "docked", edge, order: at - 0.5, size: Math.max(0, size) },
  });
}
