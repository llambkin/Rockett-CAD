# REST API

Base path: `/api`. All bodies are JSON unless noted. Types live in
`shared/src/api.ts` and `shared/src/model.ts`.

Every route is declared once in `ROUTES` in `shared/src/routes.ts`. The server
registers each handler from its entry, and the client builds each path with
`pathFor`, which URL-encodes every parameter. The client sends every call
through `request` in `client/src/api.ts`, which turns an error response into
`ApiError` with its `status` and `code`. A body without `error` and `code`
becomes code `internal`.

Route errors return `ApiErrorBody`: `{ "error": string, "code": ApiErrorCode,
"detail"?: string }`. `error` is a message for the user. The code fixes the
status:

| Code            | Status | Meaning                                                   |
| --------------- | ------ | --------------------------------------------------------- |
| `validation`    | 400    | The request, upload or feature is invalid.                |
| `not_found`     | 404    | The project, folder, feature, body or asset is missing.   |
| `too_large`     | 413    | An upload is over its limit.                              |
| `conflict`      | 409    | The request conflicts with current state.                 |
| `unprocessable` | 422    | A stored project fails validation.                        |
| `kernel`        | 503    | The geometry kernel cannot serve the request.             |
| `internal`      | 500    | Server fault. The message is generic; the log has detail. |

Mutating endpoints return `{ document, evaluation }`: the updated document
plus a fresh incremental evaluation (bodies with tagged tessellation, feature
statuses, solved sketches with profiles, construction-plane frames). The
server persists on every mutation (autosave).

Each body carries `meshKey`, a SHA-256 of its mesh, faces, edges, vertices
and bbox, without its name or visibility. The client keeps a body's viewport
objects while its key is unchanged. A JSON response of 64 KiB or more is
gzipped when the request accepts gzip.

`GET /projects/:id/evaluate`, `PUT /projects/:id/features/:fid`, and
`PUT /projects/:id/document` accept an optional `?position=N` for the returned
evaluation. This temporarily evaluates the first N features without moving the
document's saved timeline marker, for sketch editing and undo/redo in a sketch.

`GET /projects/:id/evaluate` never writes the project. A body without saved
display metadata gets the default (its name is the body id) in the response
only; mutating routes save new body metadata.

Requests targeting the same project run sequentially within one API server,
including evaluation. This prevents overlapping
feature edits from overwriting each other. Separate projects have independent
queues. Run only one server process against a data directory; these queues do
not provide cross-process locking or conflict detection for stale document
snapshots sent by different clients.

## Projects

| Method & path                  | Body                   | Returns                                                                                                                                         |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                  | none                   | `{ ok: true, version, schemaVersion, commit, describe }` (`commit` from `ROCKETT_COMMIT`, `describe` from `ROCKETT_DESCRIBE`, each else `null`) |
| `GET /projects`                | none                   | `ProjectSummary[]`                                                                                                                              |
| `POST /projects`               | `{ name?, folderId? }` | `{ document }`                                                                                                                                  |
| `GET /projects/:id`            | none                   | `{ document }`                                                                                                                                  |
| `DELETE /projects/:id`         | none                   | `{ ok }`                                                                                                                                        |
| `POST /projects/:id/duplicate` | `{ name? }`            | `{ document }` (assets copied)                                                                                                                  |
| `POST /projects/:id/rename`    | `{ name }`             | `{ document }`                                                                                                                                  |

Every stored project is listed. `status` is `ok`, `invalid` or `tooNew`, and
the last two carry `error`. Loading a project validates it after migration;
an invalid one is 422 naming the first failure.

### Project file

A project travels as one `.rockett` file, JSON of shape
`{ format: "rockett-project", version: 1, document, assets }`. `assets` maps
each asset id the document's reference images use to its bytes in base64, so
a file holds only the assets the document references.

`GET /projects/:id/file` returns the file as an attachment named after the
project: an ASCII `filename` plus a UTF-8 `filename*`.

`POST /projects/file` takes multipart field `file`, up to 64 MB, and returns
`{ document }` for a new project with a new id. An older document schema is
migrated as a saved project is on load, then the document is validated as
`PUT /projects/:id/document` validates it. Every asset must be referenced by
the document, carry a valid asset id, decode from base64 and pass the image
upload rules, and every referenced asset must be present. A file with a newer
`version` or `schemaVersion` gets 400 naming both versions. Any failure
returns 400 and creates nothing: a project half made when an asset fails is
removed.

Two optional text fields go with `file`. `folderId` places the new project in
that folder in the same write, as `POST /projects` does; a missing folder is
400 and creates nothing. `temporary` set to `true` makes a temporary project.
Any other `temporary` value is 400, and so is `temporary` with `folderId`.

### Temporary projects

A temporary project is the server copy of a project kept in the browser. It
is an ordinary project directory plus `temporary.json`,
`{ owner, touchedAt }`, with `owner` `null` until accounts own copies. Every
route that works on a project works on it. `GET /projects` leaves it out,
`PUT /projects/:id/folder` answers 400 for it, and `DELETE /projects/:id`
removes it. Any request to `/projects/:id` or a path below it refreshes
`touchedAt`, written at most once a minute. A sweep at startup and every hour
deletes temporary projects untouched for 24 hours; a request after that gets 404. A temporary project is never backed up before a migration.

## Folders

One folder tree is shared by every user. `GET /folders` returns
`{ folders: Folder[], placement }`: each folder is `{ id, name, parentId }`
with `parentId` `null` at the root, and `placement` maps a project id to its
folder id. A project missing from `placement` sits at the root. Folders live
in `folders.json`, apart from the documents, so a move never changes a
document or its `modifiedAt`.

