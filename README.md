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

[Guide](docs/user/guide.md#sketch)

- **Sketcher**: draw lines, rectangles, circles, arcs, polygons, slots, points and construction geometry.
- **Relations**: horizontal, vertical, coincident, parallel, perpendicular, tangent, equal, concentric, midpoint, collinear and fix; right-click adds symmetric and smooth.
- **Constraints and dimensions**: editable or driven dimensions, remaining degrees of freedom, refused over-constraints; unsettled sketches warn before the next edit.
- **Dimension kinds**: point to line, parallel lines, line to line or axis angles; right-click a dimension for horizontal, vertical or radius.
- **Line angles**: a typed angle is kept; double-click a line to edit its length and angle.
- **Regions**: crossing curves and linked planar face boundaries split sketches into selectable regions.
- **Project, trim and extend**: link edges, faces, body outlines and earlier sketch curves, trim pieces by click or drag (T), extend curves to boundaries.
- **Sections**: Project's Face sections and Body sections draw where the picked faces or bodies cross the sketch plane.
- **Offsets**: offset a curve or chain, then change its distance later from the badge in the sketch.
- **Move and copy**: move, rotate, mirror or pattern selected sketch geometry with its constraints; links outside the selection are counted and removed.
- **Angle snap**: hold Shift to snap a line to 15 degree steps or your own step and angles; A locks its angle.
- **Insert DXF and SVG**: bring DXF lines, arcs, circles, ellipses, splines and points, or SVG paths and shapes, into the sketch as editable geometry.
- **Ellipses**: draw or import from DXF, including elliptical arcs; constrain tangent lines, project tilted circles, extrude exactly.
- **Splines**: sketch keys N, B and K draw fit-point, control-point and conic splines; smooth or tangent joins, exact extrudes.
- **Edit in place**: history rolls back while editing; Finish Sketch restores it, or Extrude opens with the selected region.

### Model

[Guide](docs/user/guide.md#model)

- **Solid features**: extrude, revolve, sweep, loft, emboss and deboss from sketch profiles; extrude, revolve and ordered loft sections also take planar faces.
- **Extrude direction**: one side, reversed, symmetric or two sided, with a taper angle for each side.
- **Extrude extents**: start at the profile plane, an offset or an object; end at a distance, To object or All.
- **Thin extrude**: walls inside, outside or centred on a profile, or along open sketch curves.
- **Tool targets**: join, cut and intersect act on bodies you pick from the list or by click; Auto takes visible ones.
- **Modify**: rule, variable and multi-radius fillets, chamfers (equal, two distances or distance and angle), shell, combine, split and press/pull bodies.
- **Tangent chains**: fillet and chamfer take edges, faces or features and follow smooth connected edges, on one or several bodies.
- **Size hints**: fillet, chamfer, shell, inward Offset Face, cut depth and pattern spacing show the size that builds for your picks.
- **Move**: translate bodies, turn them about an axis, edge or sketch line, or add the moved copy as a new body.
- **Replicate**: mirror, rectangular pattern and circular pattern.
- **Construction**: offset, midplane, angled, three-point or two-edge planes, with flip; sketch on planar faces copying their exact boundary; hide planes.
- **Origin axes**: pick X, Y or Z in the model tree or at the origin as a revolve or pattern axis.
- **Parameters**: name values with units, then type expressions like `width / 2` into feature fields, sketch dimensions and Quick Edit.
- **Feature timeline**: wheel scrolling; keyboard chip selection/actions; rename, edit, quick edit, preview, suppress, delete, rollback, insert; broken references flagged.
- **Drag handles**: every feature with a main value, from extrude distance to pattern spacing, has an arrow or arc to drag.
- **Reference images**: place PNG, JPEG or WebP images on planes and calibrate them to real size.
- **Body colours**: right-click a body in the model tree to pick its colour or reset it; theme changes keep chosen colours.
- **Job progress**: long model changes show Working, feature counts when available, and Cancel in the viewport.
- **Crash recovery**: a crashed kernel flags the running feature and blocks dependent geometry and exports until that feature is edited.
- **Reference repair**: accept proposed faces and edges, including sketch projections and image planes, or re-pick broken feature references without closing the edit.
- **Naming upgrade**: from a version 1 project's timeline menu or dialog, review mappings, hover or pick uncertain candidates, apply, and undo.

### CAM

- **Manufacture workbench**: pick Manufacture in the toolbar's Workbench menu for setups, operations, toolpaths and NC programs.
- **Setups**: choose bodies, material, machine, post, safe height, clearance and tolerance; Settings, CAM holds the defaults.
- **Stock and zero**: a box around the bodies with six margins, a box or a cylinder; zero at a corner, G54 to G59.
- **Operations**: Contour inside or outside a face, Pocket to a floor with a ramp angle, Laser along, inside or outside.
- **Manufacture browser**: setups and operations show status and cycle time; right-click to generate, generate all stale, reorder or suppress.
- **Toolpath preview**: click a setup or operation to draw its moves by type; a slider steps through them.
- **Simulation**: Simulate cuts the stock as a heightmap and reports each gouge below the part top with its depth.
- **NC export**: NC Program posts the chosen setups; one file downloads as `.nc`, several as a zip.
- **Posts**: FluidNC, GRBL 1.1, grblHAL, LinuxCNC, Mach3 and Mach4, and Marlin ship; machines choose millimetre or inch output.
- **Your own posts**: import a JSON post in Settings, CAM, Posts, make it a machine's default, or delete it.
- **AI post kit**: Download post kit saves a prompt that helps an AI assistant turn your old post into a Rockett post.
- **Machines**: mill or laser profiles with firmware, travel, spindle rpm and power, acceleration and rigidity; paste GRBL `$$` to fill.
- **Tools**: flat, ball and bull nose end mills, V-bits, drills and chamfer mills; import and export `rockett-tools.json`.
- **Feed presets and Suggest**: Suggest fills presets from six materials by chipload, scaled by machine rigidity; operations re-suggest for the setup's machine.
- **CAM example**: [examples/cam-plate.rockett](examples/cam-plate.rockett) opens a plate ready to generate; the [guide](docs/user/guide.md#cam) walks a first CNC program.

### Inspect

[Guide](docs/user/guide.md#inspect)

- **Measure**: distance, ΔXYZ, angle, radius, area and length between points, edges and faces; changing picks or closing Measure discards stale results.
- **Pick readout**: the bottom-left corner names the hovered item and picks, then shows length, size, area, volume, distance and angle.

### Files

[Guide](docs/user/guide.md#files)

- **Import**: start or extend projects from STEP (body names, assembly tree), IGES, BREP, STL, OBJ or 3MF. Meshes are not parametric.
- **Export**: download binary STL, multi-body 3MF, coloured GLB, named STEP solids, or a sketch or planar face as DXF.
- **Autosave**: every change saves to a readable JSON file that keeps the full feature history.
- **Project files**: the list and File menu download one `.rockett` file; opening one makes a new project, keeping what it hides.
- **Edit conflicts**: a clashing or unsent change waits for reapply or discard, which clears undo; cancel reverts saved previews.

### Workspace

[Guide](docs/user/guide.md#workspace)

- **Projects**: organise, create, move, share or delete projects and folders; refuse stale deletes; sort, filter, pick destinations by keyboard.
- **Sharing**: share a project or folder for View or Edit with your friends; an admin can share with anyone.
- **This browser**: one list per signed-in user; create, open, or move projects in and out; Share moves them to the server first.
- **Project snapshots**: hover or focus a project to see a picture of its model and when it was last edited.
- **Reload**: refreshing the page reopens the project you had open; Back returns to the list.
- **Accounts**: admin setup and Users page, username or email sign-in, TOTP, password changes, common-password refusal, sign out, Cloudflare Access.
- **Sessions**: choose how many days you stay signed in, up to the longest an admin allows.
- **Friend requests and notices**: accept or reject friend requests and open newly shared projects from the user menu; sending requests is API only.
- **Settings**: the panel edits and resets App, User and Project settings; Export and Import carry yours, keeping unknown plugin values.
- **Theme**: pick grey or black and an accent colour in Settings; the app and viewport recolour at once.
- **Display units**: sketch dimensions, measurements and feature lengths follow the selected unit; typed lengths accept unit suffixes while models remain in millimetres.
- **Viewport**: orbit, pan, zoom to cursor, named views, fit, ViewCube, camera preferences, pick tolerance; projects reopen at your last camera.
- **Toolbar**: wheel scrolling in design and sketch; tools show icons above labels, constraints only icons; tooltips show shortcuts.
- **Shortcuts**: single keys start tools; ? lists every keyboard and mouse control in a resizable panel that fills the window.
- **Right-click menus**: project rows, tree items, timeline chips and the viewport offer their actions, sketch selections their relations; right-drag still orbits.
- **Undo and redo**: undo any edit, even in a sketch, separately from the timeline; an unchanged OK adds nothing; tooltips name the step.
- **History**: lists edits and checkpoints with who made them; restore one after a confirm, then undo it; right-click deletes a checkpoint.
- **Tool panels**: open with the main number selected and list each pick to remove; Enter confirms, Escape reverts.
- **Pick fields**: clicks fill the active row, Shift+click adds a tree range; single picks advance to missing inputs, then multiple picks.
- **Tree selection**: Ctrl or Cmd+click adds bodies or sketches, Shift+click selects a range; right-click acts on all.
- **Box select**: drag from empty space; left to right takes what lies inside, right to left what the box touches.
- **Groups**: gather selected bodies or sketches into named, collapsible tree folders with Ctrl+G or right-click.
- **Live preview**: dialogs keep the prior model pickable and ghost only the result, green added, red removed, with adjustable tint and opacity.
- **Model tree width**: drag or arrow-key the tree's right edge, double-click to reset; the width follows you to every machine.
- **Panel positions**: drag a tool panel by its title, double-click the title to reset it; each position follows you.
- **Errors**: stay visible until dismissed, and their text can be copied.
- **Version label**: the bottom-right corner shows the running build; hover for commit, version and schema.

### Modules and plugins

- **First-party modules**: CAM and Measure ship as modules on the plugin API, version 0.23.0.
- **KiCad upload API**: save KiCad 9 or later board bytes and parsed snapshots with a project, including portable `.rockett` files.
- **KiCad board update API**: re-upload a board to its link and get added, removed, moved and changed footprints.
- **KiCad 3D models API**: upload the STEP models footprints name, list missing ones, and place them on the board.
- **Board outline DXF API**: get a sketch or planar face outline as DXF on layer `Edge.Cuts` for KiCad's graphics import.
- **Board nets API**: list a saved KiCad board's nets with each footprint pad, through the electrical module.
- **Connector pin table**: right-click a KiCad board face to download each connector pin's net and position as CSV.
- **Nets and connectors panel**: right-click a KiCad board face to search nets and connectors and highlight a net's pads.
- **Module switches**: in a module's Settings section, an admin turns it off from the next restart, and each user can hide it.
- **Plugin API**: modules add commands, toolbars, panels, workbenches, layers, settings, menus, kernel jobs, portable project assets, project services and pick modes.
- **Module inputs**: changing a committed module source refreshes geometry and CAM; undo restores the previous source.
- **REST API**: a signed-in session can script projects, features, history, settings, import and export over JSON; see [API.md](API.md).

## Roadmap

Ticked items ship today. Unticked items are planned, in no promised order and
with no dates.

### Sketch

- [x] Lines, arcs, circles, polygons, slots, ellipses and splines
- [x] Relations and dimensions, driven dimensions and over-constraint refusal
- [x] Offset, move, copy, mirror and pattern sketch geometry
- [x] Project edges, faces, bodies and sections at the sketch plane
- [x] Trim and extend
- [x] DXF and SVG import
- [x] Regions from crossing curves and face boundaries
- [ ] Toolbar buttons for the spline and conic tools
- [ ] More ways to draw, such as three-point rectangles and two-point circles
- [ ] Sketch fillet, chamfer, break and scale
- [ ] Sketch text, also along a curve
- [ ] Sketch palette: look at the plane, slice the model, display toggles

### Model

- [x] Extrude, revolve, sweep, loft, emboss and deboss
- [x] Extrude start, extent, direction, taper and thin walls
- [x] Fillet, chamfer, shell, combine, split and press/pull
- [x] Mirror, patterns, construction planes and origin axes
- [x] Named parameters and expressions
- [x] Editable feature timeline with rollback, suppress and reference repair
- [x] Reference images
- [ ] Revolve to a face, on two sides or symmetric
- [ ] Sweep and loft with rails, twist, taper and end conditions
- [ ] Holes and threads, including counterbored, countersunk and tapped
- [ ] Primitives, coils and pipes
- [ ] Rib, web, draft, scale, thicken and boundary fill
- [ ] More pattern, fillet, chamfer, combine, split and move options
- [ ] Emboss onto curved faces; Press/Pull and Offset Face on curved faces
- [ ] Construction axes and points, and more ways to place planes
- [ ] Reorder and group features in the timeline
- [ ] Expressions with functions in every number field
- [ ] Auto targets for join, cut and intersect that follow body changes

### Drawings and sheet metal

- [ ] Drawings with base and projected views
- [ ] Dimensions, callouts and centre marks on drawings
- [ ] Sheet metal bodies with flanges and bend rules
- [ ] Unfold, refold and flat patterns

### Inspect

- [x] Measure distance, angle, radius, area and length
- [x] Live readout of size, area, volume, distance and angle for picks
- [ ] Physical properties and an interference check
- [ ] Materials, appearances and decals per body
- [ ] Zebra, curvature and draft analysis
- [ ] Section views and display modes
- [ ] Recompute everything and see each feature's time

### Files

- [x] Import STEP, IGES, BREP, STL, OBJ and 3MF
- [x] Export STL, 3MF, GLB, STEP and DXF
- [x] Autosave with the full feature history
- [x] Download and open single-file projects
- [ ] Export OBJ and IGES
- [ ] Repair, reduce, remesh and convert imported meshes
- [ ] Keep projects on a mounted network share

### CAM

- [x] Manufacture workbench with setups, stock and work zero
- [x] Machine, post and tool libraries in Settings
- [x] Feed presets and Suggest, scaled by machine rigidity
- [x] Re-suggest feeds and speeds for the machine a setup uses
- [x] Beginner CAM guide and an example project ready to generate
- [x] Contour, pocket and laser operations
- [x] Toolpath preview and heightmap simulation with gouge checks
- [x] NC export through six shipped posts or your own
- [x] AI post kit for converting an existing post
- [x] Generate explains why it refuses
- [ ] Facing, drilling, adaptive, parallel, waterline and rest operations
- [ ] An operation planner that proposes operations in order
- [ ] Hold-downs placed in the setup and kept clear
- [ ] Flip setups onto dowel pins
- [ ] A step checklist for each setup
- [ ] Shorter, safer links between cuts
- [ ] Vectric tool database import
- [ ] A GRBL 1.1 post proved by an air cut

### Assemblies

- [ ] Assemblies that place parts as instances
- [ ] Move instances with a gizmo
- [ ] Rigid, revolute and slider joints with limits
- [ ] Parts update inside their assemblies, with an updated badge
- [ ] Subassemblies
- [ ] Bill of materials with CSV export
- [ ] Interference check between parts
- [ ] Measure across instances
- [ ] STEP assemblies open as assemblies
- [ ] Thousands of instances that stay fast

### PCB and electrical

- [ ] Upload a KiCad board and get it as a 3D board
- [ ] Board components with their 3D models, embedded ones included
- [ ] Board updates that show what changed before you apply them
- [ ] Clearance check between a board and its enclosure
- [ ] Board outline export as DXF for KiCad
- [ ] Boards linked from a read-only shared folder
- [ ] Nets and connectors on the 3D model, with search and highlight
- [ ] Connector pin tables as CSV

### Additive

- [ ] Printer profiles with bed size and nozzle
- [ ] Place a part on the bed by one of its faces
- [ ] Build volume fit check
- [ ] Download a 3MF placed for your slicer

### Workspace

- [x] Accounts with TOTP and Cloudflare Access sign-in
- [x] Projects and folders, shared for view or edit
- [x] Projects kept in this browser or on the server
- [x] Settings that follow you: theme, units, camera and panels
- [x] Undo, redo and restorable history checkpoints
- [x] Keyboard shortcuts and right-click menus
- [ ] Customise the toolbar and timeline: reorder, hide, pin, icons or labels
- [ ] Dockable panels with a saved layout per workbench
- [ ] Rebind keyboard shortcuts in Settings
- [ ] Selection filters for bodies, faces, edges and more
- [ ] A marking menu and a searchable command box
- [x] Browser projects that follow the signed-in user

### Kernel and performance

- [ ] Cuts that cross a fillet corner where they fail today
- [ ] Fillets where a line meets a tangent arc
- [ ] Fillet radii set at points along an edge
- [ ] Cuts through million-triangle meshes
- [ ] Fast reopening after a restart, from saved shapes
- [ ] Idle kernel memory freed during long sessions

### Modules and plugins

- [x] Plugin API for commands, toolbars, panels, settings pages and kernel jobs
- [x] CAM as the first shipped module
- [x] Admin switch and per-user hide for each module
- [x] REST API for scripting projects
- [ ] Third-party plugins installed from a folder and enabled by an admin
- [ ] A Modules page with versions, licences and status
- [ ] Projects that keep features from a missing module
- [ ] Module data that migrates between versions
- [ ] A plugin author guide

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
returns the same fields to a signed-in session. A plain `docker compose up`
bakes in no commit, so the label reads `v<version> dev`.
[DOCKER.md](DOCKER.md) shows the build arguments that name the commit.

## Development

```bash
npm ci                 # .npmrc: install scripts off, exact pins on save
npm run prepare        # once per clone: husky sets core.hooksPath to .husky/_
export ROCKETT_ALLOWED_ORIGINS=http://localhost:5173
npm run dev            # server on :8788 + Vite client on :5173
npm test               # typecheck, then the node and DOM test projects
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
