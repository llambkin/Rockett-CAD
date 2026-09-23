# Settings panel and black theme

Status: approved under DEC-403. The live theme is the graded greys from
Mark's Greys ruling (SET-023), with the text accent split from the viewport
accent and the pairs BUG-030 and BUG-034 fixed; see Graded greys. The black
values below are what SET-011 shipped before that ruling.

The panel builds every page from the SET-001 registry. SET-008 and SET-009
moved the old values into tokens unchanged; SET-011 swapped in the black
values below, and SET-023 replaced its surfaces with the graded greys.

## Settings panel

A `Settings` icon-btn in the top bar, next to `Controls`, opens one fixed
panel centred over the workspace. Esc or `x` closes it. Edits save as they
are made through `setSetting`; there is no Apply button.

```
+-- Settings -------------------------------------------------------- x --+
|               |                                                         |
|  App          |  User                          Editing  [ User      v ] |
|> User         |  ------------------------------------------------------ |
|    Shortcuts  |  Length units        [ mm         v ]  [user]    Reset  |
|  Project      |  Orbit style         [ Turntable  v ]  [app]            |
|  Demo         |  Zoom step           [ 1.12        ]   [default]        |
|               |  Invert zoom         [x]               [user]    Reset  |
|               |  Pick tolerance      [ 7           ] px [default]       |
|               |                                                         |
+---------------+---------------------------------------------------------+
```

- The section list holds App, User and Project, then one entry per
  `plugin:<id>` section, labelled with the plugin name. Custom pages sit
  indented under the section that registers them.
- Fields follow registration order inside a section. There are no sub-groups.
- `Editing` picks the layer the page writes. It lists only layers that the
  page's keys allow in `scopes` and that this user can write. The App, User
  and Project pages default to their own layer; a plugin page defaults to the
  narrowest writable layer, as `setSetting` does without a scope.
- A key whose `scopes` exclude the edited layer shows read-only with the line
  `Not set at the Project layer.`

Every page states its empty, loading and error text:

```
+---------------+---------------------------------------------------------+
|  Project      |  Open a project to change its settings.                 |
|  Demo         |  No settings in this section.                           |
|  (loading)    |  Loading settings...                                    |
|  (failed)     |  Settings did not load: <reason>.  [ Retry ]            |
|  App, member  |  Only an administrator can change app settings.         |
+---------------+---------------------------------------------------------+
```

The last row shows the App page values read-only with their badges.

## Fields, source badge and reset

One KIT field per value type, chosen from the definition's schema:

```
number   Zoom step          [ 1.12        ]      [default]
         range and unit come from the schema: "1.02 to 1.5"

enum     Length units       [ mm         v ]     [user]    Reset

boolean  Invert zoom        [x]                  [user]    Reset

colour   Accent             [##] [ #66b3ff  ]    [app]
         swatch plus hex text; the swatch is not the only readout

text     Post name          [ grbl-default ]     [project] Reset
```

The field shows the value this layer produces: the layer's own value, else the
value inherited from broader layers. The badge names its source.

```
[default]   registry default, no layer holds a value
[app]       app layer
[user]      user layer
[project]   project layer
```

- Badges are text, so the source never depends on colour. The badge for a
  value held by the edited layer has an `accent` border; the rest use
  `border`.
- `Reset` appears only when the edited layer holds the key. It clears the key
  from that layer. The field falls back and the badge changes, for example
  `[user]` to `[app]`.
- A narrower layer that overrides the edited one adds a line under the field:
  `Project sets this to in.`
- A bad entry keeps the old value, gives the field an `err` border and shows
  the message in `err` text below it: `Enter a number from 2 to 20.`
- A stored value that failed validation (SET-002) shows one `warn` line:
  `Stored value ignored: <reason>.` with its own Reset.

## Custom pages

A section may register a page component instead of generated fields. The
panel draws the frame, the nav entry and the title. The page owns everything
inside the content area, including its own empty, loading and error text.
CUST-003 designs the keyboard shortcuts page on these tokens.

```
+---------------+---------------------------------------------------------+
|  App          |  Keyboard shortcuts                                     |
|  User         |  ------------------------------------------------------ |
|> Shortcuts    |                                                         |
|  Project      |      +-----------------------------------------------+  |
|  Demo         |      |  page component slot (CUST-003)               |  |
|               |      +-----------------------------------------------+  |
|               |                                                         |
+---------------+---------------------------------------------------------+
```

## Theme tokens

Two neutral surfaces replace today's four: `bg` for the app, panels and
viewport, and `raised` for inputs, buttons, hover rows, chips, menus and
labels. Panels separate from the viewport by `border`, not by a grey fill.
Only `text` sits on `accent-fill` and `err-fill`.

