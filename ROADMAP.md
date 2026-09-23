# Roadmap

## Done (v0.1)

- OCCT WASM kernel service, regeneration engine with per-feature snapshot +
  tessellation caches
- Parametric sketcher: line/rect/centre-rect/circle/3-pt arc/polygon/slot/
  point, construction geometry, full constraint set, editable dimensions,
  DOF/status feedback, drag solving
- Profiles: region detection with holes, stable profile ids
- Features: extrude (profiles **and** planar faces; join/cut/intersect/new
  body; symmetric/two-sided), revolve, sweep, loft, emboss/deboss, fillet,
  chamfer, shell, combine, split body, press/pull, mirror, rectangular +
  circular patterns, construction planes (offset/midplane), reference images
  with two-point calibration
- Persistent topological naming (faces/edges/vertices), timeline with
  rollback / insert-mid-history / suppress / rename / delete / edit,
  broken-feature error surfacing
- Viewport: CAD navigation, ViewCube, named views, ortho/persp, topology
  picking with Alt-cycle, right-click context menus, measure
- STL + 3MF export (quality control, multi-body named 3MF)
- STEP solid import into existing projects or as the first feature in a new project
- JSON project format with schema versioning + migrations, atomic writes,
  autosave, duplicate/rename/delete, undo/redo
- Docker/Compose/Unraid packaging (non-root, single `/data` volume)
- Test suites: geometry, parametric regen, timeline, solver, profiles,
  persistence, export, full-HTTP MVP workflow

## Next

### Sketch workflow additions

- Implemented: linked model-edge projection for lines, circles, and circular arcs;
  references regenerate before constraint solving and render purple.
- Implemented: analytic trim/extend and numeric offsets of individual curves,
  closed line loops, and connected line/arc chains with rounded corners.
  Offsets have a live preview and create editable geometry; an associative
  offset-distance constraint is still future work.
- Covered by regression tests: upstream projection resizing and cold reload,
  missing sources, cyclic projection rejection, trimmed-arc/offset B-Rep volumes.

- **Reference repair UI**: re-pick a missing face/edge on a failed feature
- **Sketch tools**: sketch mirror/patterns, intersect model geometry,
  ellipse/spline projections
- **Selection filters** and window selection
- **Named parameters & expressions** (`wallThickness = 2.4`,
  `caseWidth / 2`). The schema already stores plain numbers per feature, so
  an expression table + resolver layer slots in front of evaluation
- **Construction axes/points** as timeline features (schema supports them)
- **Server-side revisions/checkpoints** of `document.json`
- **Assemblies-ready auth**: local login / OIDC / reverse-proxy header auth
- **Performance**: move kernel evaluation to a worker thread; binary
  tessellation payloads

## Later

- STEP export, surface/assembly import improvements, IGES, DXF
- Hole tool, threads, parametric text, configurations
- Drawings, sheet metal, assemblies/joints
- Multi-user collaboration, project sharing
- Mass/material properties UI (kernel support already present)
