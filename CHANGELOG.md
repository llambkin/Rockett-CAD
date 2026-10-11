# Changelog

Versions follow semver. The root `package.json` owns the one app version;
the workspace versions stay `0.1.0`. `SCHEMA_VERSION` (document format) is
versioned separately in `shared/src/documents.ts`; `/api/health` reports both to
signed-in users.

A release moves `Unreleased` into a dated `## X.Y.Z` section and gets an
annotated tag `vX.Y.Z` on that `origin/main` commit. Every `SCHEMA_VERSION`
change gets a `Schema N` line in the section that ships it.

## 0.3.0 (Unreleased)

This snapshot extends 0.2.0. CAD foundations and the complete CAD-to-CAM
release workflow remain under development. The core licence is unresolved.

### Added

- KiCad board upload API stores original bytes and parsed snapshots as portable
  project assets, with undo and a KiCad 9 minimum.
- Export board outline DXF sits beside Export DXF on a face's right-click menu.
- Accounts with first-admin setup, username or email sign-in, password changes,
  TOTP, persistent sessions and an offline password-reset command. Cloudflare
  Access can map a verified identity to an existing account.
- Per-user project ownership, view or edit sharing, friend requests, in-app
  notices and shared folders. Sharing a browser project first moves it to the
  server.
- Layered app, personal and project settings, personal settings import/export,
  grey or black themes, accent colours, display units and typed unit suffixes.
  Camera, pick tolerance, snap angles and preview appearance are configurable.
- Per-user saved project views and cameras, a synced model-tree splitter,
  project snapshots, project-list sorting/filtering and keyboard move navigation.
- Server-owned undo/redo, preview transactions, history attribution, checkpoints
  and confirmed restore. Admins can collect orphan project blobs.
- Reference signatures, explicit tool targets and reference repair in feature
  dialogs, including sketch projections and reference-image planes. Repairs keep
  the edit dialog open and refresh its preview base; OK finishes the edit.
  Existing naming-version 1 projects can review and apply a backed-up,
  undoable upgrade to version 2.
- Shell walls go inside, outside or both sides, each with its own thickness.
  A shell is checked for its openings and walls before it replaces the body.
- Planar-face revolve, construction planes by angle, three points or two edges,
  plane flip and midplane offset, origin-axis picking, active dialog pick rows
  and drag handles for features with a main value.
- Loft accepts ordered sketch profiles and planar body faces, including mixed
  sections. Join includes the selected source bodies.
- Sketch regions from linked planar face boundaries, regular polygons at a set
  angle, point-to-line and line-to-line dimensions, driven dimensions,
  over-constraint refusal and drag-to-trim.
- Fit-point, control-point and conic spline tools, exact spline profiles and
  extrudes, and tangent or smooth joins. Sketch relations add symmetry about
  a line and curvature-continuous smooth joins.
- Editable copies of exact planar face boundaries, including holes; copied
  curves stay unchanged when the source changes. Project links earlier sketch
  curves, B-spline edges, faces and body outlines; Face sections and Body
  sections link their intersections with the sketch plane.
- Extrude starts at the profile plane, an offset or an object and ends at a
  distance, To object or All. Each side can taper. Thin extrude makes inside,
  outside or centred walls on profiles or open sketch curves.
- Timeline wheel scrolling, keyboard actions, body selection and feature peeks
  highlighting created or modified faces. Design and sketch toolbars scroll
  with the wheel; the viewport reads out hovered and selected items.
- Named STEP solid export and sketch or planar-face DXF R12 export through
  format registries.
- Cancellable kernel jobs, progress reporting and crash recovery that blocks
  dependent geometry and exports until the failed feature is edited.
- Manufacture workbench with setups, stock, work zero, Contour, Pocket and
  Laser operations, status and cycle time, stale toolpath generation, move
  preview and heightmap simulation with gouge checks.
- CAM machine, tool, post and feed-preset libraries in Settings. Setups choose
  a machine, post, material and tolerance. Suggest fills feeds and speeds for
  flat, bull nose and ball nose tools; Rigidity scales chipload and stepdown.
  Re-suggest adapts a preset to the setup's machine without changing the library.
