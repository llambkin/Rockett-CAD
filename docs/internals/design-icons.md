# Toolbar icons

Status: approved by Mark under DEC-405; CUST-020 and CUST-021 build it.
`dist/preview/design-icons.html`, generated and not committed, shows the set at
16, 20 and 24 px on the DEC-403 black theme, each layout and the menu.

## Drawing rules

- One SVG per `tb-btn` in `icons/`, named by its label in kebab case. The
  constraint buttons use their constraint type, since their label is a glyph.
- 24 by 24 viewBox, content inside 2 to 22, stroke 1.5, round caps and joins,
  `fill="none"`, `currentColor` only. No text, gradients, images or colours.
- Second tone: `opacity=".45"` on `currentColor`. On `text` it renders
  #737373, the `border` token, 4.43:1 on black. It marks a result preview, a
  reference, or removed material. Filled dots mark sketch points.
- Drawn by hand for this project. No icon library, no copied paths.

## Icons

| Label         | File                      | Meaning                                         |
| ------------- | ------------------------- | ----------------------------------------------- |
| Create Sketch | `icons/create-sketch.svg` | pencil drawing on a plane                       |
| Extrude       | `icons/extrude.svg`       | profile, up arrow, ghost prism                  |
| Revolve       | `icons/revolve.svg`       | profile beside an axis, arrow circling it       |
| Sweep         | `icons/sweep.svg`         | profile carried along a curved path             |
| Loft          | `icons/loft.svg`          | square base blending into an ellipse            |
| Emboss        | `icons/emboss.svg`        | raised wave standing on a face                  |
| Fillet        | `icons/fillet.svg`        | rounded corner, ghost sharp corner              |
| Chamfer       | `icons/chamfer.svg`       | cut corner, ghost sharp corner                  |
| Shell         | `icons/shell.svg`         | hollow body in section                          |
| Combine       | `icons/combine.svg`       | square and circle joined, ghost overlap         |
| Split         | `icons/split.svg`         | body in two halves either side of a plane       |
| Press/Pull    | `icons/press-pull.svg`    | box with a two-way arrow on its top face        |
| Move          | `icons/move.svg`          | four-way arrow                                  |
| Plane         | `icons/plane.svg`         | plane offset from a ghost plane                 |
| Mirror        | `icons/mirror.svg`        | triangle and ghost copy across an axis          |
| Rect Pattern  | `icons/rect-pattern.svg`  | one square and three ghost copies in a grid     |
| Circ Pattern  | `icons/circ-pattern.svg`  | one circle and five ghost copies round a centre |
| Measure       | `icons/measure.svg`       | ruler                                           |
| Import STEP   | `icons/import-step.svg`   | arrow into a tray                               |
| Canvas        | `icons/canvas.svg`        | framed picture                                  |
| STL / 3MF     | `icons/stl-3mf.svg`       | arrow out of a tray                             |
| Fit           | `icons/fit.svg`           | box inside four frame corners                   |
| Ortho/Persp   | `icons/ortho-persp.svg`   | cube with converging edges                      |
| Select        | `icons/select.svg`        | pointer                                         |
| Line          | `icons/line.svg`          | segment between two end points                  |
| Rect          | `icons/rect.svg`          | rectangle from two corner points                |
| C-Rect        | `icons/c-rect.svg`        | rectangle from centre to corner                 |
| Circle        | `icons/circle.svg`        | circle, centre and ghost radius                 |
| Arc           | `icons/arc.svg`           | arc through three points                        |
| Polygon       | `icons/polygon.svg`       | hexagon round a centre                          |
| Slot          | `icons/slot.svg`          | slot on two centres                             |
| Point         | `icons/point.svg`         | point with ghost crosshair                      |
| Dimension     | `icons/dimension.svg`     | arrowed dimension line over an edge             |
| Project       | `icons/project.svg`       | ghost edge dropped onto the sketch plane        |
| Trim          | `icons/trim.svg`          | segment between two lines removed               |
| Extend        | `icons/extend.svg`        | line carried to a boundary                      |
| Offset        | `icons/offset.svg`        | loop and ghost offset loop                      |
| Construction  | `icons/construction.svg`  | dashed line                                     |
| Delete        | `icons/delete.svg`        | bin                                             |
| Finish Sketch | `icons/finish-sketch.svg` | check mark                                      |
| Horizontal    | `icons/horizontal.svg`    | level segment                                   |
| Vertical      | `icons/vertical.svg`      | upright segment                                 |
| Coincident    | `icons/coincident.svg`    | two ends meeting in one point                   |
| Parallel      | `icons/parallel.svg`      | two slanted parallel lines                      |
| Perpendicular | `icons/perpendicular.svg` | upright on a base, ghost square corner          |
| Tangent       | `icons/tangent.svg`       | line touching a circle at one point             |
| Equal         | `icons/equal.svg`         | two lines with length ticks                     |
| Concentric    | `icons/concentric.svg`    | two circles on one centre                       |
| Midpoint      | `icons/midpoint.svg`      | point at the middle of a ticked segment         |
| Collinear     | `icons/collinear.svg`     | two segments on one dotted line                 |
| Fix           | `icons/fix.svg`           | padlock                                         |

