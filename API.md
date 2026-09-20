# REST API

Base path: `/api`. All bodies are JSON unless noted. Errors return
`{ "error": string }` with an appropriate 4xx/5xx status. Types live in
`shared/src/api.ts` and `shared/src/model.ts`.

Mutating endpoints return `{ document, evaluation }` — the updated document
plus a fresh incremental evaluation (bodies with tagged tessellation, feature
statuses, solved sketches with profiles, construction-plane frames). The
server persists on every mutation (autosave).

`GET /projects/:id/evaluate`, `PUT /projects/:id/features/:fid`, and
`PUT /projects/:id/document` accept an optional `?position=N` for the returned
evaluation. This temporarily evaluates the first N features without moving the
document's saved timeline marker, for sketch editing and undo/redo in a sketch.

Requests targeting the same project run sequentially within one API server,
including evaluation (which can save body metadata). This prevents overlapping
feature edits from overwriting each other. Separate projects have independent
queues. Run only one server process against a data directory; these queues do
not provide cross-process locking or conflict detection for stale document
snapshots sent by different clients.

## Projects

| Method & path | Body | Returns |
| --- | --- | --- |
| `GET /health` | – | `{ ok: true }` |
| `GET /projects` | – | `ProjectSummary[]` |
| `POST /projects` | `{ name }` | `{ document }` |
| `GET /projects/:id` | – | `{ document }` |
| `DELETE /projects/:id` | – | `{ ok }` |
| `POST /projects/:id/duplicate` | `{ name? }` | `{ document }` (assets copied) |
| `POST /projects/:id/rename` | `{ name }` | `{ document }` |

## Model

### STEP import

`POST /projects/import-step` creates a project named from the filename.
`POST /projects/:id/import-step` inserts into an existing project's timeline
at the current marker. Both accept multipart field `file` (`.step`/`.stp`,
maximum 10 MB) and return `{ document, evaluation }`. Files must contain solid
bodies. Invalid files are rejected before a new project is created. The STEP
source is embedded in the document; uploads that take the document beyond
40 MB are rejected.

| Method & path | Body | Notes |
| --- | --- | --- |
| `GET /projects/:id/evaluate` | – | Evaluate to the timeline marker; returns `EvaluateResult` |
| `PUT /projects/:id/document` | `{ document }` | Full replace (undo/redo restore); validated; 404 if project no longer exists |
| `POST /projects/:id/features` | `{ feature }` | Insert **at the timeline marker**; empty `name` → server assigns `Extrude2`… |
| `PUT /projects/:id/features/:fid` | `{ feature }` (partial) | Edit parameters/name/suppressed; id immutable |
| `DELETE /projects/:id/features/:fid` | – | Marker adjusts if needed |
| `POST /projects/:id/timeline` | `{ position }` | Move the rollback marker |
| `PUT /projects/:id/bodies/:bodyId` | `{ name?, visible? }` | Body display metadata |

## Inspection & output

| Method & path | Body | Returns |
| --- | --- | --- |
| `POST /projects/:id/measure` | `{ refs: [FaceRef\|EdgeRef\|VertexRef, …] }` (1–2) | `MeasureResult` (distance, ΔXYZ, angle, per-item length/area/radius/position) |
| `POST /projects/:id/export` | `{ format: "stl"\|"3mf", bodyIds: string[], quality?, retain? }` | Binary file (`Content-Disposition` attachment). Empty `bodyIds` = all visible bodies. `retain: true` also stores a copy under the project's `exports/` dir |

## Assets (reference images)

| Method & path | Body | Notes |
| --- | --- | --- |
| `POST /projects/:id/assets` | multipart `image` | PNG/JPEG/WebP by magic bytes, ≤ 25 MB → `{ assetId }` |
| `GET /projects/:id/assets/:assetId` | – | Serves the image |

## Validation

`server/src/api/validate.ts` bounds every modelling parameter (finite numbers,
sane ranges, entity/constraint counts) and rejects duplicate feature ids;
project/asset ids are pattern-checked against path traversal. The API exposes
controlled modelling operations only.

## WebSockets

Not used. Evaluation is fast enough to return synchronously for single-user
loads; the response envelope (`document + evaluation`) is designed so a future
job/progress channel can slot in without breaking clients.

### POST /api/projects/:id/features/:fid/project

Read-only projection preparation for a sketch. Body: { edge: EdgeRef, entityId: string }.
Returns { entities: SketchEntity[] } with stable generated IDs and source references.
Resolves source geometry before the target sketch; downstream or unsupported
geometry returns 400. Persist the returned entities using the normal feature
update endpoint, which also provides undo/redo integration in the client.

### POST /api/projects/:id/tangent-edges

Read-only chain query: { edge: EdgeRef, beforeFeatureId?: string } returns
{ edges: EdgeRef[] }. An edit supplies beforeFeatureId to resolve its inputs
before the feature. Source errors return 400; no document changes are persisted.
