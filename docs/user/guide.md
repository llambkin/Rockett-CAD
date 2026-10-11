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

Splines have keys but no toolbar buttons yet. N draws a fit-point spline
through each click; double-click to end, then drag its two construction
handles to set the end tangents. B draws a control-point spline over its
clicks. K draws a conic from start, end and apex; rho, between 0 and 1,
sets how far it bulges toward the apex. A spline end that meets a line, arc
or spline takes a tangent relation.

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

### Move and copy

Select sketch geometry, then click **Move** in the sketch toolbar to open
Move/Copy. Set the X and Y distances and an Angle. The angle turns the
selection about its box centre, or about a sketch point you choose with Pick
point. Tick Copy to keep the original. Yellow previews the result; OK saves it
as one undo step and Cancel changes nothing.

Constraints inside the selection move with it, and a copy gets its own.
Constraints to unselected geometry are removed, or left out of the copy, and
the panel counts them. An angle that is not a multiple of 90 degrees turns
horizontal and vertical relations into angle dimensions and removes horizontal
or vertical distances. Moving by an angle also removes an angle dimension set
by a parameter, since the parameter would turn it back. Fixed, projected and
offset geometry cannot move, and the panel names it. Copy still copies it as
plain geometry, without its Fix. Unselected curves keep their ends where they
were.

Set Type in the same panel to copy the selection instead of moving it:

- **Mirror** copies it across a sketch line you pick, construction lines
  included. Arcs stay mirror images and angle dimensions follow the mirror.
- **Rect Pattern** repeats it along a Direction (X axis, Y axis or a picked
  sketch line) by Quantity and Spacing. Tick Second direction for a grid.
- **Circ Pattern** repeats it round the sketch origin or a picked point. A
  Total angle of 360 degrees spaces the copies evenly; a smaller angle spreads
  them from the first to the last.

Quantity counts the original, so a 3 by 2 grid gives 6 in all, up to 500
copies. Each copy keeps the constraints inside the selection and is plain
geometry after OK, which is one undo step. Horizontal and vertical relations
on a circular copy, or on a mirror across a line not at a multiple of 45
degrees, become angle dimensions as they do for Move.

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

Fillet and Chamfer also take faces, which blend their sharp edges, and
timeline features, which blend the sharp edges of the faces they made. A
corner is refused: pick the edges or faces at it.

Fillet's **Type** offers **Two distances** on straight edges between flat
faces: Distance 1 and Distance 2 set where the round meets each face, and
**Flip** swaps them. An edge at a curved face, a corner of three edges or a
run of collinear edges is refused.

**Add set** starts another selection set with its own radius, as Fusion's
**+** does, and **Set** chooses which set your picks, the radius, the size
hint and the drag arrow act on. **Remove set** drops the chosen set. Every
set builds in one fillet. Two distances and Variable radius take one set.

**Between** narrows a fillet of faces or features to the edges where they
meet the faces or features picked under it, as Fusion's Rule fillet
**Between faces/features** does. Click **Between**, then those faces or
features. Picked edges still round as picked. Faces alone round every sharp
edge they bound, as Fusion's **All edges** does.

Fillet's **Type** also offers **Variable radius**: the round changes evenly
from **Start radius** at one end of each edge, or tangent chain, to **End
radius** at the other. Swap the two values to reverse it.

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

It also accepts STL, OBJ and 3MF meshes of up to 1,000,000 triangles. A closed
mesh becomes a solid; an open one becomes a shell with a warning. Meshes are
not parametric. A closed mesh shows its triangles as faces, without pickable
edges or vertices, until a feature works on it.

### Export

Export writes binary STL or multi-body 3MF, with named bodies and a
tessellation quality control.

Export DXF writes a 2D outline as DXF R12. Right-click a sketch in the model
tree, or a planar face in the viewport, and choose Export DXF. The file takes
the sketch or body name. A curved face does not offer it.

### Saving

Every change saves automatically, with the full parametric history in a
readable JSON format.

## CAM

CAM turns a model into an NC file, the program a CNC machine runs. This
section assumes you have never run one. Read it all before your first cut.

### Words

- **Stock**: the raw block or sheet you cut the part from.
- **WCS and zero**: the work coordinate system. Its origin is the zero point.
  Every X, Y and Z in the NC file is measured from it. You set the same point
  on the machine before cutting.
- **Setup**: one way the stock is held on the machine. It holds the stock
  size, the zero, the material, the machine and the operations.
- **Machine**: your CNC's limits: travel, spindle speeds, feeds and how stiff
  it is.
- **Post**: the translator that writes the NC file in your controller's
  dialect, such as GRBL 1.1 or LinuxCNC.
- **Tool**: a cutter: its kind, diameter, flute length and flutes.
- **Preset**: the feeds and speeds for one tool: spindle speed, cut, plunge
  and ramp feeds, stepdown and stepover.
- **Feeds and speeds**: how fast the spindle turns (rpm) and how fast the
  tool moves (mm/min). Wrong values break tools or burn the material.
