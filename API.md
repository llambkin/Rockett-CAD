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

| Code                    | Status | Meaning                                                   |
| ----------------------- | ------ | --------------------------------------------------------- |
| `validation`            | 400    | The request, upload or feature is invalid.                |
| `forbidden`             | 403    | The request touches another user's or session's preview.  |
| `not_found`             | 404    | The project, folder, feature, body or asset is missing.   |
| `too_large`             | 413    | An upload is over its limit.                              |
| `conflict`              | 409    | The request conflicts with current state.                 |
| `precondition_required` | 428    | A document edit arrived without `If-Match`.               |
| `unprocessable`         | 422    | A stored project fails validation.                        |
| `kernel`                | 503    | The geometry kernel cannot serve the request.             |
| `internal`              | 500    | Server fault. The message is generic; the log has detail. |

## Identity

`ROCKETT_ALLOWED_ORIGINS` lists the browser-facing origins. `GET`, `HEAD` and
`OPTIONS` may omit `Origin`. Every other `/api` request needs an `Origin`
header that exactly matches the allowed list; a missing or different value
returns 403 `{ "error": "Origin not allowed" }`, before session checking.
Auth and user routes return `{ "error": string }` on failure rather than the
CAD `ApiErrorBody` codes above. Project access errors can use those codes.