Targets: text 7:1 against every surface it sits on. Borders and viewport marks
3:1 against the black background (WCAG 1.4.11 non-text contrast). Ratios use
the formula under Contrast method.

### Interface tokens

| Token         | Proposed  | Today, where                                                                                | On `bg` | On `raised` | Target |
| ------------- | --------- | ------------------------------------------------------------------------------------------- | ------- | ----------- | ------ |
| `bg`          | `#000000` | `--bg0` #1e2124, `--bg1` #26292d; `.project-list-page` gradient #2a2f36                     | -       | 1.21        | -      |
| `raised`      | `#1a1a1a` | `--bg2` #2e3237, `--bg3` #383d43; `.viewport-hint`, `.dim-label`, `.dim-entry` rgba fills   | 1.21    | -           | -      |
| `border`      | `#737373` | `--border` #43494f                                                                          | 4.43    | 3.67        | 3:1    |
| `text`        | `#ffffff` | `--text` #d6dae0; `.snap-marker.point` outline #fff                                         | 21.00   | 17.40       | 7:1    |
| `text-dim`    | `#b3b3b3` | `--text-dim` #9aa2ab                                                                        | 10.02   | 8.30        | 7:1    |
| `accent`      | `#66b3ff` | `--accent` #3ba1e8                                                                          | 9.46    | 7.84        | 7:1    |
| `accent-fill` | `#0b3d73` | `--accent-dim` #2b7fb8 as fill; `.dim-field.active` rgba(59, 161, 232, 0.14)                | 1.93    | -           | -      |
| `ok`          | `#4cc36a` | `--ok` #47b04b                                                                              | 9.32    | 7.73        | 7:1    |
| `warn`        | `#ffc247` | `--warn` #e8a33b                                                                            | 13.06   | 10.82       | 7:1    |
| `err`         | `#ff8080` | `--err` #e85a4f; `--danger` fallback #ff5a5a                                                | 8.65    | 7.17        | 7:1    |
| `err-fill`    | `#3d0f0f` | `.error-toast`, `.error-banner` #4a2622                                                     | 1.27    | -           | -      |
| `offset`      | `#ffcc66` | `.dim-label.offset-label` #ffcc66 text, #d6a74d border; `SketchOffsetPanel` line #ffcc66    | 14.08   | 11.67       | 7:1    |
| `shadow`      | `#000000` | `rgba(0, 0, 0, 0.4 to 0.9)` shadows on snap markers, dialogs and menus; alpha stays per use | -       | -           | -      |

Text on the fills: `text` on `accent-fill` 10.88, on `err-fill` 16.49. The
`.error-toast` text #f4c7c3 becomes `text`.

- `--accent-dim` also draws borders today (`.dim-label`, `.sel-info.have`,
  `.measure-block.main`, `.tl-chip:hover`, `.project-open:hover`). Those
  borders take `accent`, since `accent-fill` reaches only 1.93 on `bg`.
- `--danger` is never defined, so `.dim-edit-delete:hover` always shows its
  fallback. It becomes `err`.
- Labels drawn over the model become opaque `raised`. At today's 0.92 alpha
  over a white body the composite is #2c2c2c, where `text-dim` reaches only
  6.66 and `accent` 6.29.

Today's palette misses the 7:1 text target in places: `--text-dim` on `--bg1`
5.66, `--err` on `--bg0` 4.63, `--text` on `--accent-dim` 3.10.

### Viewport tokens

three.js reads these through `themeColor(name)` after SET-009. Current values
come from `COLORS` in `CadViewport.ts` unless another file is named.