- **Stepdown**: how deep each pass goes. **Stepover**: how far apart side by
  side passes are, as a fraction of the diameter.
- **Operation**: one job in a setup, such as a pocket or a contour.
- **Toolpath**: the moves an operation generates.
- **NC file**: the G-code program, made from every toolpath through the post.

### From part to NC file

The first time, make a simple part: a 50 by 30 mm rectangle on the XY plane,
extruded 10 mm.

1. On the project list, type a name in **New project name…** and click
   **Create**.
2. Model the part. Click **XY Plane** in the tree, **Create Sketch**, then
   **Rect**. Click the origin, move the pointer up and right, type 50, Tab,
   30 and Enter, then **Finish Sketch**. Click **Sketch1** in the tree, then
   **Extrude**, set **Distance (mm)** to 10 and click **OK**.
3. Add your machine. Open your user menu in the top bar, choose
   **Settings**, then **Machines** under CAM, and click **Add machine**. Fill
   in its travel and spindle speeds from its manual. Set **Rigidity**:
   **Light** for a hobby router, **Medium** for a stiff router, **Rigid** for
   a mill. Click **OK**. The first machine is the default until you click
   **Make default** on another.
4. Add a tool. Choose **Tools** and click **Add tool**. The default is a 6 mm
   flat end mill with 2 flutes; change it to match your cutter, then **OK**.
5. Add a preset. Click **New preset** on the tool's row. Pick the
   **Material** and click **Suggest**. Lower **Stepdown (mm)** to a quarter
   of the diameter, 1.5 for a 6 mm tool, and click **OK**. Close Settings.
6. Switch the **Workbench** menu in the top bar to **Manufacture**.
7. Click **Setup**. Choose the **Material** and check the **Machine**. Under
   **Stock**, **Box around bodies** adds a margin on each side. Set **-Z (mm)**
   and **+Z (mm)** to 0 when your stock is exactly as thick as the part. Leave
   **WCS** at **Stock corner, front left, top**. Click **OK**.
8. Click the part's top face, then **Contour**. Pick the **Tool** and
   **Preset**, keep **Side** at **Outside** and set **Bottom offset (mm)** to
   10, the part height. Click **OK**.
9. Right-click **Contour 1** in the tree and choose **Generate**. Its chip
   turns from **never** to **fresh**.
10. Click **Contour 1** to draw its toolpath, then **Simulate** in the bottom
    bar. Wait for **No gouges**.
11. Click **NC Program**. Every setup starts ticked. Check the **Machine** and
    **Post**, and click **Export**. The browser downloads the NC file.

There is no edit or delete for a setup or an operation yet. To change one,
make a new one, then Suppress the old operation from its right-click menu or
untick the old setup in NC Program.

### Operations

Each operation is a toolbar button. Select its face first.

- **Contour** cuts around the outline of one flat face that points up.
  **Outside** cuts around a part to free it from the stock; **Inside** cuts
  along the inside of the outline. It needs a flat or bull nose end mill that
  is centre cutting.
- **Pocket** clears all material down to a flat floor face. Holes in that
  floor stay as islands. The tool enters in a helix or a ramp at **Ramp angle
  (°)**; 2 to 5 degrees is gentle. Use it for recesses and for blind holes.
- **Laser** cuts or engraves the outline and holes of a face with a laser
  machine. Its tool is a flat end mill whose diameter is the beam's kerf. Set
  **Power**, **Feed** and **Passes**; **Z step (mm)** lowers each pass.

Facing, drilling and 3D finishing have no dialog yet. Mill a hole as a Pocket
on its floor; a through hole has no floor, so it cannot be cut yet. Order the
operations so the part stays held: holes and pockets first, the outside
contour last. **Move up** and **Move down** on the right-click menu change the
order.

### Cut depth

Every cut starts at the top of the stock. Pocket stops at its floor face.
Contour stops **Bottom offset** below the face you picked, not below the
stock.

So a Contour on the top face with Bottom offset 0 cuts at the top surface
and removes nothing. With no stock above the part it is refused:
`stock top must be above the cut depth`. To cut the part out, set Bottom
offset to the part height. If the stock has a **-Z** margin, that much stays
under the part as a skin.

There are no tabs yet, so a through cut frees the part on its last pass.
Hold it down outside the toolpath with screws, clamps or tape. Or set Bottom
offset a few tenths of a mm under the part height and cut the thin skin by
hand afterwards.

A cut deeper than the tool's flute length is refused.

### Safe first settings

- Use **Suggest** in the preset. It reads the material chart for your tool on
  the default machine and keeps rpm and feeds inside the machine's limits.
  Its note says what it limited.
- Set the machine's **Rigidity** honestly. **Light** takes 70% of the chart's
  chip load and a stepdown of half the diameter; **Medium** 90% and one
  diameter; **Rigid** the full chart and one diameter.
- Start with a stepdown of a quarter of the diameter and a stepover of 0.4.
  Suggest sets stepover to 1, a full width slot; 0.4 is gentler in a pocket.
  Raise them only after a clean cut.
