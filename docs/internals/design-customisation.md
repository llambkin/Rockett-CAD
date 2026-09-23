# Customisation: shortcuts, toolbar, docking and theme

Status: proposal awaiting Mark's approval under DEC-404. This is not an
approved design. CUST-004, CUST-007 and CUST-011 wait until DEC-404 records the
approval under Rulings in `WORK-ORDER.md`. The colours are SET-006's proposed
tokens from `design-settings.md`, which is itself a proposal awaiting approval
under DEC-403. Token names in backticks refer to that file.

## Starting point

The wireframes start from today's client. They assume REG has already turned
it into commands, one key dispatcher, registered panels and workbenches.

- Toolbar (`Toolbar.tsx`): one row of `tb-group`s. SKETCH, CREATE, MODIFY,
  CONSTRUCT, PATTERN, INSPECT, INSERT, EXPORT, a spacer, then the view group
  (View select, Fit, Ortho/Persp). Sketch mode swaps in a second toolbar:
  the SKETCH tools, CONSTRAIN, a spacer and Finish Sketch. Every group is a
  hard-coded array.
- Panels (`App.tsx`): `ModelTree` is fixed 220 px wide on the left.
  `FeatureDialog`, `SketchOffsetPanel`, `MeasurePanel` and the Controls help
  are `DraggablePanel`s floating over the viewport, top right beside the
  ViewCube, Measure at the bottom. One `lastPos` is shared by every panel.
  The timeline is fixed 40 px high at the bottom.
- Keys: `shortcuts.ts` lists single keys (idle S, E, F, M, I; sketch V, L, R,
  C, D, P). `App.tsx` hard-codes Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Shift+F, ?, X
  and Delete. Escape is handled in `ViewportView.tsx` and `FeatureDialog.tsx`,
  and holding Ctrl peeks during extrude and revolve edits. The Controls panel
  is hand-written prose.

```
+-- top bar: title, project, undo, redo, saved, Controls ----------------------+
+-- toolbar: SKETCH | CREATE | MODIFY | ... | EXPORT |      | View Fit Ortho --+
+-------------+----------------------------------------------------------------+
| Model tree  |                                    +----------+ +--------+     |
| 220 px      |                                    | Extrude  | |  cube  |     |
|             |                                    | fields   | +--------+     |
|             |             viewport               +----------+                |
|             |                                                                |
|             |                     +---------------------+                    |
|             |                     | Measure             |                    |
|             |                     +---------------------+                    |
+-------------+----------------------------------------------------------------+
+-- timeline ------------------------------------------------------------------+
```

## Keyboard shortcuts page

A custom page in the SET-006 slot: Settings, User, Shortcuts. An admin reaches
the App layer through `Editing`, since `keys.overrides` has scopes app and
user. Writes go through `setSetting("keys.overrides", value)` as each edit is
made; there is no Apply button.

```
+---------------+---------------------------------------------------------+
|  App          |  Keyboard shortcuts                Editing [ User   v ] |
|  User         |  ------------------------------------------------------ |
|> Shortcuts    |  [ Search commands or keys...          ]  [ Reset all ] |
|  Appearance   |                                                         |
|  Project      |  Global                                                 |
|               |    Undo             [Ctrl+Z x]          [+]  [default]  |
|               |    Redo             [Ctrl+Y x]          [+]  [default]  |
|               |                     [Ctrl+Shift+Z x]                    |
|               |    Zoom to fit      [Shift+F x]         [+]  [default]  |
|               |    Shortcut sheet   [? x]               [+]  [default]  |
|               |  Design                                                 |
|               |    Create sketch    [S x]               [+]  [default]  |
|               |    Extrude          [Shift+E x]         [+]  [user]     |
|               |                                              Reset      |
|               |    Revolve          (none)              [+]  [default]  |
|               |    Fillet           [F x]               [+]  [default]  |
|               |    ...                                                  |
|               |    Design > Sketch                                      |
|               |      Line           [L x]               [+]  [default]  |
|               |      Construction   [X x]               [+]  [default]  |
+---------------+---------------------------------------------------------+
```

- Groups follow the REG-001 key contexts: Global first, then one group per
  workbench, with its sketch and active-command contexts indented under it.
  Only Design exists today.
- Every command is listed, with or without a chord. Chords show as `kbd`
  chips in the `normalizeChord` form. `x` on a chip removes that chord;
  removing the last one stores an empty list, which unbinds the command and
  shows `(none)`.
- The badge is SET-006's source badge. `Reset` appears when the edited layer
  holds an override for that command and returns it to the inherited chords.
- Search matches the label, the command id or the chord text, so `ctrl+z`
  finds Undo. Groups with no match hide.