| Route                                      | Request                                                                             | Response                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/auth/status`                     | None; public                                                                        | `{ "setup": value }`, where value is `needs-token`, `ready` or `done`                                                                |
| `POST /api/auth/setup`                     | `{ token, username, displayName, password }`; public until the first account exists | 201 public `User`; 403 for an invalid token, 409 after setup                                                                         |
| `POST /api/auth/login`                     | `{ username, password }`; public                                                    | Public `User` and a session cookie; 401 for invalid credentials or a disabled account                                                |
| `POST /api/auth/logout`                    | Session cookie                                                                      | `{ "ok": true }`; revokes the session and clears its cookie                                                                          |
| `GET /api/me`                              | Session cookie                                                                      | Current public `User`                                                                                                                |
| `POST /api/me/password`                    | `{ current, next }`                                                                 | `{ "ok": true }`; replaces the password and rotates the session; 403 for a wrong current password                                    |
| `GET /api/me/friends`                      | Session                                                                             | `{ friends, incoming, outgoing }`; incoming requests include sender name, outgoing requests include destination email                |
| `POST /api/me/friends`                     | `{ email }`                                                                         | 202 `{ "ok": true }` for known and unknown addresses alike; 400 for yourself, 409 for a duplicate                                    |
| `POST /api/me/friends/requests/:id/accept` | Recipient session                                                                   | `{ "ok": true }`; accepts an incoming request                                                                                        |
| `POST /api/me/friends/requests/:id/reject` | Recipient session                                                                   | `{ "ok": true }`; rejects an incoming request                                                                                        |
| `DELETE /api/me/friends/requests/:id`      | Sender session                                                                      | `{ "ok": true }`; cancels an outgoing request                                                                                        |
| `DELETE /api/me/friends/:id`               | Friend session                                                                      | `{ "ok": true }`; removes the friendship and project or folder shares between both people                                            |
| `GET /api/me/notices`                      | Session                                                                             | `{ items }`; pending incoming friend requests and unopened project or folder shares for this user                                    |
| `POST /api/me/notices/projects/:id/open`   | Project member session                                                              | `{ "ok": true }`; clears that user's share notice after opening                                                                      |
| `POST /api/me/notices/folders/:id/open`    | Folder member session                                                               | `{ "ok": true }`; clears that user's folder share notice after opening                                                               |
| `GET /api/users`                           | Admin session                                                                       | Public `User[]`                                                                                                                      |
| `POST /api/users`                          | Admin session and `{ username, displayName, role, password, email? }`               | 201 public `User`; 409 for a duplicate username or email                                                                             |
| `PATCH /api/users/:id`                     | Admin session and any of `displayName`, `role`, `status`, `password`, `email`       | Public `User`; `email: null` clears it; disabling an account or changing its password revokes its sessions; duplicate email gets 409 |
| `GET /api/projects/:id/members`            | Owner or admin session                                                              | `{ owner, members, users }`; owners see active friends and current members, admins see active users                                  |
| `PUT /api/projects/:id/members`            | Owner or admin session and `{ owner, members: [{ userId, role }] }`                 | `{ owner, members }`; each role is `view` or `edit`; owners can add only friends, admins can add any active user                     |

`User` includes id, username, display name, role, status, optional lowercased
email and timestamps, never a password hash. When both `ROCKETT_CF_ACCESS_TEAM`
and `ROCKETT_CF_ACCESS_AUD` are set, a verified `Cf-Access-Jwt-Assertion`
can identify an existing active user by email. A plain email header is ignored;
an unmatched, disabled or unverifiable identity gets 401. Cookie login remains
available. A session or verified Access identity is required except for health,
status, setup and login; missing, expired or disabled credentials get 401 `unauthenticated`. A
signed-in non-admin gets 403 `forbidden` on user routes. A member who is not
the owner gets 403 on either members route; a user with no access to the
project gets 404. Login, setup and password change can return 429 `rate limited`
with `Retry-After` in seconds. Passwords must be 12 to 256 characters.

Mutating endpoints return `{ document, evaluation, history }`: the updated
document, a fresh incremental evaluation (bodies with tagged tessellation,
feature statuses, solved sketches with profiles, construction-plane frames)
and the project's undo state (see History). The server persists on every
mutation (autosave).

A failed feature's status may carry `refs`, one entry per face or edge
reference that did not resolve: `{ ref, status, candidates, suggestions }`,
with `status` `candidate`, `ambiguous` or `missing` and each candidate
`{ bodyId, name, basis }`, `basis` being `lineage` or `signature`. Evaluation
never writes a candidate into the document; see
[CAD_MODEL.md](CAD_MODEL.md), Resolution.

Each body carries `meshKey`, a tessellation key independent of its name and
visibility. The client keeps a body's viewport
objects while its key is unchanged. A JSON response of 64 KiB or more is
gzipped when the request accepts gzip.

Full bodies also carry `mesh: { hash, bytes }`. The hash is SHA-256 of a
UTF-8 JSON byte sequence containing `positions`, `normals`, `indices`,
`faces`, `edges`, `vertices` and `bbox`, in that order. `bytes` is its byte
length. `GET /projects/:id/meshes/:hash` returns those bytes as
`application/octet-stream` with private immutable caching. A request needs
current project access and a hash in that project's current evaluation;
otherwise it returns 404. Signing out clears the browser's HTTP cache.

A mutating request with a JSON body, `POST /projects/:id/evaluate` and
`DELETE /projects/:id/features/:fid` may carry `held`, the `meshKey`s the
client already holds (`HeldMeshes`). A body whose key is in `held` comes back as `HeldBodyPayload`,
`{ bodyId, name, meshKey }`, with no mesh, faces, edges, vertices or
bbox; every other body comes in full (`WireEvaluateResult`). Without `held`
every body comes in full. A `held` that is not an array of strings is 400
`validation` with detail `/held` or `/held/N`. `client/src/api.ts` sends the
keys of the last mutation response or whole-timeline evaluation it received,
including when it evaluates at an earlier position, and refills each omitted
body from the payloads it held when it sent that request, so its callers get
full `BodyPayload`s. Evaluate is `POST` because 1,000 keys of 64 hex
characters, about 65 KB, exceed Node's 16 KB request header limit in a URL.
Feature delete stays `DELETE` and sends `{ held }` as its JSON body.

`POST /projects/:id/evaluate`, `PUT /projects/:id/features/:fid`,
`PUT /projects/:id/document`, `POST /projects/:id/undo` and
`POST /projects/:id/redo` accept an optional `?position=N` for the returned
evaluation. This temporarily evaluates the first N features without moving the
document's saved timeline marker, for sketch editing and undo/redo in a sketch.

`POST /projects/:id/evaluate` never writes the project. A body without saved
display metadata gets the default (its name is the body id) in the response
only; mutating routes save new body metadata.

Requests targeting the same project run sequentially within one API server,
including evaluation. Separate projects have independent queues. Run only one
server process against a data directory; the queues do not lock across
processes.

### Kernel jobs

A request may include `Rockett-Job: <UUID v4>`. The server registers that
client-chosen ID before executing the route and still returns the route's normal
synchronous response. An invalid ID returns 400 `validation`; a registered ID,
including one owned by another user, returns 409 `conflict`. An overloaded job
registry returns 503 `kernel`.

`GET /jobs/:jobId/events` returns `text/event-stream`. Each message has an
`event` of `progress`, `done`, `failed` or `cancelled` and a JSON `data` object.
Progress data carries `done`, `total` and `label`. A late subscriber receives
the last 64 events, then live events; the stream closes after a terminal event.
`DELETE /jobs/:jobId` returns `{ ok: true }` and requests a soft cancel at the
next kernel boundary. Each completed feature boundary restarts a 2-second
watchdog; if none arrives before it expires, the server terminates and
restarts the worker. The cancelled request and other in-flight
kernel requests receive 503 `kernel` with `kernel restarted`. Health reports
`restarting` until the replacement is ready. Otherwise the original request
completes with its normal response, which may contain a partial evaluation.
A `cancelled` event reports `generation` as `committed` after a mutation saves
its document or `preview_discarded` when evaluation was not saved. Stopping a
worker does not roll back a prior saved generation. If the operation finishes
without stopping, the terminal event is `done`. A finished job remains
available for at most 10 minutes;
the registry keeps at most 100 finished jobs.
An unexpected worker error or exit rejects in-flight kernel requests with 503
`kernel`. The server restarts the worker after 1, 2 and 4 seconds, at most
three times in five minutes. The fourth crash leaves health `failed` until
the server is restarted. The feature running at a crash is reported as an
error on the next evaluation of that project, and dependent geometry and its
exports remain unavailable until the feature is edited.

The job belongs to the submitting user and, for a project route, that project.
An import that creates a project binds its job to the new project on creation.
If import fails and removes that project, the submitting user can still read
the job's `failed` event.
Event and cancel requests check the same user and current project membership.
Unknown, foreign and no longer accessible IDs all return
`{ "error": "job not found", "code": "not_found" }` with status 404. At most
32 requests with job IDs may be active, each job has at most 8 subscribers,
subscribers close after 2 minutes without an event, and a job that has not
finished after 10 minutes emits `failed` and requests cancellation. A
disconnected request also emits `failed` and requests cancellation. Both keep
their active slots until the route operation settles; a worker still stuck
after the 2-second watchdog is terminated before its replacement starts.

### Document revisions

The ETag of a project names its part document,
`documents/{projectId}.json`, and its `revision`, which every save raises by
one. `GET /projects/:id` and every document edit answer with
`ETag: "<revision>"`, the same value as `document.revision`. `GET /projects`
gives each readable project's `revision`.
The document and project summary carry `modifiedBy`, the ID of the user who
last saved it, or `null` for a project last saved before attribution existed.

The document edits, listed in `DOCUMENT_EDITS` in `shared/src/routes.ts`, are
rename, `PUT /document`, import into a project, the feature, timeline,
body and group routes, undo, redo, history restore and the naming upgrade commit. Each needs `If-Match: "<revision>"` with the revision
the caller last received. Inside the project queue the server compares it
with the stored document:

- no header: 428 `precondition_required`, nothing written;
- a header that is not one quoted integer: 400 `validation`;
- a different revision: 409 `conflict` with the stored `revision` in the
  error body, nothing written.

Creating, duplicating, uploading and deleting a project, placing it in a
folder, saving its view state, uploading an image and retaining an export do
not edit the document and take no `If-Match`. `client/src/api.ts` remembers
the highest revision it has received per project and sends it on every
document edit.

### History

Every document edit except the project rename saves the document and one
undo history entry; after a failure or restart the project holds both or
neither. Labels read `Add Extrude2`,
`Edit Fillet1`, `Delete Sketch3`, `Roll timeline`, `Rename Body1`,
`Edit groups`, `Import part.step`, `Replace document` and `Upgrade naming`.
The server evaluates before it saves, so names given to new bodies land in
the same entry and revision, and a failed edit writes and records nothing.
The project rename and `PUT /view` record nothing.

A document edit may send `X-Rockett-Tx: <id>`, 1 to 64 letters, digits,
underscores or dashes; any other value is 400 `validation` with nothing
written. Without it the request is its own entry. When the id matches the
latest entry's, the edit replaces that entry's snapshot and keeps its label,
so undo returns to the state before the transaction's first edit. Any other
entry in between starts a new one.

`POST /projects/:id/undo` and `POST /projects/:id/redo` take `If-Match` and
an optional `held` body, move the project's history cursor one entry back or
forward, and save the snapshot at the new cursor as the next revision. The
project keeps its current name. Nothing to undo or redo is 409 `conflict`.
An edit after an undo drops the entries that redo would have restored, and
starts a new entry even when its `X-Rockett-Tx` matches the entry before it.
A snapshot saved by an older schema is migrated before it is restored.

Every mutation response carries `history`, `{ canUndo, canRedo, undoLabel,
redoLabel }` (`HistoryStatus`), where each label is the entry undo or redo
would reverse or restore, or `null`.

`GET /projects/:id/history` lists the history as `HistoryList`:
`{ entries, position, checkpoints }`, where `entries` holds the last 50
entries oldest first, each `{ label, at, snapshot }`, `position` counts the
entries before the current state, and `checkpoints` lists every checkpoint
the same way. `POST /projects/:id/checkpoints` with `{ label }` (1 to 200
characters) names the snapshot at the current state and answers
`{ checkpoint }`. It edits no document and takes no `If-Match`; a project
with no history yet gives 400. A checkpoint keeps its snapshot through any
number of later edits. STEP sources and reference images are kept in the
project's blob store by sha256 and never deleted, so a checkpoint's sources
stay available after their features are deleted.

`POST /projects/:id/history/restore` with `{ snapshot, held? }` and
`If-Match` saves the snapshot of a listed checkpoint or entry as the next
revision and records it as one entry labelled `Restore <label>`, taking the
checkpoint's label when both hold the snapshot. Undo reverses it like any
other edit. The project keeps its current name, and any other snapshot is
404 `not_found`.

### Preview transactions

A feature add or edit with `X-Rockett-Preview: <seq>` and `X-Rockett-Tx: <tx>`
stages the edit instead of saving it. `seq` is a whole number from 1 that
rises with each preview of the transaction. The server keeps the staged
document in memory, owned by the project, the transaction id, the signed-in
user and the session, and answers with the staged document, its evaluation
and the saved `history`. The staged document keeps the revision it started
from, and the saved document, revision and history do not change. A preview
header on any other route, or without `X-Rockett-Tx`, is 400.

- The first preview must have `seq` 1 and checks `If-Match` against the saved
  revision, which becomes the transaction's base. A later preview edits the
  staged document on that base.
- A `seq` at or below the last staged one applies nothing and answers the
  staged state, so a repeated or late preview is harmless.
- A `seq` above 1 for a transaction the server does not hold is 404
  `not_found`: the transaction expired, ended or was lost in a restart.
- Another user or session gets 403 for the transaction's previews, commit
  and abort, and the transaction is kept.

`POST /projects/:id/previews/:tx/commit` with `{ held? }` saves the staged
document as the next revision with one undo entry, labelled by the
transaction's first edit, and answers like any document edit. It takes no
`If-Match`: it checks the base instead. When the project has changed since
the base, it is 409 `conflict` with the saved `revision` and the staged
document as `draft`, nothing is saved, and the transaction stays open, so a
repeat answers the same. A commit of a transaction already committed saves
nothing again and answers the saved document. A transaction the server does
not hold and history does not name is 404 `not_found`.

`DELETE /projects/:id/previews/:tx` with `{ held? }` drops the transaction and
answers the saved document and its evaluation; it never writes the document,
so another user's edit made meanwhile stays. A repeat answers the same.

Both take the optional `?position=`. Open transactions share a 256 MB budget,
counted as the serialized size of each staged document; past it the server
drops the least recently used. One left idle for an hour expires. A restart
drops them all. Nothing staged reaches the saved document without a commit.

## Projects

| Method & path                  | Body                   | Returns                                                                                                                                                                |
| ------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                  | none                   | `{ ok: true, version, schemaVersion, commit, describe, kernelVersion, kernel }` (`commit` from `ROCKETT_COMMIT`, `describe` from `ROCKETT_DESCRIBE`, each else `null`) |
| `GET /projects`                | none                   | `ProjectSummary[]`                                                                                                                                                     |
| `POST /projects`               | `{ name?, folderId? }` | `{ document }`                                                                                                                                                         |
| `GET /projects/:id`            | none                   | `{ document }`                                                                                                                                                         |
| `DELETE /projects/:id`         | none                   | `{ ok }`                                                                                                                                                               |
| `POST /projects/:id/duplicate` | `{ name? }`            | `{ document }` (blobs copied)                                                                                                                                          |
| `POST /projects/:id/rename`    | `{ name }`             | `{ document }`                                                                                                                                                         |

`kernelVersion` is `{ occt, commit }` from the loaded kernel's
`versionId()`: the OCCT release and the fork commit it was built from. It is
`null` until the kernel has loaded; health never waits for it. `kernel` is
`starting` until the kernel has loaded and `ready` after; `restarting` is
reserved for a respawned worker; `failed` means restart attempts are exhausted
or restart failed. Health answers 200 in every state.

Every stored project is listed. `status` is `ok`, `invalid` or `tooNew`, and
the last two carry `error`. A `tooNew` project also carries the
`schemaVersion` it was saved with. Loading a project validates it after
migration; an invalid one is 422 naming the first failure.

### Project file

A project travels as one `.rockett` file, JSON of shape
`{ format: "rockett-project", version: 1, document, assets }`. `assets` maps
each sha256 a reference image names in `assetId` or an `importStep` feature
names in `blob` to its bytes in base64, so a file holds only the files the
document references.

`GET /projects/:id/file` returns the file as an attachment named after the
project: an ASCII `filename` plus a UTF-8 `filename*`.

`POST /projects/file` takes multipart field `file`, up to 64 MB, and returns
`{ document }` for a new project with a new id. An older document schema is
migrated as a saved project is on load, then the document is validated as
`PUT /projects/:id/document` validates it. Every asset must be referenced by
the document and decode from base64, and its bytes must hash to its key. An
image asset also passes the image upload rules. Every referenced asset must be
present. A file from before schema 9 may key its images by their old
`<16hex>.<ext>` ids and may hold STEP sources inline; migration hashes both
and rekeys them. Before migrating, any `visible` flag the file carries on a
body in `bodyMeta` or on a sketch or reference image moves to the new
project's `view.json`, whatever the file's schema, so the stored document
holds none. A browser project opens through this route, so its record keeps
its hidden bodies and sketches too.
A file with a newer
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

One folder tree stores each user's folders and folders shared with them. `GET /folders` returns
`{ folders: Folder[], placement }`: each folder is `{ id, name, parentId, owner, members }`
with `parentId` `null` at the root, and `placement` maps a project id to its
folder id. A project missing from `placement` sits at the root. Folder members inherit access to projects in that folder and nested folders at their view or edit role; moving a project out ends that access. Folders live
in `folders.json`, apart from the documents, so a move never changes a
document or its `modifiedAt`. Version 1 folders migrate with a backup; their owner becomes null and signed-in users retain edit access until an admin claims them.

| Method & path              | Body                   | Returns                     |
| -------------------------- | ---------------------- | --------------------------- |
| `GET /folders`             | none                   | `FolderTree`                |
| `POST /folders`            | `{ name, parentId? }`  | `{ folder }`                |
| `PATCH /folders/:id`       | `{ name?, parentId? }` | `{ folder }`                |
| `DELETE /folders/:id`      | none                   | `{ ok }`                    |
| `GET /folders/:id/members` | none                   | `{ owner, members, users }` |
| `PUT /folders/:id/members` | `{ owner, members }`   | `{ owner, members }`        |
| `PUT /projects/:id/folder` | `{ folderId }`         | `{ ok }`                    |

A `null` `parentId` or `folderId` means the root. A name is 1 to 200
characters. A `parentId` or `folderId` naming a missing folder is 400, and so
is a move into the folder itself or a folder inside it. An unknown folder in
the path is 404, as is an unknown project. Deleting a folder that holds a
folder or a project is 409 and deletes nothing.

`POST /projects` with a `folderId` creates the project in that folder in one
call. A missing folder is 400 and creates nothing. Deleting a project drops
its placement.
Only an owner or admin changes a folder share. Members must be active users and friends of the owner, unless the actor is an admin. An admin can claim a folder with no owner.

## Model

### STEP, IGES and BREP import

`POST /projects/import-step` creates a project named from the filename.
`POST /projects/:id/import-step` inserts into an existing project's timeline
at the current marker. Both accept multipart field `file` (`.step`/`.stp`,
`.igs`/`.iges`, `.brep`, `.stl`, `.obj` or `.3mf`) and return
`{ document, evaluation }`. The upload streams to `uploads/` while it is
hashed. Two limits apply, each 10 MB by default: the upload limit stops the
transfer with 413 as soon as it is passed, and the import limit returns 413
before the kernel reads a file over it. A STEP, IGES or BREP source moves
from `uploads/` into the blob store once the import succeeds. A
cancelled, oversized or unreadable upload removes its own file in `uploads/`
and keeps no new project. Exact files must contain solid bodies. A file with
none is 400 naming its format, for example `No solid found in the IGES file.`
A mesh over 200,000 triangles is 400 with its count, for example
`The STL mesh has 200,001 triangles; the limit is 200,000.` An open mesh
imports with feature status `warning` and a `warning` message. A 3MF zip entry
that expands past 256 MB is 400. Invalid files are rejected before a new
project is kept. A STEP, IGES or BREP source is stored in the project's blob
store and the feature names its sha256 in `blob`; a mesh source is embedded in
the document, and uploads that take the document beyond 40 MB are rejected.

| Method & path                            | Body                    | Notes                                                                        |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `POST /projects/:id/evaluate`            | `{ held? }`             | Evaluate to the timeline marker; returns `WireEvaluateResult`                |
| `PUT /projects/:id/document`             | `{ document }`          | Full replace (undo/redo restore); validated; 404 if project no longer exists |
| `POST /projects/:id/features`            | `{ feature }`           | Insert **at the timeline marker**; empty `name` → server assigns `Extrude2`… |
| `PUT /projects/:id/features/:fid`        | `{ feature }` (partial) | Edit parameters/name/suppressed; id immutable                                |
| `DELETE /projects/:id/features/:fid`     | `{ held? }`             | Marker adjusts if needed                                                     |
| `POST /projects/:id/timeline`            | `{ position }`          | Move the rollback marker                                                     |
| `POST /projects/:id/undo`                | `{ held? }`             | Restore the snapshot before the latest entry; see History                    |
| `POST /projects/:id/redo`                | `{ held? }`             | Restore the snapshot of the next undone entry; see History                   |
| `POST /projects/:id/previews/:tx/commit` | `{ held? }`             | Save a staged preview as one entry; see Preview transactions                 |
| `DELETE /projects/:id/previews/:tx`      | `{ held? }`             | Drop a staged preview; see Preview transactions                              |
| `GET /projects/:id/history`              | none                    | `HistoryList`: entries, position and checkpoints; see History                |
| `POST /projects/:id/checkpoints`         | `{ label }`             | Name the current state; returns `{ checkpoint }`; see History                |
| `POST /projects/:id/history/restore`     | `{ snapshot, held? }`   | Restore a listed checkpoint or entry as a new, undoable entry                |
| `PUT /projects/:id/bodies/:bodyId`       | `{ name? }`             | Rename a body; any other field is 400                                        |
| `PUT /projects/:id/groups`               | `{ groups }`            | Replace the model tree groups; never changes evaluation                      |

### View state

`GET /projects/:id/view` returns the project's view state from
`projects/<id>/view.json`:
`{ version: 1, hidden: { bodies: string[], features: string[] } }`. A project
with no saved view returns empty lists. `PUT /projects/:id/view` replaces it
with a body of the same shape and echoes it back. The body is validated, with
unknown fields rejected, and a bad one is 400 with nothing written. The PUT
never edits the document, never evaluates and never raises the revision, so
it takes no `If-Match`; the last write wins. A missing project is 404. The
view stays with the project and is shared by everyone who opens it. Once
`view.json` exists, the GET and PUT touch only that file and never read the
document. A GET on a project saved before schema 11 reports the visibility its
document held. A PUT on a project with no `view.json` first migrates the
document on disk, after its backup. The migration writes the old flags only
into a missing `view.json`, so they cannot return over a saved view.

Visibility lives only in the view. Documents and evaluations carry no
`visible`. A body PUT or a feature add or patch that carries `visible` is 400.
`PUT /projects/:id/document` drops any `visible` it carries and leaves the
view unchanged.

### Settings layers

`GET /settings`, `GET /me/settings` and `GET /projects/:id/settings` return the
sparse app, signed-in user and project layers as key-value objects. Missing
files return `{}`; clients resolve registered defaults and precedence with
`resolveSettings`. `PATCH` on any of these paths takes `{ set?, reset? }` and
returns the resulting layer. GET and successful PATCH return a quoted layer
`ETag`; PATCH requires that value in `If-Match`.
Missing `If-Match` returns 428, and a stale value returns 409 without writing.
The compare and write run in the layer's serial queue. A bad patch
writes nothing and returns 400 `validation` with `errors` containing each bad
key and `/set/<key>` path. Every call needs a session. App PATCH requires an
administrator; project GET and PATCH use project access, with inaccessible or
missing projects returning 404 and read-only project access returning 403 on
PATCH.

`POST /me/settings/import` takes a plain key-value object and merges its valid
entries into the signed-in user's layer. It returns `{ applied: string[],
rejected: [{ key, reason }] }` and the new layer `ETag`. Registered keys must
pass user-scope validation. Unknown keys that match the settings key grammar
are stored unchanged, so removed plugin values survive. Omitted keys remain.
An import is limited to 1 MiB of JSON, 10,000 JSON nodes and 64 levels of nesting.

### Naming upgrade

| Method & path                              | Body          | Returns                                                     |
| ------------------------------------------ | ------------- | ----------------------------------------------------------- |
| `POST /projects/:id/upgrade-naming`        | `{ accept? }` | `NamingUpgradeProposal`: `{ backup, revision, mappings }`   |
| `POST /projects/:id/upgrade-naming/commit` | `{ accept? }` | `{ document, evaluation, backup, mappings }`, with If-Match |

These move a `namingVersion` 1 project to version 2; see
[CAD_MODEL.md](CAD_MODEL.md), Naming upgrade. Nothing else, loading and boot
included, changes a project's naming version. Both calls first back up the
complete project and name the backup in `backup`, `naming1-` and 16 hex
digits under `backups/projects/{id}/`; unchanged files reuse one backup. A
project already on version 2 is 409 `conflict`.

The stage call writes nothing else. It returns one `NamingMapping` per body
id field, face or edge reference in each feature, and per final body:
`{ featureId, path, from, status, to?, candidates, suggestions }`. `featureId`
is `null` for a final body, whose `path` is `/bodyMeta/{bodyId}` with `~` and
`/` escaped as in a JSON pointer; otherwise `path` points into the feature,
such as `/edges/0` or `/targets/1`. `from` and `to` are `NamingTarget`s,
`{ bodyId, name? }`, with `name` for a face or edge. `status` is `proven`,
`candidate`, `ambiguous` or `missing`; `to` is set when the mapping is proven
or accepted. Each candidate and suggestion is a `NamingTarget` with `basis`
`lineage` or `signature`.

`accept` is a list of `NamingDecision`s, `{ featureId, path, to }`, each
choosing the identity for one mapping. A choice must name a
body, and for a reference a face or edge of that body, in the version 2 model
before that feature; otherwise, or when it matches no mapping, the call is
400 `validation` with detail `/accept/{index}`. The stage call applies
`accept` too, so a client can show the result of its choices before it
commits.

The commit needs If-Match. It is 409 `conflict`, with nothing saved, while
any `candidate` or `ambiguous` mapping has no `to`. Otherwise it saves the
upgraded document as one edit, with the pinned `targets` and signatures, and
returns it with a fresh evaluation, the backup name and the mappings it
applied. Undo sends the previous document back through `PUT /document`.

## Inspection & output

| Method & path                | Body                                                                 | Returns                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /projects/:id/measure` | `{ refs: [FaceRef\|EdgeRef\|VertexRef, …] }` (1–2)                   | `MeasureResult` (distance, ΔXYZ, angle, per-item length/area/radius/position)                                                                                             |
| `POST /projects/:id/export`  | `{ format, bodyIds: string[], sketchId?, face?, quality?, retain? }` | Binary file (`Content-Disposition` attachment). Empty `bodyIds` = every body the view does not hide. `retain: true` also stores a copy under the project's `exports/` dir |

