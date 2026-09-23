# Context menus

Every right-click menu renders through `ContextMenu`
(`client/src/components/ContextMenu.tsx`), the DEC-004 `context-menu`
pattern. It closes on a pointer down outside it or on Escape (BUG-029). Items
call actions that already exist. Deleting a feature skips a confirm because
Ctrl+Z restores it; deleting a project cannot be undone, so it asks first.

## Opening

Panels open a menu from `onContextMenu`. The viewport differs because a right
drag orbits: `ViewportView.tsx` opens its menu on the right button's pointer
up, and only if no pointer move exceeded 2 px. Its `.viewport-container`
`onContextMenu` and the canvas `contextmenu` listener only suppress the
browser menu. In a dialog, measure or plane-pick mode a right-click opens
nothing, so it never competes with the pick the mode waits for.

## Surfaces with a menu

| Surface                               | Handler                    | Items                                                                                                     |
| ------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Project list row                      | `App.tsx`, `.project-row`  | Open, Rename, Duplicate, Delete                                                                           |
| Origin plane row                      | `ModelTree.tsx`            | Create sketch, when idle or picking a plane                                                               |
| Construction plane row                | `ModelTree.tsx`            | Create sketch as above, Edit, Show / Hide, Delete                                                         |
| Canvas row                            | `ModelTree.tsx`            | Edit, Show / Hide, Delete                                                                                 |
| Sketch row                            | `ModelTree.tsx`            | Edit sketch, Extrude regions, Revolve regions, Rename, Delete                                             |
| Body row                              | `ModelTree.tsx`            | Move, Rename, Show / Hide, Isolate, Show all bodies                                                       |
| Timeline chip                         | `Timeline.tsx`, `.tl-chip` | Edit, Rename, Suppress or Unsuppress, Delete                                                              |
| Face                                  | `ViewportContextMenu.tsx`  | Create Sketch on face, Extrude face, Press / Pull, Shell when planar; Hide body, Measure                  |
| Edge                                  | `ViewportContextMenu.tsx`  | Fillet edge, Chamfer edge, Measure                                                                        |
| Vertex                                | `ViewportContextMenu.tsx`  | Measure                                                                                                   |
| Region                                | `ViewportContextMenu.tsx`  | Extrude region, Revolve region, counting a multi-selection                                                |
| Committed sketch curve or point       | `ViewportContextMenu.tsx`  | Toggle construction for curves, Edit sketch                                                               |
| Sketch curve or point while sketching | `ViewportContextMenu.tsx`  | Delete; curves add Toggle construction, then Length and angle for a line or Dimension for a circle or arc |
| Empty viewport, idle or sketching     | `ViewportContextMenu.tsx`  | Fit, the seven named views, Orthographic or Perspective                                                   |

Length and angle opens the BUG-026 editor with both fields. It shows only
while sketching, because the editor works on the open sketch; on a committed
sketch Edit sketch comes first.

The empty viewport items reuse `NAMED_VIEWS` and `toggleProjection` from
`Toolbar.tsx`, so the toolbar and the menu cannot drift.

## Surfaces without a menu

- Empty timeline space: none. The four roll buttons sit beside the strip and
  every chip has its own menu.
- Sketch dimension labels: none. A click with either button opens the value
  box, which has its own delete button; a menu would repeat both.
- Constraint glyphs: none. The viewport draws no constraint glyphs today;
  constraints come from the sketch toolbar.
- Offset badges: none. A click opens the offset editor, their only action.
- Toolbar: none here. CUST-021 adds the layout menu described in
  `design-icons.md`.
- Model tree headers, document name and the Show origin row: none. Each has
  one click action.
- View cube, home button, dialogs, measure panel and top bar: none. Their
  buttons are the actions.
