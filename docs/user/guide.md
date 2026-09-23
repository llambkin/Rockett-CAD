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

- Project: click an earlier model edge to add a purple linked reference. Snap or
  constrain new shapes to it to follow source edits. References are construction
  geometry by default; toggle Construction on a selected reference to use it in
  a profile.
- Trim: click the portion of a curve between intersections to remove it.
- Extend: click near an endpoint to extend to the first intersecting boundary.
- Offset: see [Sketch offsets](#sketch-offsets).

Each operation returns to Select and can be undone. Unsupported projections and
collapsing offsets show an error. Trim/extend reports removed curve constraints.

### Editing a sketch

Editing an existing sketch temporarily rolls the viewport and timeline marker
back to that sketch. **Finish Sketch** regenerates the model at the previously
saved timeline position. Entering edit mode does not change the saved marker or
create an undo step.

Opening a sketch from the model tree or timeline faces its plane automatically.
Undo/redo stays inside an existing sketch and returns to Select.

## Model

### Solid features

- Extrude: new body, join, cut or intersect; symmetric or two-sided; from
  sketch profiles _or_ planar faces.
- Revolve, sweep, loft, emboss and deboss.
- Sweep paths take lines and arcs drawn in any order. A branched or broken path
  fails with "sweep path is not a connected chain".

### Modify

Modify covers fillet, chamfer, shell, boolean combine, split body, press/pull
(offset face) and move. Move translates whole bodies along X, Y and Z by typed
values or the arrow gizmo.

Shell removes the faces you click and keeps the given wall thickness. With no
face picked, it hollows the closed body into a sealed cavity.

Fillet and Chamfer default to **Select tangent chain**. Clicking an edge
selects smooth connected edges (including line/arc joins); sharp corners and
ambiguous branches stop the chain. Clicking a fully selected chain deselects it.
Uncheck the option to pick edges individually. OCCT may still propagate a fillet
or chamfer along a smooth contour as required by its native operation.

### Replicate and construction

- Replicate: mirror, rectangular pattern and circular pattern.
- Construction: offset planes and midplanes; sketch on any planar face.

### Reference images

Attach PNG, JPEG or WebP canvases to planes, up to 25 MB each, and calibrate
them to real dimensions with two points.

### Feature timeline

Rename, edit, suppress, delete and roll back features, or insert features
mid-history. Right-click a chip and choose Quick edit to change its main
value, such as an extrude distance or fillet radius, in a small box above the
chip. The model previews as you type; Enter keeps the change as one undo step
and Escape or clicking away reverts it. Rest the pointer on a chip for 0.3
seconds to see the model as it was right after that feature; moving away
returns to the current model, and nothing is saved or added to undo. Broken
references are flagged, never silently dropped.
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
or showing something is not an undo step.

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
0.3 seconds after your last change as a see-through ghost of only the faces it
adds, and a new body whole: green when the feature adds material, red when it
removes material (cut, intersect, deboss, shell, fillet, chamfer, a negative
face offset). An edit that adds no face ghosts the faces that moved. The ghost
cannot be picked. OK keeps the previewed feature as one undo step and shows the
result; Cancel, Escape or closing the dialog returns to the saved model.

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