Export returns 400 when an id in `bodyIds` is not a body of the evaluated
model, and 422 `unprocessable` when a body it would write is blocked by a
reference that did not resolve (`namingVersion` 2 only); each error names
the offending ids. Measure returns 400 when a face or edge reference does not
resolve, naming the reference and its status. `format` is required and must
be a registered exporter's `format`; any other is 400 with detail `/format`,
naming the supported formats. The file name ends in that exporter's `ext`.
`stl` is always binary. `quality` is the tessellation tolerance in mm: a
number, default 0.05, clamped to 0.001 to 1. `step` writes each body as an
exact B-Rep solid named after the body, in millimetres, through
`writeXdeStep` in `server/src/geometry/xde.ts`, and ignores `quality`.

Each exporter has a `source`, one of `bodies`, `sketch` or `face`, or a list
of them. A `bodies` exporter writes bodies as above. A
`sketch` exporter writes the solved entities of the sketch named by
`sketchId` and ignores `bodyIds`; a missing `sketchId`, or a sketch that is
not in the evaluated model, is 400 with detail `/sketchId`. A `face`
exporter writes the edges of the planar face named by `face`, a `FaceRef`,
in the frame a sketch on that face uses; a face that is missing or not
planar is 400 with detail `/face`. An exporter with both takes the face when
the request has one, otherwise the sketch. `dxf` takes a sketch or a face:
ASCII DXF R12 (`AC1009`) in sketch plane or face frame coordinates.
Coordinates are millimetres; R12 has no unit field. Lines, arcs and circles become
`LINE`, `ARC` and `CIRCLE`, a point no curve uses becomes `POINT`, and
construction geometry goes on the `CONSTRUCTION` layer. Any other face edge,
such as a spline, becomes a `POLYLINE` sampled so the curve midpoint of each
span lies within `quality` mm of its chord.

