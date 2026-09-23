# Rockett CAD

Self-hosted, browser-based **parametric CAD** for designing 3D-printable parts.
A deliberately simplified, self-hostable take on the parametric solid-modelling
portion of Fusion 360:

> **Sketch → constrain → feature → body → timeline → modify → regenerate → export**

Built on a real B-Rep solid-modelling kernel (OpenCascade / OCCT compiled to
WebAssembly), not a mesh editor. Every operation is an editable parametric
feature in a chronological timeline; editing an earlier feature rebuilds
everything downstream against persistent topology references.

![stack](https://img.shields.io/badge/kernel-OpenCascade%207.6-blue)

## Features

- **Parametric sketcher**: line, rectangle, centre rectangle, circle, 3-point
  arc, polygon, slot, points, construction geometry; full constraint solver
  (horizontal, vertical, parallel, perpendicular, tangent, coincident,
  concentric, equal, midpoint, collinear, fix) and editable dimensions
  (length, distance, radius, diameter, angle) with live DOF / constrained-state
  feedback.
- **Sketch offsets**: the Offset tool previews the result in yellow. Select a
  curve, set the distance, and use Reverse direction to switch sides; positive
  is left of a line or outside a circle or arc. Connected lines and rounded arc
  corners chain automatically; Ctrl-click picks the chain yourself, in any
  order. While editing the sketch, click an offset's **↔ Offset N: d mm** badge
  to change its distance. Entity IDs stay the same, so downstream profile
  references hold. Offset curves follow their distance and cannot be dragged.
  Offsets made before schema 4 are plain geometry; recreate them to get a badge.
- **Solid features**: extrude (new body / join / cut / intersect, symmetric,
  two-sided, from sketch profiles _or_ planar faces), revolve, sweep, loft,
  emboss/deboss.
- **Modify**: fillet, chamfer, shell, boolean combine, split body,
  press/pull (offset face), move (translate whole bodies along X, Y and Z by
  typed values or the arrow gizmo).
- **Replicate**: mirror, rectangular pattern, circular pattern.
- **Construction**: offset planes, midplanes; sketch on any planar face.
- **Reference images**: attach PNG/JPEG/WebP canvases to planes, with
  two-point calibration to real dimensions.
- **Feature timeline**: rename, edit, suppress, delete, roll back, insert
  features mid-history; broken references are flagged, never silently dropped.
- **Inspect**: point/edge/face measurement (distance, ΔXYZ, angle, radius,
  area, length).
- **Export**: binary STL and multi-body 3MF (bodies preserved as named
  objects), with tessellation quality control.
- **STEP import**: start a project with **New project from STEP**, or use
  **Insert → Import STEP** in an existing project. Accepts `.step`/`.stp`
  files up to 10 MB containing solid bodies. Imported solids support further
  modelling; the source application's sketches and feature history are not imported.
- **Persistence**: human-inspectable JSON project format that stores the full
  parametric history (never just the final mesh); versioned schema with
  migrations; automatic save on every change; survives container recreation.
- **Undo/redo**: application-level, separate from the CAD timeline.

## Quick start (Docker)

```bash
docker compose up -d
```

Then open http://localhost:8788. All state lives in the `rockett-cad_data`
volume; DOCKER.md covers LAN access and running dev and prod side by side.

For Unraid, see [DOCKER.md](DOCKER.md) and the template in
`docker/unraid-rockett-cad.xml`.

## Development

```bash
npm install
npm run dev        # server on :8788 + Vite client on :5173
npm test           # geometry, solver, timeline, persistence, API tests
```

See [DEVELOPMENT.md](DEVELOPMENT.md).

## Documentation

| Doc                                        | Contents                                                          |
| ------------------------------------------ | ----------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | System overview, layers, technology choices                       |
| [CAD_MODEL.md](CAD_MODEL.md)               | B-Rep representation, topology naming, regeneration, tessellation |
| [FEATURE_TIMELINE.md](FEATURE_TIMELINE.md) | Timeline semantics, rollback, dependency handling                 |
| [API.md](API.md)                           | REST API reference                                                |
| [DOCKER.md](DOCKER.md)                     | Deployment (Docker / Compose / Unraid)                            |
| [DEVELOPMENT.md](DEVELOPMENT.md)           | Repo layout, workflows, testing                                   |
| [ROADMAP.md](ROADMAP.md)                   | Current status and planned work                                   |

## Viewport controls

Editing an existing sketch temporarily rolls the viewport and timeline marker
back to that sketch. **Finish Sketch** regenerates the model at the previously
saved timeline position. Entering edit mode does not change the saved marker or
create an undo step.

| Action                             | Input                                                                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select                             | Left click (Ctrl adds; Alt+click cycles overlapping picks)                                                                                                                              |
| Context menu                       | Right click on geometry                                                                                                                                                                 |
| Orbit                              | Right-drag, Shift+middle-drag, or drag the ViewCube                                                                                                                                     |
| Pan                                | Middle-drag                                                                                                                                                                             |
| Zoom                               | Scroll wheel (to cursor)                                                                                                                                                                |
| Named views / fit / ortho or persp | Toolbar (right side) and ViewCube                                                                                                                                                       |
| Shortcuts                          | S sketch · E extrude · F fillet · M move · I measure (inspect) · Shift+F fit · ? controls · Ctrl+Z/Y undo/redo · in sketch: V/L/R/C/D/P tools, X construction, Delete removes selection |

## Sketch modification tools

- Project: click an earlier model edge to add a purple linked reference. Snap or
  constrain new shapes to it to follow source edits. References are construction
  geometry by default; toggle Construction on a selected reference to use it in a profile.
- Trim: click the portion of a curve between intersections to remove it.
- Extend: click near an endpoint to extend to the first intersecting boundary.
- Offset: see Sketch offsets under Features.

Each operation returns to Select and can be undone. Unsupported projections and
collapsing offsets show an error. Trim/extend reports removed curve constraints.

## Workspace usability

Undo/redo stays inside an existing sketch and returns to Select. Opening a sketch
from the model tree or timeline faces its plane automatically. Shift+F fits the
model in view. The Controls button (or ?) lists keyboard and mouse controls.
Tool panels keep their action buttons within the window; the arrow in the title
bar restores their docked position. Errors remain visible until dismissed or
the next operation starts, and their text can be selected and copied.

Fillet and Chamfer now default to **Select tangent chain**. Clicking an edge
selects smooth connected edges (including line/arc joins); sharp corners and
ambiguous branches stop the chain. Clicking a fully selected chain deselects it.
Uncheck the option to pick edges individually. OCCT may still propagate a fillet
or chamfer along a smooth contour as required by its native operation.

## License note

Rockett CAD bundles [opencascade.js](https://github.com/donalffons/opencascade.js)
(LGPL-2.1), the WASM build of Open CASCADE Technology.