Weak at 16 px: Emboss and Sweep blur. Import STEP and STL / 3MF are plain tray
arrows with no file type; Ortho/Persp does not show which mode is on.

## Layouts

A user picks one of three layouts. Widths below come from the current
`tb-btn` rules in headless Chromium. Noto Sans stood in for Segoe UI, which
is narrower, so Windows widths run lower.

| Layout                      | Modelling toolbar | Sketch toolbar | Height |
| --------------------------- | ----------------- | -------------- | ------ |
| Icons and labels            | 1538 px           | 1277 px        | 58 px  |
| Icons only, label in tip    | 1056 px           | 1012 px        | 46 px  |
| Labels only, as today       | 1703 px           | 1398 px, wraps | 46 px  |
| Icon beside label, rejected | 2198 px           | 1794 px        | 46 px  |

Icons and labels: 20 px icon above an 11 px label, 6 px side padding.

```
| SKETCH        | CREATE                                | MODIFY
|     [/]       |   [^]     [@]     [~]    [8]    [=]   |   [r]     [\]
| Create Sketch | Extrude Revolve  Sweep   Loft  Emboss |  Fillet  Chamfer ...
```

Icons only: 20 px icon, the label moves into the tooltip with its key.

```
| SKETCH | CREATE              | MODIFY                      | CONSTRUCT | ...
|  [/]   | [^] [@] [~] [8] [=] | [r] [\] [U] [o] [|] [#] [+] |    [z]    | ...
               Extrude profiles (E)
```

Labels only: today's toolbar.

```
| SKETCH        | CREATE                                 | MODIFY
| Create Sketch | Extrude  Revolve  Sweep  Loft  Emboss  | Fillet  Chamfer ...
```

Rules for all three:

- Constraint buttons are icon only in every layout. They never had word
  labels, and the Unicode glyphs go.
- A group is at least as wide as its title. Today CONSTRUCT already runs into
  PATTERN over the one narrow Plane button; icons only makes it worse.
- Hover draws icon and label in amber `#ffd166` on `raised`. Active draws them
  in `accent` on `raised` with a 2 px `accent` underline, 7.84:1. `accent` on
  `accent-fill` reaches only 4.9:1, so active keeps the `raised` fill.

Recommendation: icons and labels as the default. It keeps every label for
anyone learning the tools, reads like Fusion 360, is 165 px narrower than
today and stops the sketch toolbar wrapping at 1366 px, for 12 px of height.
Icons only suits small windows. Icon beside label adds 495 px, so it is out.

## Layout menu

Right-click anywhere on the toolbar opens the existing `context-menu` at the
pointer. A 14 px `finish-sketch.svg` check in a fixed left column marks the
current layout, so the labels line up. Picking an item writes `toolbar.layout`
through `setSetting` and closes the menu; a click outside closes it, as in
the other menus. The check column is the one addition to the `context-menu` pattern.

```
+----------------------+
| x  Icons and labels  |
|    Icons only        |
|    Labels only       |
+----------------------+
```

## Questions for Mark

1. Approve the 51 icons, with icons and labels as the default layout?
2. Amber hover on toolbar buttons? DEC-403 approved it for the viewport and a
   `raised` fill for UI hover. Recommended: yes, so hover reads the same
   everywhere.