`GET /formats` returns `Formats`: `{ exporters, importers }`. Exporters are
read from the exporter registry on each request, importers from `IMPORTERS`
in `server/src/geometry/importers.ts`. An exporter is `{ format, label, ext, mime, source }`
and an importer `{ format, label, extensions }`. Core registers the `stl`,
`3mf`, `step` and `dxf` exporters through `registerExporter` in
`server/src/geometry/exporters.ts`, which returns a disposer; the export
panel lists the `bodies` exporters it returns.

## Assets (reference images)

| Method & path                       | Body              | Notes                                                 |
| ----------------------------------- | ----------------- | ----------------------------------------------------- |
| `POST /projects/:id/assets`         | multipart `image` | PNG/JPEG/WebP by magic bytes, ≤ 25 MB → `{ assetId }` |
| `GET /projects/:id/assets/:assetId` | none              | Serves the image with its sniffed type                |

`assetId` is the sha256 of the image bytes, and the image lives in the
project's blob store. An id that is not a sha256, or names a blob that is not
an image, is 404.

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
`combine`, `keepTools`).

Every feature is parsed against its type's schema in
`shared/src/schema/features.ts`, which also checks each sketch entity and
constraint shape and requires a non-empty `name`. The declared top-level keys
are that schema's properties. A mismatch returns the JSON Pointer inside the
feature in `detail`, such as `/transform/scale`.

