# Architecture

Rockett CAD follows the layered architecture the project brief prescribes: the
rendered triangle mesh is only a _visualisation_ of the CAD model. The
authoritative geometry is always the B-Rep model produced by the OpenCascade
kernel from the parametric document.

```
Browser UI (React)
   ↓ selection, tool state, dialogs
3D viewport / interaction layer (three.js)
   ↓ REST (JSON)
Parametric document / model representation (shared TypeScript schema)
   ↓
Geometry service (Node.js, regeneration engine + caches)
   ↓
CAD kernel (OpenCascade 8.0.1 compiled to WebAssembly)
   ↓
B-Rep model (TopoDS solids, faces, edges, vertices)
```

## Repository layout

| Path      | Role                                                                                                                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/` | The document schema (`model.ts`), the sketch constraint solver (`solver.ts`), profile/region detection (`profiles.ts`), API DTOs (`api.ts`), the route table (`routes.ts`), units (`units.ts`), modelling tolerances (`tolerance.ts`) and rigid placements (`placement.ts`). Runs identically in browser and server. |
| `server/` | Express REST API, project store, and the geometry layer: kernel bootstrap, feature evaluators, persistent-naming, regeneration engine, tessellation, exporters, measurement.                                                                                                                                         |
| `client/` | React + three.js UI: viewport, sketcher, timeline, model tree, feature dialogs. `api.ts` sends every call through one `request`; `components/form/` holds the dialog fields and footer; `three/` holds shared disposal, screen projection and the `Manipulator` gizmo base.                                          |
| `docker/` | Unraid template.                                                                                                                                                                                                                                                                                                     |

## Key decisions

**Kernel: OpenCascade via WASM, hosted server-side.**
`opencascade.js` (OCCT 8.0.1) runs inside the Node process. This gives a full
B-Rep kernel (booleans, fillets, shells, sweeps, topology interrogation,
history tracking) with zero native build complexity in Docker. The runtime
image is plain `node:24-trixie-slim`. The geometry code lives in
`server/src/geometry/`, and the API reaches it only through the `KernelClient`
in `server/src/kernel/client.ts`, so it can move to a worker thread without
touching the routes. The server uses `WorkerKernel`, which runs the engine in
one `worker_threads` worker (`server/src/kernel/worker.ts`, bundled as
`kernel-worker.mjs`), so a long regeneration leaves the main thread free to
answer requests and `/api/health`. `ROCKETT_KERNEL=inprocess` selects
`InProcessKernel`, which runs the same engine on the main thread. Typical
feature evaluation is a few ms; full first-load regeneration of a moderate
model tens of ms.
The main thread keeps the last feature start without a matching progress event
for each in-flight evaluation. After a worker crash it quarantines that feature
by project, feature ID and feature key; regeneration skips that exact version,
blocks its dependents and refuses exports using affected geometry. An edited
feature is retried. Worker restarts use three attempts in five minutes with
1, 2 and 4 second backoff, then stop until the server is restarted.

**Server owns the document.** Clients send feature-level operations
(`add/edit/delete feature`, `set timeline position`, …); the server validates,
persists (autosave on every mutation) and responds with the updated document
plus a freshly evaluated model. Undo/redo is server history (API.md, History),
deliberately distinct
from the CAD timeline (see FEATURE_TIMELINE.md). What is hidden is view state,
not document: the client keeps it, with the camera, in a `view` slice and
saves it with `PUT /view` and the view's last `ETag`, outside undo and
evaluation. The client drops a `W/` prefix a proxy adds to an `ETag`, so the
tag it sends back is the one the server issued. Visibility saves at once and
the camera 1 s after it settles; a 409 takes the server's view and drops the
pending save. A null camera opens zoomed to fit. Every document edit names the
revision it last read, and a stale one gets 409 with nothing written (see
API.md, Document revisions). Every document edit except a project rename runs
through `mutateProject` in `server/src/api/routes.ts`: it checks the revision,
applies the edit, evaluates, names new bodies, then saves the document with
one labelled history entry (see API.md, History).

**Storage.** `server/src/store/` owns persistence. `Storage` reads, stamps,
writes atomically, appends, moves, lists and removes paths under the data
root, and `LocalStorage` is its one implementation. A stamp is a file's inode, size and
change times. `JsonStore` keeps one namespace of JSON files, queues writes per
key and migrates each file on read through its `Migrations` table. Before a
migrated file is first written, it backs up the file's whole directory; a
temporary project gets no backup. It remembers the stamp of each file it last
read or wrote at the current version and place, and for a document its
revision, so saving an unchanged file reads nothing; any other change to the
file moves its stamp and the next save reads it again. `BlobStore` keeps
a project's source files and images by sha256. `ProjectStore` assembles a
project from its `project.json` manifest (`ManifestStore`), its part
document and blobs; `ViewStore` keeps each user's view of a project. `HistoryStore` keeps a project's undo
history in `history/log.bin`, an append-only log of records: the base
snapshot, labelled entries with their revision and checkpoints. Snapshots are
gzip documents named by the sha256 of their stored bytes. The history is the
last 50 entries, the state before the oldest and every checkpoint. A history
save appends one entry record, fsyncs it, then writes the document
atomically. On open, a torn last record is dropped, and so is a last entry
whose revision the document never reached, so a failure or restart leaves
the old or the new generation. Once 50 snapshots are unused, the log is
rewritten without them after the save that found them.
DOCKER.md shows the layout on disk and the backup and restore rules.

**Shared parametric code.** The constraint solver and profile detection are
plain TypeScript used by _both_ sides: the browser solves interactively while
dragging sketch geometry; the server re-solves authoritatively during
regeneration. There is exactly one implementation of each, so they cannot
drift.

**Two-tier interactivity.** Cheap interactive feedback (sketch drag solving,
profile highlighting, selection) happens client-side; committed CAD operations
run through the kernel. The engine caches per-feature snapshots and
tessellations so an edit to feature _k_ re-evaluates only features _k..end_
(see CAD_MODEL.md, "Regeneration").

**Units.** All geometry is internally millimetres. The `units.length`
setting in `shared/src/settings.ts` is the only owner of the display unit.
`shared/src/units.ts` owns the conversions (`toMm`, `fromMm`), length parsing
(`parseLength`) and length and angle formatting; they never mutate stored
geometry. `LengthField` shows and parses a length in its `units` prop and
reports millimetres. Every dialog passes the resolved `units.length`.

**Dialog form kit.** `client/src/components/form/fields.tsx` holds the dialog
inputs: `NumField`, `LengthField`, `AngleField`, `SelectField`, `AxisField`,
`CheckField` and `SelInfo`. `NumField` reports only finite values within its
`min` and `max`, so an empty or partial box never writes 0 or NaN. No other
component renders a raw number input. `DialogFooter.tsx` is the one OK and
Cancel footer. Inside its panel, Enter in an input triggers OK and Escape
triggers Cancel; feature dialogs take Escape from anywhere. A field marked `autoFocus` takes focus with its value
selected when the dialog opens, so typing replaces it.

## Identity

The API middleware order in `server/src/app.ts` is origin check, session,
router. The origin check rejects a state-changing request without an allowed
`Origin` before authentication or route handling. The session middleware
allows health, setup, status and login through; other routes need an active
user. The auth router handles accounts and sessions, then the CAD router
checks project access before operating on a project.

## Security posture

- The API exposes _controlled modelling operations only_, with no arbitrary
  command execution surface.
- All modelling parameters are validated (`server/src/api/validate.ts`)
  before reaching the kernel; document/feature ids are pattern-checked.
- Project ids are server-generated, asset ids are the sha256 of their bytes,
  and both are regex-validated on every path access (no path traversal).
- Uploaded images are validated by magic bytes (PNG/JPEG/WebP only) and size
  capped.
- The container runs as a non-root user; the only writable path is `/data`.
- Accounts use scrypt password hashes under `/data/users` and HttpOnly session
  cookies. Project owners and members determine access to saved projects.

## Performance notes

- Regeneration is incremental (feature-snapshot cache keyed by feature JSON).
- The server keeps engines for the 8 most recently used projects. An engine
  keeps the verified bytes of the STEP blobs its document references, so an
  edit reads no blob. Evicting one releases its snapshot shapes and those
  bytes; its next evaluation rebuilds from scratch.
- Tessellations are cached per body id and shape hash, bounded at 256 MB
  across engines; only changed bodies re-mesh. A rename or visibility change
  does not.
- Encoded body meshes have a separate 256 MB main-thread LRU. Its project
  index is bounded and rebuilt from the current evaluation on a miss.
- Viewport work (orbit/pan/zoom, hover, drag previews) never invokes the
  kernel.
- Sketch drag solving runs locally in the browser at pointer-move rate; the
  authoritative solve happens once on commit.
