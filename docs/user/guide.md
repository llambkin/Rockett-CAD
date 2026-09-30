# User guide

How to use each feature in the [README](../../README.md) list.

## Sketch

### Sketch tools

The sketcher draws lines, rectangles, centre rectangles, circles, 3-point arcs,
polygons, slots, points and construction geometry.

A polygon stays regular: it gets a centre point and a construction circle,
with equal sides. Inscribed puts the vertices on the circle; Circumscribed puts
the flats on it, so the circle's diameter is the size across flats. A typed
Angle holds the first vertex at that angle from sketch X. With Angle empty the
first vertex follows the cursor, and Shift snaps it to the angle step.

Constraints: horizontal, vertical, parallel, perpendicular, tangent,
coincident, concentric, equal, midpoint, collinear and fix. Dimensions:
length, distance, radius, diameter and angle, all editable. The sketch shows
its degrees of freedom live. Right-click with sketch geometry selected to list
the relations that fit the whole selection. Deleting a dimension, relation or
trimmed piece moves no other point.

A constraint or dimension that would over-constrain the sketch is refused with
a message naming it. For a dimension you may keep it as a driven dimension
instead: it drives nothing and shows its measured value in parentheses, dimmed,
such as `(102 mm)`. Typing a value into a driven dimension makes it drive
again, unless that would over-constrain the sketch.

### Sketch offsets

The Offset tool previews the result in yellow. Select a curve, set the
distance, and use Reverse direction to switch sides; positive is left of a line
or outside a circle or arc. Connected lines and rounded corners chain
automatically; Ctrl-click picks the chain yourself.

While editing the sketch, click an offset's **↔ Offset N: d mm** badge to
change its distance. Offset curves follow their distance and cannot be
dragged. Offsets made in older projects are plain geometry; recreate them to
get a badge.

### Regions

Closed shapes fill as regions you can hover, pick and extrude. Curves that
cross or touch split the fill: a circle in a square gives the disc and four
corners. Ctrl-click or Shift-click picks several. A shape inside another
stays a hole. Construction geometry never splits a region.

### Project, trim and extend

A sketch on a planar body face starts with the face's boundary as linked
curves. A line across the face splits it into two regions. If a source edge
disappears, the sketch reports a broken reference.

- Project: click a model edge to add a purple linked reference. It is
  construction geometry by default; toggle Construction to use it in a
  profile.
- Trim (T): hover a curve to highlight the piece between its nearest
  crossings, T-junctions or sketch points on it, then click to delete it.
  Hold the button and drag to highlight every piece the path crosses;
  releasing deletes them all. A curve with none is deleted whole.
  Construction curves cut too. A curve lying on top of another does not cut
  it. Trim stays active; each click or drag is one undo step. Constraints on
  the deleted pieces go and the rest stay.
- Extend: click near an endpoint to reach the first boundary.

Trim and extend report the constraints they removed.

### Editing a sketch

Editing a sketch rolls the model back to that sketch and faces its plane.
**Finish Sketch** rebuilds the model. Undo and redo stay inside the sketch.
**Extrude** in the sketch toolbar finishes the sketch and opens Extrude with
the selected region. If the sketch cannot be saved, it stays open with the
error shown.

## Model

### Pick fields

Each input a feature dialog picks, such as Profiles, Body or Target, is a
row. Click a row to make it active; viewport and tree clicks fill only the
active row, with what it takes. A filled single-item row hands over to the
next empty one. Rows that need a flat face ignore curved faces. A selection
made before opening fills the rows. In Extrude, Shift-click picks a face
instead of a region.

Each row lists its picks, such as `Edge 3, Body 1`. Hover one to light it in
the viewport, remove it with its button, or Clear the list. Edge and face
numbers can change when the body is rebuilt.

### Solid features

- Extrude: new body, join, cut or intersect; symmetric or two-sided; from
  sketch profiles or planar faces.
- Revolve, sweep, emboss and deboss.
- Loft: click profiles or planar faces in section order without a modifier.
  Click a section again to remove it. Join merges the selected source bodies;
  New body keeps them. Curved faces and faces with holes are refused.
- Target: join, cut and intersect act on the bodies you choose. Auto picks
  the bodies the tool meets, again after each edit.
- Sweep paths take lines and arcs in any order. A branched or broken path
  fails with "sweep path is not a connected chain".

### Modify

Fillet, chamfer, shell, combine, split body, press/pull and move. Move
translates bodies along X, Y and Z by typed values or the arrow gizmo.