- NC export as one file or a zip through GRBL 1.1, grblHAL, LinuxCNC, FluidNC,
  Mach3, Mach4 and Marlin posts, with millimetre or inch output. Users can
  import or delete JSON posts and download an AI post kit to adapt an old post.
- Beginner CAM guide and an example plate project ready to generate.
- First-party modules with an admin enable switch and per-user visibility.
  The plugin API 0.23.0 supports commands, toolbars, context menu items, panels, settings pages,
  routes, scene contributions, kernel jobs, timeline features with labelled faces, keyed
  reference bodies, STEP reads through the core importer, capped Zstandard decoding, DXF of a sketch or planar face on a named layer, project
  services, source blobs, viewport pick modes, length and angle formatting, measure queries, saved
  module panel positions, versioned module data migrations, a shared placement schema and placement maths, keyed body ids, theme-coloured materials and the core error line;
  CAM is the first shipped module. Project reads can fetch immutable bytes;
  document mutations can store them within the import byte budget, after
  access and revision checks. Modules declare portable source and snapshot
  assets in their own namespace; save, history, duplicate and `.rockett` files
  preserve exact bytes without features, including absent or disabled modules.
  Services bind the authorised document, authenticated user and read-only blobs;
  unload invalidates retained calls. Module features can resolve committed
  extension inputs and source assets; source replacement refreshes warm
  geometry and CAM fingerprints, and undo restores them.

### Fixed

- Naming-version 2 gives joins, mirrors, patterns, split bodies, press/pull,
  full revolves, sweeps, lofts and imported faces more stable identities.
  Tied references use live geometry; added join/cut pieces keep feature identity.
- Join and Cut use actual contact instead of bounding-box overlap. Joins retain
  the picked body; automatic Cut requires solid overlap. Edge-only contact and
  zero-thickness results report warnings or errors as appropriate.
- Fillet, chamfer and shell reject invalid, loose or inside-out results and keep
  the previous body. Shallow planar folds can blend; some rounded-face shell
  openings work. Size searches report incomplete results instead of claiming a
  proven maximum, and a revolve crossing its axis is refused.
- Sweep handles every picked profile; angled midplanes bisect their faces.
  Press/Pull accepts planar faces only.
- Previews and handles use the pre-feature model, keep all deboss targets,
  preview revolve face edits and retain the current extrude operation. Cancel,
  unchanged OK, conflicts, late replies and project closure restore or discard
  the right state without an extra undo step.
- Completed single picks advance to missing inputs, then return to multiple
  picks. Extrude and Revolve both explain Shift-clicking planar faces.
- Project settings are edited on the Project page; personal Editing settings
  keep personal scope. Body rename requests require a string name.
- Trim ends at its actual cutter; deleting constraints moves no geometry.
  Old region IDs still render, and unsettled sketches warn before the next edit.
- Kernel and preview sketch regions use the same face rule, including holes.
  Lost relations on projected sets warn and stay stored; deleting or suppressing
  their source blocks evaluation instead of using stale geometry.
- Generate returns a refusal reason for missing or failed geometry and invalid
  CAM inputs. NC checks accept a feed exactly at the machine's axis limit.
- Missing-module features and data are preserved through save and reload;
  evaluation names the required module with `Requires module <id>`.
- View saves survive project closure; deleted features lose stale view IDs;
  blocked bodies keep their groups. View/settings writes accept weak ETags,
  and view-only members can save their own view.
- Construction-plane visibility belongs to each user view; hidden planes remain
  active supports. Shape lookup compares identity even when kernel hashes collide.
- Deleting saved server projects, readable or unreadable, requires confirmation
  and a matching revision or content tag; stale requests are refused. The naming
  report skips projects with an interrupted migration and exits nonzero.
- Sign-in/setup failures are rate-limited by address, including behind an
  explicitly trusted proxy. Common passwords are refused, malformed sessions
  are moved aside, health diagnostics require access and request contents stay
  out of authentication logs. Response security headers restrict content sources
  and framing, prevent MIME sniffing and limit cross-origin referrer details,
  including on errors and unmatched routes.
- Missing assets return 404, API fallbacks return coded errors, history
  decompression is bounded and interrupted uploads are cleared at startup.
  Startup reports recovered writes as interrupted writes rather than migrations.
