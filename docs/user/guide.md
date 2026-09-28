# User guide

How to use each feature in the [README](../../README.md) list.

## Sketch

### Sketch tools

The sketcher draws lines, rectangles, centre rectangles, circles, 3-point arcs,
polygons, slots, points and construction geometry.

The constraint solver handles horizontal, vertical, parallel, perpendicular,
tangent, coincident, concentric, equal, midpoint, collinear and fix.
Dimensions are editable: length, distance, radius, diameter and angle. The
sketch shows its degrees of freedom and constrained state live.
Right-click with sketch geometry selected, on it or on empty space, to list the
relations that fit the whole selection; pick one to apply it.

### Sketch offsets

The Offset tool previews the result in yellow. Select a curve, set the
distance, and use Reverse direction to switch sides; positive is left of a line
or outside a circle or arc. Connected lines and rounded arc corners chain
automatically; Ctrl-click picks the chain yourself, in any order.

While editing the sketch, click an offset's **↔ Offset N: d mm** badge to
change its distance. Entity IDs stay the same, so downstream profile references
hold. Offset curves follow their distance and cannot be dragged. Offsets made
before schema 4 are plain geometry; recreate them to get a badge.

### Regions

Closed shapes fill as regions you can hover, pick and extrude. Curves that
cross or touch split the fill: a circle inscribed in a square gives the disc
and four corners, and two overlapping circles give three regions. Pick one
region on its own, or Ctrl-click or Shift-click several; picking all five of the inscribed
square extrudes the whole square. A shape inside another stays a hole.
Construction geometry never splits a region.

### Project, trim and extend

Starting a sketch on a planar body face includes its existing boundary as
linked curves. A line between two boundary points divides the face into two
selectable regions, either of which can be extruded. The boundary follows the
source face; if an edge disappears, the sketch reports a broken reference.
Faces with boundary curves the sketcher cannot project yet report an error;
choose a construction plane or a face with straight or circular edges.

- Project: click an earlier model edge to add a purple linked reference. Snap or
  constrain new shapes to it to follow source edits. References are construction
  geometry by default; toggle Construction on a selected reference to use it in
  a profile.
- Trim (T): hover a curve to highlight the piece between its nearest
  intersections, then click to delete that piece. A line or arc gets shorter
  or splits in two, a circle becomes an arc, and a curve that meets nothing is
  deleted whole. Curves that touch tangentially cut; construction curves never
  do. Each new end gets a coincident constraint on the curve that cut it,
  constraints on the deleted piece go, and constraints on the rest stay. A
  shortened line loses its length, midpoint and equal constraints. Trim stays
  active, and each click is one undo step.