- Keep **Safe height** at 15 mm and **Clearance** at 3 mm unless your clamps
  are taller. Both are measured above the stock top.
- Wood and plastic forgive more than aluminium. Make your first cut in MDF or
  softwood.

### Simulation and checks

Clicking an operation draws its toolpath: dashed lines are rapid moves in the
air, solid lines cut. Drag **Moves shown** to step through it. **Simulate**
removes the moves from a model of the stock and reports `No gouges`, or
`Gouges:` with how deep the tool cut into the part. Gouged cells turn red.

An operation's chip says **never**, **fresh**, **stale** after the model or
its inputs change, **error** with the reason in its tooltip, **missing
reference** or **suppressed**. **Generate all stale** regenerates every stale
operation. Nothing regenerates by itself.

NC Program runs more checks and lists any problem under **Export blocked**.
**Generate first** regenerates an operation that is not fresh. It checks that
rapids miss the stock, that rpm is inside the machine's spindle range, that
feeds stay at or under the machine's maximum per axis, that a tool which is not
centre cutting never plunges, and that a mill program never runs on a laser.
It does not check machine travel for a setup made in the dialog, so check
that the part fits your machine yourself.

### When it refuses

Generate and Export say why they refuse. The common ones:

| Message                                               | What to do                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `operation … needs a tool`                            | The operation has no tool. Add one in Settings, CAM, Tools, then a new operation. |
| `operation … needs a preset of its tool`              | The tool has no preset, or it was deleted. Add a preset with **New preset**.      |
| `… params: must have required properties face`        | No face was picked. Click the face before the toolbar button.                     |
| `operation … is suppressed; unsuppress it first`      | Right-click it and choose **Unsuppress**.                                         |
| `… rpm is outside the machine's … to … rpm`           | The preset's spindle speed is outside the machine's range. Press Suggest again.   |
| `stock top must be above the cut depth`               | Bottom offset is 0 on the top face. Set it to the depth you want.                 |
| `a … mm deep cut is past the … mm flute length of …`  | Cut less deep or use a longer tool.                                               |
| `face … does not face up in the setup`                | Pick a flat face that points up, not a wall or the bottom.                        |
| `… leaves no path: the loop is smaller than the tool` | The shape is smaller than the tool. Use a smaller tool.                           |
| `no helix or ramp entry fits at …`                    | The pocket is too small for the tool to enter. Use a smaller tool.                |
| `… is not centre cutting and cannot plunge`           | The tool cannot plunge. Use a centre cutting end mill.                            |
| `… is not cached; generate it again`                  | Click **Generate first**. Opened project files carry no toolpaths.                |
| `a rapid passes through the stock or its clearance`   | Raise **Safe height** or **Clearance** in a new setup.                            |

### Before you cut

Rockett never marks a program safe to run. On the machine:

1. Clamp the stock flat and tight, with every clamp outside the toolpath.
2. Fit the tool you chose, and check its diameter and stick out.
3. Set zero where the WCS says: X and Y at the front left corner of the stock
   and Z on its top, for the default WCS. Use the same G54 offset.
4. Check the spindle turns clockwise seen from above.
5. Air cut first: raise Z zero 20 mm above the stock and run the program. The
   tool must stay clear of everything.
6. Keep a hand on the stop button for the whole first cut, and wear eye and
   ear protection.

### Example project

[cam-plate.rockett](../../examples/cam-plate.rockett) is a 100 by 60 by 10 mm
MDF plate with a 4 mm deep pocket and two 15 mm holes 6 mm deep. It has a
setup with an example machine and GRBL post, a 6 mm flat end mill with an MDF
preset, and four operations: two Pockets for the holes, a Pocket and an
outside Contour. The holes are 15 mm because a Pocket's helix entry needs
room: a 6 mm tool cannot enter a 10 mm hole.

On the project list click **Open project file** and choose it. Switch to
**Manufacture**, right-click each operation and choose **Generate**. Then
follow steps 10 and 11 above. Before cutting it, make a new setup with your
own machine.

## Workspace

### Viewport controls

| Action                             | Input                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Select                             | Left click (Ctrl adds; Alt+click cycles overlapping picks)                              |
| Box select                         | Left-drag from empty space: rightward takes what is inside, leftward what it crosses    |
| Box add or remove                  | Hold Shift while dragging to add to the selection, Ctrl to remove from it               |
| Move sketch geometry               | With Select, drag a sketch point or line                                                |
| Context menu                       | Right click on a project, tree row, timeline chip or the viewport                       |
| Orbit                              | Right-drag or Shift+middle-drag, about the point under the cursor; or drag the ViewCube |
| Pan                                | Middle-drag, or two-finger scroll on a trackpad                                         |
| Zoom                               | Scroll wheel or trackpad pinch, to the cursor                                           |
| Named views / fit / ortho or persp | Toolbar (right side) and ViewCube                                                       |

A selection box reaches through the model: hidden faces, edges and vertices
inside it are selected too. Escape during the drag cancels the box.

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
| N/B/K           | Fit-point, control-point and conic splines, in a sketch   |
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