A face or edge reference may carry `sig`, `{ type, point, direction }`, with
`type` one of `plane`, `cylinder`, `cone`, `sphere`, `torus`, `bspline`,
`line`, `circle` or `other` and both vectors three numbers. Feature add and
update fill a missing `sig` from the model before that feature; see
[CAD_MODEL.md](CAD_MODEL.md), Reference signatures.

Extrude, revolve, sweep, loft and emboss accept `targets`, up to 10,000 unique
body ids. The evaluation reports the ids a feature used in
`featureStatuses[].targets`. Feature add writes them into a feature sent
without `targets`, leaving out bodies the project view hides. Feature update
keeps stored `targets` when the patch sends its own or changes only `name` or
`suppressed`. Any other patch without `targets` drops them and writes the ones
the edited feature now uses, leaving out hidden bodies, so a dialog edit, its
previews and a cancel store what they show. A feature that fails or is
suppressed, or whose ids pass the limit, is saved without `targets`. A Join
from a face that add or such an update writes stores its face's body first. See
[CAD_MODEL.md](CAD_MODEL.md), Tool targets.

`PUT /projects/:id/document` also parses the document against
`documentSchema` in the same file: `schemaVersion` equals the current version,
`namingVersion` is 1 or 2,
`revision` is a non-negative integer, `savedWith` is `null` or
`{ version, commit }` with `commit` a string or `null`,
`bodyMeta` values are
`{ name: string }`, `counters` are non-negative integers,
`groups` have unique ids, a name of 1 to 200 characters, `kind` `body` or
`sketch`, and no member in two groups,
`extensions` keys match `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$` and each
value is `{ version, data }` with `version` a non-negative integer and `data`
any JSON value,
`createdAt` and `modifiedAt` are non-empty strings and `timelinePosition` is an
integer no greater than the feature count. Loading a saved project migrates
it and then applies the same checks; a failure is 422 `unprocessable`.

Every validation failure returns 400 and nothing is saved.

`PUT /projects/:id/document` keeps the stored `namingVersion`. A document with
a different value gets 409 `conflict` naming the field, without `revision`,
and nothing is saved. The client sends back documents it received, so they
carry the stored value. A project that holds a naming upgrade backup is the
exception: its replace may change `namingVersion`, so undo and redo of the
upgrade work like any other edit.

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

### POST /api/projects/:id/size-limit

Read-only size query: { feature } with a fillet, chamfer or shell returns
{ kind, builds }. `upTo` carries `size`, the largest size that built valid;
`smooth` means the picked edges have no corner to blend; `none` carries
`below`, the smallest size tried, which failed; `slow` means the search ran out
of time before any build finished. The worker runs trial builds at the
`position` query parameter, or at the saved timeline position without one, and
stops after 8 builds or 1 s. The feature's own size is ignored. Invalid
features, positions and missing picks return 400; no document changes are
persisted.