- Extend: click near an endpoint to extend to the first intersecting boundary.
- Offset: see [Sketch offsets](#sketch-offsets).

Project and extend return to Select. Every operation can be undone.
Unsupported projections and collapsing offsets show an error. Trim and extend
report removed curve constraints.

### Editing a sketch

Editing an existing sketch temporarily rolls the viewport and timeline marker
back to that sketch. **Finish Sketch** regenerates the model at the previously
saved timeline position. Entering edit mode does not change the saved marker or
create an undo step.

Opening a sketch from the model tree or timeline faces its plane automatically.
Undo/redo stays inside an existing sketch and returns to Select.
**Extrude** in the sketch toolbar finishes the sketch and opens Extrude. A
selected region fills Profiles; otherwise, pick a profile in the dialog.
If the sketch cannot be saved, it stays open with the error shown.

## Model

### Pick fields

Each input a feature dialog picks, such as Profiles, Body, Split plane or
Target, is a row. One row is active and shows selected; click a row to make it
active. Viewport and tree clicks fill the active row only, with what it takes:
a face click in a body row picks that face's body, and a click on anything the
row does not take changes nothing. The first empty row is active when the
dialog opens, and a row that holds one item hands over to the next empty row
once filled. Rows that need a flat face (Extrude profiles, the Split and
Mirror planes, construction planes and reference image planes) ignore curved
faces and do not highlight them. A selection made before opening fills the
rows by kind. In Extrude, Shift-click picks a face instead of a region.

### Solid features

- Extrude: new body, join, cut or intersect; symmetric or two-sided; from
  sketch profiles _or_ planar faces.
- Revolve, sweep, loft, emboss and deboss.
- Target: join, cut and intersect act on the bodies you choose, from the
  list or by clicking a body with the Target row active. Auto picks
  the bodies the tool meets, again after each edit. Intersect takes one body,
  as does join in older projects; cut and join take several. A chosen body
  stays chosen when upstream features change.
- Sweep paths take lines and arcs drawn in any order. A branched or broken path
  fails with "sweep path is not a connected chain". Choose the path sketch
  from the list, or click any of its curves with the Path sketch row active.

### Modify

Modify covers fillet, chamfer, shell, boolean combine, split body, press/pull
(offset face) and move. Move translates whole bodies along X, Y and Z by typed
values or the arrow gizmo.

Shell removes the faces you click and keeps the given wall thickness. With no
face picked, it hollows the closed body into a sealed cavity. A face a fillet
runs into opens with the fillet's wall ending square at the opening. When a
rounded face cannot open, the error names its fillet or chamfer.

Fillet and Chamfer default to **Select tangent chain**. Clicking an edge
selects smooth connected edges (including line/arc joins); sharp corners and
ambiguous branches stop the chain. Clicking a fully selected chain deselects it.
Uncheck the option to pick edges individually. OCCT may still propagate a fillet
or chamfer along a smooth contour as required by its native operation.

### Replicate and construction

- Replicate: mirror, rectangular pattern and circular pattern.
- Construction: offset planes and midplanes; sketch on any planar face.
- Origin axes: the model tree's Origin section lists X Axis, Y Axis and Z Axis
  under the planes. In Revolve and Circular Pattern, with the Axis row
  active, clicking an axis row or the axis line drawn at the origin sets the
  axis, as choosing it in the Axis list does; in Rectangular Pattern the
  Direction edge row takes it as the direction. Hiding the origin
  hides the axis lines too, and they cannot be picked while hidden.
- Axis and direction rows hold one straight line. A new pick replaces the
  old one, a circular edge or arc is refused, and choosing another entry in
  the list drops the earlier pick. With Selected line/edge and nothing picked,
  the row reads Pick an axis (Pick a direction in Rectangular Pattern) and OK
  stays disabled.

### Drag handles

A feature dialog with a main value shows a handle in the viewport. Dragging it
changes the dialog field as typing would: the readout follows the pointer, the
model previews when you pause, and OK adds one undo step.

- Extrude distance, press/pull distance and shell thickness: an arrow on the
  picked profile or face along its normal. The shell arrow points into the body.
- Fillet radius and chamfer distance: an arrow at the middle of the first picked
  edge, halfway between its two faces.
- Emboss depth: an arrow from the picked region along the sketch normal, into
  the body for deboss.
- Construction plane offset: an arrow from the base plane along its normal.
- Rectangular pattern spacing: an arrow from the body along the direction,
  ending at the first copy.
- Revolve angle and circular pattern total angle: a ring about the axis with a
  round grip.
- Move: one arrow per axis.

Handles snap to steps that get finer as you zoom in. Holding Ctrl while
dragging the extrude arrow collapses it to zero. Sweep, loft, combine, mirror,
split, reference images and STEP import have no handle.

### Reference images

Attach PNG, JPEG or WebP canvases to planes, up to 25 MB each, and calibrate
them to real dimensions with two points.

### Feature timeline

Rename, edit, suppress, delete and roll back features, or insert features
mid-history. Click a chip to select the bodies its feature made or changed,
and Ctrl or Cmd+click to add them; a sketch, plane, suppressed or rolled-back
feature selects nothing. With a feature dialog open, a chip click fills the
active row with those bodies, as clicking each body would. Double-click a
chip to edit its feature. Right-click a chip and choose Quick edit to change
its main value, such as an extrude distance or fillet radius, in a small box
above the chip. The model previews as you type; Enter keeps the change as one undo step
and Escape or clicking away reverts it. Rest the pointer on a chip for 0.3
seconds to see the model as it was right after that feature; moving away
returns to the current model, and nothing is saved or added to undo. Broken
references are flagged, never silently dropped: the chip's tooltip lists each
one. Edit the feature to see them under References. Point at a proposed face
or edge to highlight it, then click Accept to use it as one undo step. An
ambiguous or missing reference lists its candidates, and matches on other
bodies, each with Accept. Or click Pick, then click the face or edge in the
viewport.

A project made before naming version 2 shows Naming, version 1, in each
feature's dialog. Right-click any timeline chip and choose Upgrade naming… to
open the same section on its own. Upgrade naming backs up the project and
lists every body, face and edge reference with its new name: proven,
candidate, ambiguous or missing. Accept one choice for each candidate and
ambiguous reference, then Apply upgrade saves the project on version 2 as one
undo step. A missing reference stays broken until you repair it. Undo returns
to version 1.
[FEATURE_TIMELINE.md](../../FEATURE_TIMELINE.md) covers the semantics.

## Inspect

Measure between points, edges and faces: distance, ΔXYZ, angle, radius, area
and length. Press I to start.

## Files

### STEP import

Start a project with **New project from STEP**, or use **Insert → Import STEP**
in an existing project. It accepts STEP (`.step`/`.stp`), IGES (`.igs`/`.iges`)
and BREP (`.brep`) files up to 10 MB containing solid bodies. Imported solids
support further modelling; the source application's sketches and feature
history are not imported.

It also accepts STL (`.stl`, binary or ASCII), OBJ (`.obj`) and 3MF (`.3mf`)
meshes of up to 200,000 triangles. Each triangle becomes a flat face and each
3MF object its own body. A closed mesh becomes a solid; an open one becomes a
shell with a warning on its timeline chip. Meshes are not parametric.

### Export

Export writes binary STL or multi-body 3MF, with bodies preserved as named
objects, and a tessellation quality control.

### Persistence

Projects use a human-inspectable JSON format that stores the full parametric
history, never just the final mesh. The schema is versioned with migrations.
Every change saves automatically, and projects survive container recreation.

## Workspace

### Viewport controls

| Action                             | Input                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Select                             | Left click (Ctrl adds; Alt+click cycles overlapping picks)                              |
| Context menu                       | Right click on geometry                                                                 |
| Orbit                              | Right-drag or Shift+middle-drag, about the point under the cursor; or drag the ViewCube |
| Pan                                | Middle-drag, or two-finger scroll on a trackpad                                         |
| Zoom                               | Scroll wheel or trackpad pinch, to the cursor                                           |
| Named views / fit / ortho or persp | Toolbar (right side) and ViewCube                                                       |

Each project reopens at your own last camera, saved a second after it stops
moving. A project you have not moved opens zoomed to fit.

### Shortcuts

| Keys            | Action                                                    |
| --------------- | --------------------------------------------------------- |
| S, E, F, M      | Sketch, extrude, fillet, move                             |
| I               | Measure (inspect)                                         |
| Shift+F         | Fit the model in view                                     |
| ?               | Controls list, also on the Controls button                |
| Ctrl+Z / Ctrl+Y | Undo / redo                                               |
| V/L/R/C/D/P     | Sketch tools, in a sketch                                 |
| X               | Toggle construction, in a sketch                          |
| Delete          | Remove the selection, in a sketch                         |
| Enter           | Confirm a tool panel from one of its fields               |
| Escape          | Cancel a tool panel; a feature dialog reverts its preview |

### Undo and redo

Undo/redo is application-level and separate from the CAD timeline. Hiding
or showing something is not an undo step. The Undo and Redo tooltips name the
step each would reverse or restore.

**History** in the top bar opens a panel listing the last 50 edits, oldest
first, with their time; the current state is marked and undone edits are
dimmed. Name the current state under Checkpoint name and Save checkpoint to
keep it through any number of later edits. Restore on an edit or checkpoint
asks first, then saves that state as a new step that Undo reverses. A
view-only member sees the list without Save or Restore.

### Panels and errors

Tool panels keep their action buttons within the window; the arrow in the title
bar restores their docked position. A feature dialog or the sketch offset
panel opens with its main number selected, so typing replaces it; picks in the
viewport still work while it has focus. Enter in a panel field presses its
confirm button and Escape inside a panel presses Cancel. Escape from anywhere
cancels an open feature dialog, reverts its live preview and clears the
selection.

While a feature dialog is open, new or edit, the model shows as it was before
that feature, so its picks stay highlighted and you can click any original edge
or face, including one the feature consumed. The dialog previews its result
30 ms after your last change as a see-through ghost of only the faces it
adds, and a new body whole: green when the feature adds material, red when it
removes material (cut, intersect, deboss, shell, fillet, chamfer, a negative
face offset). An edit that adds no face ghosts the faces that moved. The ghost
shows the model right after the feature, so later features never appear in it.
The ghost cannot be picked. OK keeps the previewed feature as one undo step and
shows the result; Cancel, Escape or closing the dialog returns to the saved
model.

A feature dialog lists its picks under each selection box, one row per edge,
face, body, profile, plane or sketch line, such as `Edge 3, Body 1`. Hover a row
to light that pick in the viewport, press its remove button to drop it, or
press Clear to drop the whole list. Editing a feature fills the list with the picks it was
built from. Edge, face and profile numbers count from 1 in the order the model
reports them, so they can change when the body is rebuilt.

Errors remain visible until dismissed or the next operation starts, and their
text can be selected and copied.

### Version label

The bottom-right corner of the project list and the workspace shows the running
build. Hover it for the full commit, version and schema. The README's
[Running build](../../README.md#running-build) section explains the label.