- Escape stays bound to `cancel` (REG-029) and is not listed, so chord
  capture can always use it to back out.

Every state has its text:

```
|  (no match)   |  No command or key matches "zz".                        |
|  (loading)    |  Loading shortcuts...                                   |
|  (failed)     |  Shortcuts did not load: <reason>.  [ Retry ]           |
|  (empty)      |  No commands are registered.                            |
```

### Chord capture

`[+]`, or a click on a chip, turns the row into a capture field with an
`accent` border.

```
|               |    Extrude          [ Press a key combination... ]      |
|               |                     Esc cancels, Tab leaves             |
|               |                                                         |
|               |    Extrude          [ Ctrl+Shift+...             ]      |
```

- The dispatcher pauses while the field has focus, so the key does not also
  run its command.
- Modifiers alone keep waiting and show what is held. The first non-modifier
  key finishes the chord.
- Escape cancels. Tab leaves the field and cancels, so a keyboard user is
  never trapped (WCAG 2.1.2).
- Chords the browser keeps, such as Ctrl+W, never reach the page and cannot
  be recorded.

### Conflict prompt

A new chord that CUST-001 reports as a conflict does not save. The prompt sits
inline under the row in `warn` text:

```
|               |    Extrude          [Shift+F]                           |
|               |      Shift+F is already Zoom to fit (Global).           |
|               |      [ Replace ]  [ Cancel ]                            |
```

- Replace removes the chord from the other command and adds it here, in one
  `setSetting` write. Cancel drops the new chord.
- A shared chord in two different workbenches is not a conflict and gets no
  prompt.
- A conflict already in the registry, for example two plugin defaults, shows
  one `warn` line on both rows:
  `Also bound to Fillet. The first registered wins.`
- Reset all is destructive, so it confirms first with
  `Reset every shortcut at the User layer?`, Reset all and Cancel.

## Toolbar customise mode

The normal toolbar gains one thing: a PINNED strip at its left, shown only
when something is pinned.

```
+--------------------------------------------------------------------------+
| PINNED           | SKETCH          | CREATE                       | ...  |
|  Extrude  Fillet |  Create Sketch  |  Revolve Sweep Loft Emboss   | ...  |
+--------------------------------------------------------------------------+
```

Customise toolbar is a command, so it appears on the Shortcuts page with no
default chord. It is also the one item of a `context-menu` on a right-click
anywhere in the toolbar. No new button.

In edit mode buttons stop running commands. The view group stays in place and
is editable too. A CUSTOMISE group takes the right end of the toolbar.

```
+--------------------------------------------------------------------------------+
| PINNED              | SKETCH                 | CREATE                          |
|  :: Extrude   ^* o  |  :: Create Sketch ^  o |  :: Revolve ^  o  :: Sweep ^  o |
|  :: Fillet    ^* o  |                        |  :: Loft (hidden) ^  o*         |
+--------------------------------------------------------------------------------+
|  ... MODIFY | PATTERN | ... | View Fit Ortho |  CUSTOMISE                      |
|                                              |  [< Move] [Move >] Reset  Done  |
+--------------------------------------------------------------------------------+

::   drag handle          ^    pin toggle, ^* pinned
o    hide toggle, o* hidden
```

- Drag by the handle to reorder within a group or into another group. The
  drop point shows as a static 2 px `accent` bar between buttons. Dropping on
  PINNED pins the command.
- Drag has a single-pointer alternative (WCAG 2.5.7): click a label to select
  it (`accent` border), then use the Move buttons. At a group's edge the
  move crosses into the next group.
- Pin and hide are toggle buttons with `aria-pressed` and labels such as
  `Pin Extrude`. A pinned command shows only in the strip, so each command
  appears once.
- A hidden command stays in place in edit mode as `text-dim` with `(hidden)`.
  It does not use `.dimmed`: white at 0.5 opacity on black measures 5.32,
  under the 7:1 text target. Outside edit mode it is gone, a group with every
  command hidden disappears, and its shortcut still works.
- Edits save to `toolbar.layout` for the active workbench as they are made.
  Done or Escape leaves edit mode. Reset confirms with
  `Reset the Design toolbar to its default order?`, then restores the
  registration order.
- While sketching, Customise edits the sketch groups the same way once REG-046
  makes them commands.

## Panel docking

