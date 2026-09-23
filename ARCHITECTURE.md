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
CAD kernel (OpenCascade 7.6 compiled to WebAssembly)
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
`opencascade.js` (OCCT 7.6) runs inside the Node process. This gives a full
B-Rep kernel (booleans, fillets, shells, sweeps, topology interrogation,
history tracking) with zero native build complexity in Docker. The runtime
image is plain `node:24-trixie-slim`. The geometry code is isolated behind
`server/src/geometry/` so it could later move to a worker thread or separate
process without touching the API; for a single-user deployment, in-process
evaluation is simple and fast (typical feature evaluation is a few ms; full
first-load regeneration of a moderate model tens of ms).

**Server owns the document.** Clients send feature-level operations
(`add/edit/delete feature`, `set timeline position`, …); the server validates,
persists (autosave on every mutation) and responds with the updated document
plus a freshly evaluated model. Undo/redo is a client-side stack of document
snapshots restored through a full-document endpoint, deliberately distinct
from the CAD timeline (see FEATURE_TIMELINE.md).

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

**Units.** All geometry is internally millimetres. `Units` on the document is
display metadata. `shared/src/units.ts` owns the conversions (`toMm`,
`fromMm`) and length and angle formatting; they never mutate stored geometry.
`LengthField` shows a length in its `units` prop and reports millimetres.
Every dialog passes `mm` today.

**Dialog form kit.** `client/src/components/form/fields.tsx` holds the dialog
inputs: `NumField`, `LengthField`, `AngleField`, `SelectField`, `AxisField`,
`CheckField` and `SelInfo`. `NumField` reports only finite values within its
`min` and `max`, so an empty or partial box never writes 0 or NaN. No other
component renders a raw number input. `DialogFooter.tsx` is the one OK and
Cancel footer. Inside its panel, Enter in an input triggers OK and Escape
triggers Cancel; feature dialogs take Escape from anywhere. A field marked `autoFocus` takes focus with its value
selected when the dialog opens, so typing replaces it.

## Security posture

- The API exposes _controlled modelling operations only_, with no arbitrary
  command execution surface.
- All modelling parameters are validated (`server/src/api/validate.ts`)
  before reaching the kernel; document/feature ids are pattern-checked.
- Project ids and asset ids are server-generated and regex-validated on every
  path access (no path traversal).
- Uploaded images are validated by magic bytes (PNG/JPEG/WebP only) and size
  capped.
- The container runs as a non-root user; the only writable path is `/data`.
- Authentication is intentionally separable: the app is single-user behind
  your reverse proxy today. All state flows through `ProjectStore`, so adding
  per-user scoping or an auth middleware (basic auth, OIDC, Cloudflare
  Access header checks) requires no changes to the CAD layers.

## Performance notes

- Regeneration is incremental (feature-snapshot cache keyed by feature JSON).
- Tessellations are cached per body-shape hash; only changed bodies re-mesh.
- Viewport work (orbit/pan/zoom, hover, drag previews) never invokes the
  kernel.
- Sketch drag solving runs locally in the browser at pointer-move rate; the
  authoritative solve happens once on commit.