| Token                 | Proposed               | Today, where                                                                                              | On `bg`       |
| --------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| `viewport-bg`         | `#000000` (`bg`)       | `COLORS.bg` #2a2d30, the clear colour                                                                     | -             |
| `body`                | `#b7bcc1`, unchanged   | `COLORS.body`                                                                                             | 10.98         |
| `edge`                | `#30343a`, unchanged   | `COLORS.edge`, body edges and vertices                                                                    | 1.68          |
| `selection`           | `#66b3ff` (`accent`)   | `COLORS.selected` #4da3ff                                                                                 | 9.46          |
| `hover`               | `#ffd166`              | `COLORS.hover` #77c4ff; `ExtrudeGizmo` and `RevolveGizmo` hover #8fd0ff; `MoveGizmo` axis hover #ffd166   | 14.56         |
| `sketch-line`         | `#ffffff`              | `COLORS.sketchLine` #3ba1e8; `COLORS.sketchPoint` #1c72b8 merges here                                     | 21.00         |
| `sketch-inactive`     | `#b3b3b3` (`text-dim`) | `sketchRender.ts` #7a92a8                                                                                 | 10.02         |
| `sketch-dimmed`       | `#737373` (`border`)   | `sketchRender.ts` #566478                                                                                 | 4.43          |
| `sketch-construction` | `#8f7fe8`, unchanged   | `COLORS.sketchConstruction`                                                                               | 6.37          |
| `sketch-external`     | `#bb88ff`, unchanged   | `sketchRender.ts` #bb88ff                                                                                 | 8.08          |
| `profile-fill`        | `#66b3ff` (`accent`)   | `COLORS.profileFill` #3ba1e8 at 0.06 to 0.18 alpha                                                        | 9.46          |
| `dimension`           | `#b3b3b3` (`text-dim`) | `ViewportView.tsx` leader #9aa2ab                                                                         | 10.02         |
| `plane`               | `#4fd1c5`              | `COLORS.planeFill` #f2b34c, construction planes                                                           | 11.26         |
| `origin-plane`        | `#999faf`, unchanged   | origin plane fill #999faf and border #8b93a5 merge                                                        | 7.93          |
| `grid`                | none                   | no grid is drawn today; add the token with the grid                                                       | -             |
| `axis-x`              | `#ff8080` (`err`)      | origin axis #cc5555; `MoveGizmo` X #e05c5c                                                                | 8.65          |
| `axis-y`              | `#4cc36a` (`ok`)       | origin axis #55aa55; `MoveGizmo` Y #62c162                                                                | 9.32          |
| `axis-z`              | `#66b3ff` (`accent`)   | origin axis #5577cc; `MoveGizmo` Z #4da3ff                                                                | 9.46          |
| `gizmo`               | `#66b3ff` (`accent`)   | `ExtrudeGizmo` arrow and add preview, `RevolveGizmo` ring, `revolveGhost`, `MoveGizmo` ghost, all #4da3ff | 9.46          |
| `gizmo-handle`        | `#ffd166`, unchanged   | `RevolveGizmo` handle                                                                                     | 14.56         |
| `gizmo-cut`           | `#ff8080` (`err`)      | `ExtrudeGizmo` cut preview #ff5a5a                                                                        | 8.65          |
| `offset-marker`       | `#ff9933`, unchanged   | `SketchOffsetPanel.tsx` markers                                                                           | 9.86          |
| `viewcube-face`       | `#1a1a1a` (`raised`)   | `ViewCube.ts` face #3d4249                                                                                | 1.21          |
| `viewcube-edge`       | `#737373` (`border`)   | `ViewCube.ts` face border #565e68, cube edges #767f8a                                                     | 4.43          |
| `viewcube-label`      | `#ffffff` (`text`)     | `ViewCube.ts` label #c8cfd8                                                                               | 17.40 on face |
| `light-sky`           | `#ffffff`, unchanged   | `HemisphereLight` sky                                                                                     | -             |
| `light-ground`        | `#555566`, unchanged   | `HemisphereLight` ground                                                                                  | -             |
| `light-key`           | `#ffffff`, unchanged   | `DirectionalLight` key                                                                                    | -             |

Lights are illuminants, not marks, so they carry no ratio. A token in
brackets reuses that interface token's value; SET-009 may point one at the
other rather than store a second copy.

`COLORS.bodyHover` #d3dbe3, `COLORS.edgeHover` #38b6ff, `COLORS.sketchFixed`
#2c9c3e and `COLORS.dimension` #d8dee6 have no reader today. SET-009 deletes
them rather than naming them.

Pairs the luminance formula cannot settle, today then proposed:

| Pair                     | Today | Proposed |
| ------------------------ | ----- | -------- |
| sketch line vs selection | 1.07  | 2.22     |
| hover vs selection       | 1.39  | 1.54     |
| hover vs body            | 1.01  | 1.33     |
| selection vs body        | 1.37  | 1.16     |
| edge vs body             | 6.54  | 6.54     |

Hover and selection on a face differ from the body by hue, not lightness,
today and in this proposal. Amber hover against blue selection is the widest
hue gap the palette allows. Named risk: a user with a blue-yellow deficiency
may still confuse them. Z shares `accent` with selection, as `MoveGizmo`
already does. `edge` reaches 1.68 against black, so a silhouette on the
shaded side of a body may fade; SET-011's browser check should look for it.

### Graded greys

Mark's Greys ruling (SET-023) brought back the four greys, so the values below
replace the black surfaces and the tokens that failed on them. Every other
value in the tables above stands. The lightest surface, `bg3`, sets each
floor. The fills are the opaque base colours of today's translucent ones,
since a label over a white body would lose contrast at any alpha.

| Surface                           | Value     |
| --------------------------------- | --------- |
| `bg0`, `hint-fill`                | `#1e2124` |
| `bg1`, `label-fill`, `entry-fill` | `#26292d` |
| `bg2`                             | `#2e3237` |
| `bg3`                             | `#383d43` |
| `bg-glow`                         | `#2a2f36` |
| `offset-fill`                     | `#282b30` |
| `viewport-bg`                     | `#2a2d30` |

