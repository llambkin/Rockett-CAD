# Rockett CAD

Self-hosted, browser-based **parametric CAD** with a B-Rep kernel and a feature
timeline. The aim is Fusion features for design and manufacture workspaces: CNC
toolpaths, PCB and electrical plugins, from the model to a finished part.
Additive work is STL and 3MF export today, and can become a plugin later.

> **Sketch → constrain → feature → body → timeline → modify → regenerate → export**

Built on a real B-Rep solid-modelling kernel (OpenCascade / OCCT compiled to
WebAssembly), not a mesh editor. Every operation is an editable parametric
feature in a chronological timeline; editing an earlier feature rebuilds
everything downstream against persistent topology references.

![stack](https://img.shields.io/badge/kernel-OpenCascade%208.0.1-blue)

## Features

### Sketch

- **Sketcher**: draw lines, rectangles, circles, arcs, polygons, slots, points and construction geometry.
- **Constraints and dimensions**: editable or driven dimensions, remaining degrees of freedom, refused over-constraints; unsettled sketches warn before the next edit.
- **Dimension kinds**: point to line, parallel lines, line to line or axis angles; right-click a dimension for horizontal, vertical or radius.
- **Line angles**: a typed angle is kept; double-click a line to edit its length and angle.
- **Regions**: crossing curves and linked planar face boundaries split sketches into selectable regions.
- **Angle snap**: hold Shift to snap a line to 15 degree steps or your own step and angles; A locks its angle.
- **Offsets**: offset a curve or chain, then change its distance later from the badge in the sketch.
- **Project, trim and extend**: link model edges into a sketch, trim curve pieces by click or drag (T), extend curves to boundaries.
- **Insert DXF and SVG**: bring DXF lines, arcs, circles and points, or SVG paths and shapes, into the open sketch as editable geometry.
- **Edit in place**: history rolls back while editing; Finish Sketch restores it, or Extrude opens with the selected region.

### Model

- **Solid features**: extrude, revolve, sweep, loft, emboss and deboss from sketch profiles; extrude, revolve and ordered loft sections also take planar faces.
- **Tool targets**: join, cut and intersect act on bodies you pick from the list or by click; Auto takes visible ones.
- **Modify**: fillet, chamfer, shell, combine, split, press/pull and move bodies; shell with no open face hollows the body.
- **Tangent chains**: fillet and chamfer pick smooth connected edges in one click, on one or several bodies.
- **Size hints**: fillet, chamfer and shell show the largest size that builds for the current picks.
- **Replicate**: mirror, rectangular pattern and circular pattern.
- **Construction**: offset, midplane, angled, three-point or two-edge planes, with flip; sketch on planar faces; hide planes without breaking sketches.
- **Origin axes**: pick X, Y or Z in the model tree or at the origin as a revolve or pattern axis.
- **Drag handles**: every feature with a main value, from extrude distance to pattern spacing, has an arrow or arc to drag.
- **Reference images**: place PNG, JPEG or WebP images on planes and calibrate them to real size.
- **Feature timeline**: wheel scrolling; keyboard chip selection/actions; rename, edit, quick edit, preview, suppress, delete, rollback, insert; broken references flagged.
- **Job progress**: long model changes show Working, feature counts when available, and Cancel in the viewport.
- **Crash recovery**: a crashed kernel flags the running feature and blocks dependent geometry and exports until that feature is edited.
- **Reference repair**: accept proposed faces and edges, including sketch projections and image planes, or re-pick broken feature references without closing the edit.
- **Naming upgrade**: from a version 1 project's timeline menu or feature dialog, review every reference mapping, choose uncertain ones, apply, and undo.

### Inspect

- **Measure**: distance, ΔXYZ, angle, radius, area and length between points, edges and faces.

### Files

- **Import**: start or extend a project from a STEP, IGES, BREP, STL, OBJ or 3MF file. Meshes are not parametric.
- **Export**: download binary STL, multi-body 3MF or STEP solids with named bodies; meshes take a quality setting.
- **Autosave**: every change saves to a readable JSON file that keeps the full feature history.
- **Edit conflicts**: a clashing or unsent change waits for reapply or discard, which clears undo; cancel reverts saved previews.

### Workspace

- **Accounts**: admin setup, username or email sign-in, TOTP, password changes, common-password refusal, sign out, user emails and Cloudflare Access.
- **Settings**: the panel edits and resets app, personal and project preferences; Export and Import carry personal settings, keeping unknown plugin values.
- **Theme**: pick grey or black and an accent colour in Settings; the app and viewport recolour at once.
- **Display units**: sketch dimensions, measurements and feature lengths follow the selected unit; typed lengths accept unit suffixes while models remain in millimetres.
- **Friend requests and notices**: request by email, accept or reject in the user menu, and open newly shared projects.
- **Model tree width**: drag or arrow-key the tree's right edge, double-click to reset; the width follows you to every machine.
- **Viewport**: orbit, pan, zoom to cursor, named views, fit, ViewCube, camera preferences, pick tolerance; projects reopen at your last camera.
- **Toolbar**: wheel scrolling in design and sketch; tools show icons above labels, constraints only icons; tooltips show shortcuts.
- **Shortcuts**: single keys start tools; ? lists every keyboard and mouse control in a resizable panel that fills the window.
- **Undo and redo**: undo any edit, even in a sketch, separately from the timeline; an unchanged OK adds nothing; tooltips name the step.
- **History**: the History button lists edits and checkpoints with who made them; restore one after a confirm, then undo it.
- **Tool panels**: open with the main number selected and list each pick to remove; Enter confirms, Escape reverts.
- **Pick fields**: clicks fill the active row; completed single picks advance to missing inputs, then back to multiple picks.
- **Groups**: gather selected bodies or sketches into named, collapsible tree folders with Ctrl+G or right-click.
- **Tree selection**: Ctrl or Cmd+click adds bodies or sketches, Shift+click selects a range; right-click acts on all.
- **Live preview**: dialogs keep the prior model pickable and ghost only the result, green added, red removed, with adjustable tint and opacity.
- **Right-click menus**: project rows, tree items, timeline chips and the viewport offer their actions, sketch selections their relations; right-drag still orbits.
- **Projects**: organise, create, move, share or delete projects and folders; refuse stale deletes; sort, filter, pick destinations by keyboard.
- **Project snapshots**: hover or focus a project to see a picture of its model and when it was last edited.
- **Project files**: download a project as one `.rockett` file, or open one as a new project, keeping what it hides.
- **This browser**: keep projects locally; Move to transfers either way, while Share moves to the server first.
- **Reload**: refreshing the page reopens the project you had open; Back returns to the list.
- **Errors**: stay visible until dismissed, and their text can be copied.
- **Version label**: the bottom-right corner shows the running build; hover for commit, version and schema.
- **Pick readout**: the viewport's bottom-left corner names the hovered item and lists each selection in pick order.

[docs/user/guide.md](docs/user/guide.md) explains how to use each one.

## Quick start (Docker)

```bash
ROCKETT_ALLOWED_ORIGINS=http://localhost:8788 docker compose up -d
```

Open http://localhost:8788. The server refuses to start without
`ROCKETT_ALLOWED_ORIGINS`: list the origin you browse to. State lives in the
`rockett-cad_data` volume. [DOCKER.md](DOCKER.md) covers LAN access, dev and
prod instances, promotion, Unraid and backups.

## Running build

The bottom-right corner shows the running build, and `GET /api/health`
returns the same fields. A plain `docker compose up` bakes in no commit, so
the label reads `v<version> dev`. [DOCKER.md](DOCKER.md) shows the build
arguments that name the commit.

## Development

```bash
npm ci                 # .npmrc: install scripts off, exact pins on save
npm run prepare        # once per clone: husky sets core.hooksPath to .husky/_
export ROCKETT_ALLOWED_ORIGINS=http://localhost:5173
npm run dev            # server on :8788 + Vite client on :5173
npm test               # typecheck, then shared, server and client tests
npm run lint           # oxlint
npm run format:check   # Prettier
npm run lint:readme    # README features within 20 words; docs cite tracked paths
npm run lint:comments  # comment ratchet: no file may gain a comment
npm run lint:writing   # writing lint over tracked markdown
```

The last two need masterrulez cloned to `~/masterrulez`. See
[DEVELOPMENT.md](DEVELOPMENT.md).

## Documentation

| Doc                                        | Contents                                                          |
| ------------------------------------------ | ----------------------------------------------------------------- |
| [docs/user/guide.md](docs/user/guide.md)   | How to use each feature, controls and shortcuts                   |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | System overview, layers, technology choices                       |
| [CAD_MODEL.md](CAD_MODEL.md)               | B-Rep representation, topology naming, regeneration, tessellation |
| [FEATURE_TIMELINE.md](FEATURE_TIMELINE.md) | Timeline semantics, rollback, dependency handling                 |
| [API.md](API.md)                           | REST API reference                                                |
| [DOCKER.md](DOCKER.md)                     | Deployment (Docker / Compose / Unraid)                            |
| [DEVELOPMENT.md](DEVELOPMENT.md)           | Repo layout, workflows, testing                                   |
| [CHANGELOG.md](CHANGELOG.md)               | Changes per release, release and schema conventions               |

## License note

Rockett CAD bundles opencascade.js from the fork at
[msegec/opencascade.js](https://github.com/msegec/opencascade.js)
(LGPL-2.1-only), the WASM build of Open CASCADE Technology 8.0.1.
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) lists every third-party
package in the image and the client bundle, with its version, licence and the
obligations to meet before distribution.