- Explicit scope ownership reduces native-handle retention across tested feature,
  import and export paths. Failed features restore the previous state; retained
  meshes remain usable after temporary handles close. Mesh, highlight and preview
  resources are reused or released on project closure. Sketch solving touches only
  affected components; history reads one snapshot and appends one record.
- The server shuts down gracefully on SIGTERM and the viewport redraws after
  WebGL context recovery.
- Mesh imports stay as mesh bodies until a feature needs B-Rep. Binary mesh
  transfer and disk-backed caching support million-triangle display; distant
  bodies use coarser meshes and hover picking skips bodies away from the ray.

### Changed

- Adopted the OCCT 8.0.1 kernel fork and a separate blend-surface WASM module.
  Kernel work runs through one client boundary with worker cancellation and
  byte-based engine/cache budgets.
- Feature definitions, dependencies, dialogs, commands, panels, import/export
  formats and settings use registries. Dotted extension features carry their
  own version and preserve unknown module data.
- Project storage separates manifests, document blobs, views and history;
  migrations take backups before writing, and retained backups are pruned.
- The image carries third-party notices, licence texts and a base inventory;
  server and client builds use separate cached stages. Dependencies remain
  exactly pinned. Local focused checks require every proving file, and cost
  checks include untracked source without increasing existing ceilings.
- Schema 12: documents record their naming version; old projects start at 1.
- Schema 13: stale document visibility fields are removed.
- Schema 14: face and edge references can carry geometric signatures.
- Schema 15: tool features can record explicit body targets.
- Schema 16: revolve can use planar body faces.
- Schema 17: sketch dimensions add point/line distance and axis-angle kinds.
- Schema 18: construction planes add angle, three-point, two-edge, flip and
  midplane-offset methods.
- Schema 19: display units move from the document to project settings;
  geometry remains in millimetres.
- Schema 20: naming-version 2 join targets are sorted consistently.
- Schema 21: documents record the user responsible for their last edit.
- Schema 22: Loft adds planar-face sections. Imported upstream schema 12
  documents without a naming version retain version 1; schema 21 documents
  migrate without changing their geometry. Project manifests and views have
  independent versioned migrations.
- Schema 23: documents add named parameters and expression bindings, empty for
  prior documents.
- Schema 24: Shell can name the body it hollows; earlier shells keep hollowing
  the first body.
- Schema 25: sketches may hold exact ellipses; earlier documents load
  unchanged.
- Schema 26: Shell stores its direction, inside, outside or both sides, and an
  outside thickness for both sides; earlier shells load as inside.
- Schema 27: mesh imports store their file as a project blob instead of base64
  in the document; earlier documents move their mesh bytes into blobs after a
  backup.
- Schema 28: sketch ellipses may hold start and end points as elliptical arcs
  and may be projected from model edges; earlier documents load unchanged.
- Schema 29: Move can turn bodies about an axis and add the moved copy as a
  new body; earlier documents load unchanged.
- Schema 30: Chamfer stores its type, equal distance, two distances or
  distance and angle, with a flip; earlier chamfers stay equal distance.
- Schema 31: bodies may store a `#rrggbb` colour that wins over an imported
  one; earlier documents load unchanged.
- Schema 32: Fillet and Chamfer may pick faces and features as well as edges;
  earlier edge-only blends load and build unchanged.
- Schema 33: Fillet stores its type, equal distance or two distances with a
  flip; earlier fillets stay equal distance and build unchanged.
- Schema 34: Fillet may hold more selection sets, each with its own radius;
  earlier fillets load as one set and build unchanged.
- Schema 35: Fillet may round only the edges between two face or feature
  picks, and may vary its radius from a start to an end radius; earlier
  fillets load and build unchanged.
- Schema 36: sketches may hold splines, imported from DXF with their exact
  degree, poles, weights and knots; earlier documents load unchanged.
- Schema 37: sketches store fit-spline points and tangent handles, and conic
  defining points and rho; earlier documents load unchanged.
- Schema 38: projections may reference curves in earlier sketches; earlier
  edge projections load unchanged.
- Schema 39: projections may reference faces and body outlines as linked
  groups; earlier documents load unchanged.
- Schema 40: projections may store face or body sections at the sketch plane;
  earlier documents load unchanged.