| Method & path              | Body                   | Returns      |
| -------------------------- | ---------------------- | ------------ |
| `GET /folders`             | none                   | `FolderTree` |
| `POST /folders`            | `{ name, parentId? }`  | `{ folder }` |
| `PATCH /folders/:id`       | `{ name?, parentId? }` | `{ folder }` |
| `DELETE /folders/:id`      | none                   | `{ ok }`     |
| `PUT /projects/:id/folder` | `{ folderId }`         | `{ ok }`     |

A `null` `parentId` or `folderId` means the root. A name is 1 to 200
characters. A `parentId` or `folderId` naming a missing folder is 400, and so
is a move into the folder itself or a folder inside it. An unknown folder in
the path is 404, as is an unknown project. Deleting a folder that holds a
folder or a project is 409 and deletes nothing.

`POST /projects` with a `folderId` creates the project in that folder in one
call. A missing folder is 400 and creates nothing. Deleting a project drops
its placement.

## Model

### STEP, IGES and BREP import

`POST /projects/import-step` creates a project named from the filename.
`POST /projects/:id/import-step` inserts into an existing project's timeline
at the current marker. Both accept multipart field `file` (`.step`/`.stp`,
`.igs`/`.iges`, `.brep`, `.stl`, `.obj` or `.3mf`, maximum 10 MB) and return
`{ document, evaluation }`. Exact files must contain solid bodies. A file with
none is 400 naming its format, for example `No solid found in the IGES file.`
A mesh over 200,000 triangles is 400 with its count, for example
`The STL mesh has 200,001 triangles; the limit is 200,000.` An open mesh
imports with feature status `warning` and a `warning` message. A 3MF zip entry
that expands past 256 MB is 400. Invalid files are rejected before a new
project is kept. The source is embedded in the document; uploads that take the
document beyond 40 MB are rejected.

| Method & path                        | Body                    | Notes                                                                        |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------- |
| `GET /projects/:id/evaluate`         | none                    | Evaluate to the timeline marker; returns `EvaluateResult`                    |
| `PUT /projects/:id/document`         | `{ document }`          | Full replace (undo/redo restore); validated; 404 if project no longer exists |
| `POST /projects/:id/features`        | `{ feature }`           | Insert **at the timeline marker**; empty `name` → server assigns `Extrude2`… |
| `PUT /projects/:id/features/:fid`    | `{ feature }` (partial) | Edit parameters/name/suppressed; id immutable                                |
| `DELETE /projects/:id/features/:fid` | none                    | Marker adjusts if needed                                                     |
| `POST /projects/:id/timeline`        | `{ position }`          | Move the rollback marker                                                     |
| `PUT /projects/:id/bodies/:bodyId`   | `{ name?, visible? }`   | Body display metadata                                                        |
| `PUT /projects/:id/groups`           | `{ groups }`            | Replace the model tree groups; never changes evaluation                      |

## Inspection & output

| Method & path                | Body                                                             | Returns                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /projects/:id/measure` | `{ refs: [FaceRef\|EdgeRef\|VertexRef, …] }` (1–2)               | `MeasureResult` (distance, ΔXYZ, angle, per-item length/area/radius/position)                                                                              |
| `POST /projects/:id/export`  | `{ format: "stl"\|"3mf", bodyIds: string[], quality?, retain? }` | Binary file (`Content-Disposition` attachment). Empty `bodyIds` = all visible bodies. `retain: true` also stores a copy under the project's `exports/` dir |

Export returns 400 when an id in `bodyIds` is not a body of the evaluated
model; the error names the offending ids. `format` is required, and `stl` is
always binary. `quality` is the tessellation tolerance in mm: a number,
default 0.05, clamped to 0.001 to 1.

## Assets (reference images)

| Method & path                       | Body              | Notes                                                 |
| ----------------------------------- | ----------------- | ----------------------------------------------------- |
| `POST /projects/:id/assets`         | multipart `image` | PNG/JPEG/WebP by magic bytes, ≤ 25 MB → `{ assetId }` |
| `GET /projects/:id/assets/:assetId` | none              | Serves the image                                      |

## Validation

Routes with a JSON body outside the feature and document routes parse it
against the JSON Schema on their `ROUTES` entry in `shared/src/routes.ts`
before the handler runs. A mismatch returns 400 with the failing JSON Pointer
in `detail`, such as `/edge/bodyId`.

`server/src/api/validate.ts` bounds every modelling parameter (finite numbers,
sane ranges, entity/constraint counts) and rejects duplicate feature ids;
project/asset ids are pattern-checked against path traversal. The API exposes
controlled modelling operations only.

A feature must be a plain object with only the top-level keys its type
declares, and `suppressed` must be a boolean. An update patch must also be an
object; its keys are checked against the stored feature's type. The validator
checks profile, face, edge, plane and axis references in depth, every list
item, and each enum and flag (`operation`, extrude `direction`, emboss `mode`,
`combine`, `keepTools`, `visible`).

Every feature is parsed against its type's schema in
`shared/src/schema/features.ts`, which also checks each sketch entity and
constraint shape and requires a non-empty `name`. The declared top-level keys
are that schema's properties. A mismatch returns the JSON Pointer inside the
feature in `detail`, such as `/transform/scale`.

`PUT /projects/:id/document` also parses the document against
`documentSchema` in the same file: `schemaVersion` equals the current version,
`units` is `mm`, `cm`, `m` or `in`, `bodyMeta` values are
`{ name: string, visible: boolean }`, `counters` are non-negative integers,
`groups` have unique ids, a name of 1 to 200 characters, `kind` `body` or
`sketch`, and no member in two groups,
`createdAt` and `modifiedAt` are non-empty strings, `timelinePosition` is an
integer no greater than the feature count and `camera` has its shape when
present. Loading a saved project migrates it without validating.

Every validation failure returns 400 and nothing is saved.

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