| Token           | SET-011   | Now       | On `bg0` | On `bg3` | Target |
| --------------- | --------- | --------- | -------- | -------- | ------ |
| `text-dim`      | `#b3b3b3` | `#cfcfcf` | 10.38    | 7.03     | 7:1    |
| `accent`        | `#66b3ff` | `#a7d4ff` | 10.40    | 7.05     | 7:1    |
| `ok`            | `#4cc36a` | `#9bdeac` | 10.35    | 7.01     | 7:1    |
| `warn`          | `#ffc247` | `#ffc652` | 10.36    | 7.02     | 7:1    |
| `err`, `danger` | `#ff8080` | `#ffbfbf` | 10.37    | 7.02     | 7:1    |
| `border`        | `#737373` | `#868686` | 4.44     | 3.01     | 3:1    |

`text` (10.96 on `bg3`) and `offset` (7.35) pass unchanged. The viewport
keeps `#66b3ff` for selection, gizmo, `axis-z` and profile fill, `#ff8080`
and `#4cc36a` for the X and Y axes and cut preview, and `#b3b3b3` for
inactive sketches: each clears 3:1 on `viewport-bg`, and the ruling keeps
the accent. `sketch-dimmed` and the view cube edges follow `border` (3.80 on
`viewport-bg`). The `accent-dim` borders listed above now use `accent`.

BUG-030 fixed three pairs the lighter tokens broke. `.btn.primary:hover`
writes `bg0` on `accent` (10.40, was white at 1.56). `.btn:hover` takes the
`bg2` surface instead of `border` (white at 12.90, was 3.64).
`viewcube-face` returns to `#3d4249`, its value before SET-011, so the cube
reads lighter than `viewport-bg` again (label 10.13).

BUG-034 made the cube paint those values. Its face texture had no colour
space, so three.js lightened it and `#3d4249` showed as `#868b92`; the texture
now sets `SRGBColorSpace`. `viewcube-border` leaves `border` for `#8c8c8c`
(3.01 on `viewcube-face`; `#868686` gave 2.78). `edge` keeps `#30343a`, 6.54
on `body`. No colour reaches 3:1 on both `body` and `viewport-bg` (the best is
2.68), so by Mark's choice `edge` is held to `body` only; it reaches 1.11 on
`viewport-bg`, where the body fill carries the outline (7.24). Lighting
renders the faces from `#66686c` to `#818589`, so edges stay faint on the
shaded side (2.24 to 3.37); that waits on a lighting or edge-style decision.

## Contrast method

Every figure above comes from the WCAG 2.2 relative-luminance formula, rounded
to two places.

```
channel c = byte / 255
linear   = c / 12.92                     if c <= 0.04045
         = ((c + 0.055) / 1.055) ^ 2.4   otherwise
L        = 0.2126 R + 0.7152 G + 0.0722 B
ratio    = (L_lighter + 0.05) / (L_darker + 0.05)
```

Luminance of the proposed values:

| Colour    | L      | Colour    | L      |
| --------- | ------ | --------- | ------ |
| `#000000` | 0.0000 | `#b3b3b3` | 0.4508 |
| `#1a1a1a` | 0.0103 | `#b7bcc1` | 0.4988 |
| `#737373` | 0.1714 | `#4fd1c5` | 0.5129 |
| `#0b3d73` | 0.0465 | `#ffc247` | 0.6030 |
| `#3d0f0f` | 0.0137 | `#ffcc66` | 0.6541 |
| `#30343a` | 0.0339 | `#ffd166` | 0.6782 |
| `#8f7fe8` | 0.2684 | `#ffffff` | 1.0000 |
| `#bb88ff` | 0.3539 | `#66b3ff` | 0.4228 |
| `#4cc36a` | 0.4161 | `#ff8080` | 0.3826 |
| `#999faf` | 0.3466 | `#ff9933` | 0.4428 |

Worked example: `accent` on `raised` is (0.4228 + 0.05) / (0.0103 + 0.05) =
7.84.

SET-011 puts this formula in `client/src/theme/contrast.ts` and tests every
pair with a target above.

## Questions for Mark

1. Approve the black default with `#66b3ff` as the one accent, shared by UI
   and selection? Recommended: yes.
2. Hover turns amber (`#ffd166`) everywhere in the viewport, matching today's
   `MoveGizmo` axis hover. Recommended: yes, since blue hover on blue
   selection measures 1.39 today.
3. Construction planes turn teal (`#4fd1c5`) so they do not read as hover.
   Recommended: yes.
4. Keep today's grey palette as a `classic` theme in CUST? Recommended: only
   if you want it; SET-008 keeps its values recoverable in history either way.