- Schema 41: Extrude stores To object or All extents; an absent extent keeps
  the earlier Distance behaviour.
- Schema 42: Extrude may reference a start object; earlier documents keep
  their profile-plane or offset start.
- Schema 43: Extrude may store a taper angle for each side; absent angles
  keep straight walls.
- Schema 44: Extrude may store thin-wall location and thickness, and open
  sketch-curve references; earlier documents load unchanged.
- Schema 45: sketch relations add symmetric and smooth kinds; earlier
  documents load unchanged. All steps from schema 36 to 45 preserve existing
  document fields; the store backs up the source before saving a migration.
- Schema 46 adds an optional module asset reference map. Migration preserves unknown
  extension envelopes and wraps any pre-existing root `moduleAssets` value
  unchanged in `moduleAssets.legacy`, after a backup on the first save.
- Schema 47: join, cut and intersect tools may store the Auto target form,
  `autoTargets`, beside explicit `targets`; earlier documents load unchanged
  after a backup on the first save.
- A tool left on its default targets stores the Auto form: the bodies of the
  features that existed at creation, less those hidden then. A body inserted
  earlier in the timeline stays out, and a 1,000-copy pattern stores one
  feature id. Version 1 documents still store `targets`; the 10,000-target cap
  is gone.
- A reopened Auto tool shows Auto with the bodies it takes, and a picked body
  stays an explicit pick.

### Known limits

- Kernel handle cleanup remains incomplete on some feature paths.
- CAD foundation acceptance is unfinished. Shell and blend failures remain on
  some composed parts; a fillet meeting two earlier fillets can fail.
- Loft face sections must be planar and have one outline; faces with holes and
  face-based lofts that fail solid validation are refused.
- Thin extrude with taper is refused. Body outlines currently require planar
  and cylindrical faces; other surfaces can use face or edge projection.
- Spline and conic tools use keyboard shortcuts; toolbar buttons remain planned.
- CAM still needs the facing, drilling, adaptive, parallel, waterline and rest
  operation dialogs, an operation planner, hold-down placement, flip setups,
  setup checklists, improved links and Vectric tool import. A GRBL air cut and
  complete CAD-to-CAM release acceptance remain unfinished.
- Assemblies, PCB/electrical workbenches, additive workflows beyond current
  export, broader collaboration and full Fusion capability parity remain later
  work. This snapshot does not claim their completion.
- Drawings, sheet metal, additional exchange formats and further sketch,
  modelling, inspection and workspace options remain planned in the README Roadmap.
- Third-party module installation, a Modules page, missing-module timeline controls,
  module-data migrations and a plugin author guide remain unfinished.

## 0.2.0 (2026-09-23)

### Added

- Tangent sketch curves split regions. Regions sharing bounding curves get
  distinct ids; saved region ids still resolve.
- Sketch Trim (T) highlights and deletes the piece under the cursor. New
  ends stay coincident with the cutting curve; construction curves do not
  cut.

### Fixed

- Rewinding the timeline no longer discards cached downstream features.
- Reopening a feature for editing keeps its references: circular and linear
  pattern edge or sketch-line axes, split body tools, and midplane inputs were
  lost and replaced by defaults on OK.
- Editing a suppressed feature no longer unsuppresses it.
- The API rejects unknown feature types, type changes, missing reference
  arrays and unknown export formats with 400.
- M opens Move and I starts Measure, matching Fusion 360. Before, M was shown
  for both and started Measure.
- Sweep paths with arcs build, and a path sweeps the same whatever order its
  curves were drawn in. A branched or disconnected path is a feature error.
- A shell with no open faces hollows the body. Before, it replaced the body
  with its inner offset solid.
- The API rejects malformed features and documents with 400 instead of a 500
  or a saved bad value.
- Export rejects unknown body ids, naming them, and a non-numeric `quality`.
  Before, unknown ids were dropped and `quality` fell back to 0.05.
- Reading an evaluation no longer rewrites the project file.
- A STEP import writes its own kernel file, so it cannot overwrite or delete
  another import's.
- A move no longer changes when a later feature is added.
- Reopening an extrude and pressing OK without edits leaves it unchanged, so
  later features are not regenerated.