Three docks: left, right and bottom (DEC-404's recommendation). The side docks
run the full height of the main row. The bottom dock spans only the viewport,
between them. The timeline stays fixed below everything and is not a panel.

```
+-- top bar -------------------------------------------------------------------+
+-- toolbar -------------------------------------------------------------------+
+---------------------+ +--------------------------------+ +-------------------+
| Model tree  [Float] | |                     +--------+ | | Extrude   [Float] |
|                     | |                     |  cube  | | |  fields           |
|                     | |       viewport      +--------+ | |                   |
|                     |S|                                |S+-------------------+
|                     | |                                | | Offsets   [Float] |
|                     | +--------------S-----------------+ |                   |
|                     | | Measure              [Float]   | |                   |
|                     | |  results                       | |                   |
+---------------------+ +--------------------------------+ +-------------------+
+-- timeline ------------------------------------------------------------------+

S    splitter
```

- A dock holds panels stacked in a line: top to bottom on the sides, left to
  right at the bottom. No tabbed stacks (DEC-404's recommendation). A splitter
  sits between stacked panels too.
- Docked title bars show `Float`; floating ones show `Dock`, which docks the
  panel on its last edge, else its registration default. Both are `icon-btn`s
  with labels such as `Dock Extrude on the right`. This is also the
  single-pointer alternative to dragging.
- A dock whose panels are all hidden by their `when` takes no space.
- Floating panels sit over the viewport as today. Each keeps its own position
  (CUST-010), `panelPlacement` keeps them clear of the ViewCube, and a
  double-click on the title resets only that panel.

Default layout, matching today: Model tree docked left at 220 px; Extrude and
the other feature dialogs, Offsets and Measure floating where they open now.
Named risk if a dialog is docked by default: the viewport resizes each time
the dialog opens and the model moves under the pointer.

### Drop target

Dragging a floating panel by its title to within 32 px of the main row's
left, right or bottom edge shows the rectangle the panel will take. Release
docks it there; release anywhere else leaves it floating where dropped.

```
+---------------------+ +--------------------------------+ +===================+
| Model tree          | |                                | #+-----------------+#
|                     | |       +-- Extrude ----+        | #|                 |#
|                     | |       |  (dragged)    |    --> | #|  drop target    |#
|                     | |       +---------------+        | #|                 |#
|                     | |                                | #+-----------------+#
+---------------------+ +--------------------------------+ +===================+

#    2 px accent outline, with a 1 px bg line inside it, no fill
```

- The outline is static: no fade, grow or slide.
- The `bg` inner line keeps the target visible over a body. `accent` against
  `body` measures only 1.16; `bg` against `body` measures 10.98.
- On an occupied edge the target is the slot the panel will take, above or
  below the docked panel nearest the pointer; the others shrink to make room.

### Splitters

- At rest a 1 px `border` line (4.43 on `bg`) inside a 6 px hit area. Hover
  and drag turn it `accent` (9.46). The cursor is `col-resize` or
  `row-resize`.
- Focusable as `role="separator"`; arrow keys move it 16 px.
- Sizes clamp to 160 px up to half the main row. The viewport keeps at least
  320 px of width; a narrowing window takes it from the right dock first, then
  the left. Sizes save to `layout.panels` for the active workbench.

## Theme and accent picker

A custom page, Settings, User, Appearance. An admin sets the app default
through `Editing`. Both settings apply as soon as they are valid.

```
+---------------+---------------------------------------------------------+
|  App          |  Appearance                        Editing [ User   v ] |
|  User         |  ------------------------------------------------------ |
|    Shortcuts  |  Theme                                                  |
|> Appearance   |    (o) Black                                [default]   |
|  Project      |                                                         |
|               |  Accent     [##] [ #66b3ff  ]               [default]   |
|               |                                                         |
|               |  Contrast                       Ratio   Needs           |
|               |    Accent on background          9.46    7.00   Pass    |
|               |    Accent on raised              7.84    7.00   Pass    |
|               |    Text on accent fill          10.88    7.00   Pass    |
+---------------+---------------------------------------------------------+
```

- The theme list holds Black only. A second theme needs its own approval
  under DEC-004 and must pass the SET-011 pairs (CUST-014).
- The accent is SET-006's colour field: the swatch opens the browser's colour
  input, and the hex text takes `#rrggbb`. Each valid entry updates the
  readout at once. The readout is text, and the verdict is a word, so it never
  depends on colour. `Below` is `err` text (8.65 on `bg`).
- Reset returns to the theme's accent and the badge falls back.

An accent that fails is shown but not saved:

```
|               |  Accent     [##] [ #3b82f6  ]               [user]      |
|               |                                             Reset       |
|               |  Contrast                       Ratio   Needs           |
|               |    Accent on background          5.71    7.00   Below   |
|               |    Accent on raised              4.73    7.00   Below   |
|               |    Text on accent fill          13.49    7.00   Pass    |
|               |  Not saved: accent text needs 7.00:1 on raised.         |
```

```
|               |  Accent     [##] [ #101010  ]               [user]      |
|               |  Contrast                       Ratio   Needs           |
|               |    Accent on background          1.10    7.00   Below   |
|               |    Accent on raised              1.09    7.00   Below   |
|               |    Text on accent fill          20.26    7.00   Pass    |
|               |  Not saved: accent text needs 7.00:1 on raised.         |
```

The 7.00 floor is this proposal. CUST-015 as written rejects only under 3:1
against the background, which would save `#3b82f6` (5.71) and leave
accent-coloured text, such as the primary toolbar buttons and the chord
capture border, at 4.73 on `raised`. `#101010` fails either floor.

### Derived tokens

The accent sets `accent`, `selection`, `profile-fill`, `gizmo` and `axis-z`
directly. `accent-fill` is the accent with each byte multiplied by 0.35 and
rounded. The brightest accent, `#ffffff`, gives `#595959`, and white text on
it measures 7.00 (7.0047), so text on any derived fill passes 7:1 with no
check. The default `#66b3ff` gives `#243f59`, with the same luminance as
SET-006's hand-set `#0b3d73` (0.0465): text on either measures 10.88.

`hover` and `sketch-line` do not follow the accent. SET-006 made hover amber
and sketch lines white so they stay apart from blue selection. Named risk: an
amber accent near `#ffd166` makes selection look like hover, and luminance
cannot catch it, since both are bright.

## Contrast figures

Every ratio uses the WCAG 2.2 formula under Contrast method in
`design-settings.md`, rounded to two places.

| Pair                              | Ratio      | Target | Used for                                   |
| --------------------------------- | ---------- | ------ | ------------------------------------------ |
| `accent` on `bg`                  | 9.46       | 7:1    | drop target, splitter drag, capture border |
| `accent` on `raised`              | 7.84       | 7:1    | accent text on hover rows and buttons      |
| `bg` against `body` `#b7bcc1`     | 10.98      | 3:1    | inner line of the drop target over a body  |
| `accent` against `body`           | 1.16       | -      | why the drop target needs the inner line   |
| `border` on `bg`                  | 4.43       | 3:1    | splitter at rest, chip borders             |
| `border` on `raised`              | 3.67       | 3:1    | chip borders on hover rows                 |
| `text-dim` on `bg`                | 10.02      | 7:1    | hidden commands, `(none)`, readout labels  |
| white at 0.5 on `bg` (`#808080`)  | 5.32       | 7:1    | why hidden commands do not use `.dimmed`   |
| `warn` on `bg`                    | 13.06      | 7:1    | conflict prompt                            |
| `err` on `bg`                     | 8.65       | 7:1    | `Below` verdict and `Not saved` line       |
| `text` on `accent-fill` `#0b3d73` | 10.88      | 7:1    | SET-006 default fill                       |
| `text` on derived `#243f59`       | 10.88      | 7:1    | fill derived from `#66b3ff`                |
| `text` on derived `#595959`       | 7.00       | 7:1    | worst derived fill, from `#ffffff`         |
| `#3b82f6` on `bg`, on `raised`    | 5.71, 4.73 | 7:1    | example accent below the proposed floor    |
| `#101010` on `bg`, on `raised`    | 1.10, 1.09 | 7:1    | example accent below both floors           |

Luminance of the colours this file adds to SET-006's list: `#101010` 0.0052,
`#243f59` 0.0465, `#3b82f6` 0.2355, `#595959` 0.0999, `#808080` 0.2159.

## Questions for Mark

1. Docks on the left, right and bottom only, no tabbed stacks, and a pinned
   strip at the left of the toolbar? Recommended: yes, as DEC-404 proposes.
2. Only the Model tree docks by default, and dialogs float as today?
   Recommended: yes, so opening a dialog never resizes the viewport.
3. Raise the accent floor from CUST-015's 3:1 on the background to 7:1 on
   `raised`? Recommended: yes, because the accent is also text.
4. The accent drives `accent`, `accent-fill` (bytes times 0.35), `selection`,
   `profile-fill`, `gizmo` and `axis-z`, while `hover` and `sketch-line` stay
   fixed? CUST-015 lists hover and sketch line as derived, so it would change.
   Recommended: yes, and let the 0.35 rule replace `#0b3d73` with `#243f59` so
   one rule owns the fill.
5. A pinned command appears only in the strip, and a command can move to
   another group? CUST-006 stores one flat `order`, which cannot say which
   group a moved command belongs to. Recommended: yes, with `order` held as one
   list per group.
6. Offer today's grey palette as `classic`? CUST-014 requires every listed
   theme to pass the SET-011 pairs, and today's `--text-dim` on `--bg1`
   measures 5.66. Recommended: no, unless it is retuned and approved as a new
   palette.