Shell removes the faces you click and keeps the wall thickness. With no face
picked, it hollows the body into a sealed cavity.

Fillet and Chamfer default to **Select tangent chain**: clicking an edge picks
the smooth edges connected to it, and clicking a picked chain drops it.
Uncheck it to pick edges one at a time.

A fillet that meets two earlier fillets can fail. This is a current
limitation. Fillet the vertical edges before the top edges to avoid it.

### Replicate and construction

- Replicate: mirror, rectangular pattern and circular pattern.
- Construction: offset planes and midplanes; sketch on any planar face.
- Origin axes: the model tree's Origin section lists X, Y and Z Axis. With an
  Axis or Direction row active, click an axis row or line to use it. Hidden
  axes cannot be picked.
- Axis and direction rows hold one straight line; a new pick replaces the
  old one.

### Drag handles

A feature dialog with a main value shows a handle in the viewport: an arrow
for distances, offsets, thickness, radius and spacing, a ring for angles, and
one arrow per axis for Move. Dragging changes the field as typing would, the
model previews when you pause, and OK adds one undo step. Handles snap finer
as you zoom in. Holding Ctrl while dragging the extrude arrow collapses it to
zero.

### Reference images

Attach PNG, JPEG or WebP canvases to planes, up to 25 MB each, and calibrate
them to real dimensions with two points.

### Feature timeline

Rename, edit, suppress, delete and roll back features, or insert features
mid-history.

- Click a chip to select the bodies its feature made or changed; Ctrl or
  Cmd+click adds them. With a dialog open, a chip click fills the active row.
- Double-click a chip to edit it. Right-click and choose Quick edit to change
  its main value in a small box; Enter keeps it, Escape reverts.
- Rest the pointer on a chip for 0.3 seconds to see the model right after
  that feature. Nothing is saved.
- Broken references are flagged, never dropped. The chip's tooltip lists
  them; edit the feature to repair each under References with Accept or
  Pick.

A project made before naming version 2 offers Upgrade naming… on each chip's
right-click menu. It backs up the project, lists every reference with its new
name, and Apply upgrade saves version 2 as one undo step.
[FEATURE_TIMELINE.md](../../FEATURE_TIMELINE.md) covers the semantics.

## Inspect

Measure between points, edges and faces: distance, ΔXYZ, angle, radius, area
and length. Press I to start.

## Files

### Import

Start a project with **New project from STEP**, or use **Insert → Import
STEP**. It accepts STEP, IGES and BREP files up to 10 MB with solid bodies,
without their sketches or feature history.

It also accepts STL, OBJ and 3MF meshes of up to 200,000 triangles. A closed
mesh becomes a solid; an open one becomes a shell with a warning. Meshes are
not parametric.

### Export

Export writes binary STL or multi-body 3MF, with named bodies and a
tessellation quality control.

### Saving

Every change saves automatically, with the full parametric history in a
readable JSON format.

## Workspace

### Viewport controls

| Action                             | Input                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Select                             | Left click (Ctrl adds; Alt+click cycles overlapping picks)                              |
| Context menu                       | Right click on a project, tree row, timeline chip or the viewport                       |
| Orbit                              | Right-drag or Shift+middle-drag, about the point under the cursor; or drag the ViewCube |
| Pan                                | Middle-drag, or two-finger scroll on a trackpad                                         |
| Zoom                               | Scroll wheel or trackpad pinch, to the cursor                                           |
| Named views / fit / ortho or persp | Toolbar (right side) and ViewCube                                                       |

Each project reopens at your last camera. A project you have not moved opens
zoomed to fit.

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

### Undo and history

Undo and redo are separate from the feature timeline. Hiding or showing
something is not an undo step. The tooltips name the step each would undo or
redo.

**History** in the top bar lists the last 50 edits with their time and who
made them. Save checkpoint keeps the
current state through any number of later edits. Restore saves an earlier
state as a new step that Undo reverses.

### Panels, previews and errors

A feature dialog opens with its main number selected, so typing replaces it.
Enter presses its confirm button and Escape cancels.

While a dialog is open the model shows as it was before that feature, so you
can pick any original edge or face. The result previews as a see-through
ghost: green where material is added, red where it is removed. OK keeps it as
one undo step; Cancel returns to the saved model.

Errors stay visible until dismissed or the next operation starts, and their
text can be copied.

### Version label

The bottom-right corner shows the running build. Hover it for the full
commit, version and schema. The README's
[Running build](../../README.md#running-build) section explains it.