- Esc cancels an open feature dialog and reverts its preview.
- Live previews keep one request in flight. A late reply no longer overwrites
  a newer preview, a cancel or a commit.
- Sketch rebuilds, plane and image updates and closing the viewport free
  their GPU resources.
- An upload over its limit returns 413. A PNG without a full signature and
  header chunk returns 400.
- The container no longer owns its own code: `/app` stays root-owned and
  `/data` is the only path the app writes.
- The container healthcheck tolerates a long regeneration: a busy container
  turns unhealthy after about five minutes of failed probes, not 1.5.
- Move to on the project list opens at the click, inside the window, with
  focus in it. Before, it opened at the top of the page.

### Changed

- Hiding and showing bodies, sketches and reference images is no longer an
  undo step and never re-evaluates the model. The hidden set is saved with the
  project and loads when it opens.
- Schema 11: which bodies, sketches and reference images are hidden moves out
  of the document into the project's `view.json`, and the unused `camera` is
  dropped. The 10 to 11 migration writes `view.json` beside the new blobs,
  before the backup and the document rewrite.
- Schema 10: a document keeps module data in `extensions`, keyed by a dotted
  module id. The 9 to 10 migration adds an empty `extensions`.
- Schema 5: a sketch line can keep its angle from the sketch +X axis
  (`lineAngle`). A typed ∠ is stored, and double-click edits a line's
  length and angle. The 4 to 5 migration only bumps the version.
- `/api/health` returns `version`, `schemaVersion`, `commit` and `describe`.
  The bottom-right corner of the project list and the workspace shows the
  running build.
- `THIRD-PARTY-NOTICES.md` lists every package in the image and the client
  bundle with its version, licence and upstream URL.
- `npm test` runs `tsc` on all workspaces first. Every workspace compiles
  with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- `npm run check` is the ship command.
- Docker: base image pinned by digest; build and runtime installs use `npm ci`
  from the lockfile. The separate runtime package file under `docker/` is
  removed.
- Dependencies at their latest releases, pinned exactly: Express 5, multer 2,
  React 19, three 0.186, Vite 8, Vitest 5, TypeScript 7, esbuild 0.28.
  `npm audit` reports 0 vulnerabilities, down from 8 (1 critical, 1 high).
  Node 24 is the minimum; the image is `node:24-trixie-slim`.
  `npm-run-all` is replaced by its maintained fork `npm-run-all2`.
- Export requires `bodyIds`; a missing or non-array value returns 400. An
  empty array still exports every visible body. `ExportRequest.binary` is
  removed: STL export was always binary.
- The Controls help opens up to 90% of the window and resizes from its
  corner.

### Known issues

- Face naming: sweep and loft faces and the end faces of a full revolve take
  fallback `x` names, joins, mirrors and patterns with `combine` keep coplanar
  splits, and press/pull renames the moved face. BUG-004, BUG-005, BUG-006,
  BUG-007 and BUG-008 fix these under naming version 2; existing projects keep
  today's names (DEC-101).
- A circular pattern with `combine` and disjoint copies renumbers its bodies
  by volume, so references to the original body move (REF-018).
- Closing or switching projects does not end a live preview session.
- Gizmo geometry is disposed twice when the viewport unmounts (KIT-003 to
  KIT-005).
- A missing file under `/assets` returns the app page instead of 404.
- Each sketch arc edge leaks three kernel `gp_Pnt` objects.
- Feature updates check the patch keys, not the merged feature, so an unknown
  key saved before this release survives an edit.
- `docker stop` waits 10 s and then kills the container (exit 137): Node runs
  as PID 1 with no SIGTERM handler. With `--init` it stops in under a second.
- The image carries neither `THIRD-PARTY-NOTICES.md` nor the licence texts
  of the packages bundled into the client, the base image's Node and Debian
  packages are not inventoried, and the opencascade.js LGPL source offer is
  not written. This blocks distribution, not intranet use.

## 0.1.0 (2026-09-23)

Initial source: parametric sketcher and solver, B-Rep features on OpenCascade
WASM, persistent topology naming, feature timeline, STEP import, STL and 3MF
export, sketch offsets and temporary timeline rewind.

- Schema 4: a sketch keeps an `offsets` list, so an offset can be edited by
  distance. The 3 to 4 migration only bumps the version.
