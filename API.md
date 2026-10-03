# REST API

Base path `/api`, JSON unless noted. The route tables own method, path, body
schema and the request and response types (the `route<Req, Res>` generics):

- `ROUTES`, `AUTH_ROUTES` and `DOCUMENT_EDITS` in `shared/src/routes.ts`;
- settings entries in `shared/src/settingsRoutes.ts`;
- tangent edges and reference signing in `shared/src/refRepairRoutes.ts`;
- `FRIEND_ROUTES` in `shared/src/friends.ts`, `NOTICE_ROUTES` in
  `shared/src/notices.ts`.

Wire types live in `shared/src/api.ts` and `shared/src/model.ts`. The client
builds paths with `pathFor` and sends every call through `request` in
`client/src/api.ts`. Every `ROUTES` entry is registered with its method and
nothing else is: `server/src/api/routes.ts`.

## Routes

| Route                                                                             | Handler                            |
| --------------------------------------------------------------------------------- | ---------------------------------- |
| `GET /auth/status`, `POST /auth/setup`                                            | `server/src/auth/bootstrap.ts`     |
| `POST /auth/login`                                                                | `server/src/auth/routes.ts`        |
| `POST /auth/logout`, `GET /me`                                                    | `server/src/auth/routes.ts`        |
| `POST /me/password`                                                               | `server/src/auth/routes.ts`        |
| `POST /auth/totp`, `POST /me/totp`                                                | `server/src/auth/totpRoutes.ts`    |
| `POST /me/totp/confirm`, `DELETE /me/totp`                                        | `server/src/auth/totpRoutes.ts`    |
| `GET /users`, `POST /users`, `PATCH /users/:id`                                   | `server/src/auth/users.ts`         |
| `/me/friends` and below                                                           | `server/src/auth/friendRoutes.ts`  |
| `GET /me/notices`, `POST /me/notices/*/:id/open`                                  | `server/src/auth/friendRoutes.ts`  |
| `GET`, `PATCH /settings`                                                          | `server/src/api/settingsRoutes.ts` |
| `GET`, `PATCH /me/settings`, `POST /me/settings/import`                           | `server/src/api/settingsRoutes.ts` |
| `GET`, `PATCH /projects/:id/settings`                                             | `server/src/api/settingsRoutes.ts` |
| `GET /health`                                                                     | `server/src/api/routes.ts`         |
| `GET /formats`                                                                    | `server/src/api/routes.ts`         |
| `GET /modules`                                                                    | `server/src/api/routes.ts`         |
| `GET`, `POST /projects`                                                           | `server/src/api/routes.ts`         |
| `GET`, `DELETE /projects/:id`                                                     | `server/src/api/projectRoutes.ts`  |
| `POST /projects/:id/duplicate`, `/rename`                                         | `server/src/api/projectRoutes.ts`  |
| `GET`, `PUT /projects/:id/members`                                                | `server/src/api/projectMembers.ts` |
| `GET /projects/:id/file`, `POST /projects/file`                                   | `server/src/api/projectFile.ts`    |
| `POST /projects/import`, `/projects/:id/import`                                   | `server/src/api/importRoutes.ts`   |
| `PUT /projects/:id/parameters`                                                    | `server/src/api/documentRoutes.ts` |
| `POST /projects/:id/evaluate`                                                     | `server/src/api/geometryRoutes.ts` |
| `GET /projects/:id/meshes/:hash`                                                  | `server/src/api/meshRoute.ts`      |
| `GET /jobs/:jobId/events`, `DELETE /jobs/:jobId`                                  | `server/src/api/jobRoutes.ts`      |
| `POST /projects/:id/features`                                                     | `server/src/api/routes.ts`         |
| `PUT`, `DELETE /projects/:id/features/:fid`                                       | `server/src/api/routes.ts`         |
| `POST /projects/:id/features/:fid/project`, `/signature`                          | `server/src/api/routes.ts`         |
| `POST /projects/:id/timeline`                                                     | `server/src/api/routes.ts`         |
| `POST /projects/:id/undo`, `/redo`                                                | `server/src/api/routes.ts`         |
| `POST /projects/:id/previews/:tx/commit`, `DELETE /projects/:id/previews/:tx`     | `server/src/api/routes.ts`         |
| `GET /projects/:id/history`, `POST /projects/:id/checkpoints`, `/history/restore` | `server/src/api/historyRoutes.ts`  |
| `DELETE /projects/:id/checkpoints`                                                | `server/src/api/historyRoutes.ts`  |
| `PUT /projects/:id/bodies/:bodyId`                                                | `server/src/api/routes.ts`         |
| `PUT /projects/:id/groups`                                                        | `server/src/api/routes.ts`         |
| `POST /projects/:id/upgrade-naming`, `/commit`                                    | `server/src/api/routes.ts`         |
| `POST /projects/:id/maintenance/gc`                                               | `server/src/api/routes.ts`         |
| `GET`, `PUT /projects/:id/thumbnail`                                              | `server/src/api/routes.ts`         |
| `GET`, `PUT /projects/:id/view`                                                   | `server/src/api/routes.ts`         |
| `POST /projects/:id/tangent-edges`                                                | `server/src/api/routes.ts`         |
| `POST /projects/:id/size-limit`                                                   | `server/src/api/routes.ts`         |
| `POST /projects/:id/measure`                                                      | `server/src/api/measureRoutes.ts`  |
| `POST /projects/:id/export`                                                       | `server/src/api/routes.ts`         |
| `POST /projects/:id/assets`, `GET /projects/:id/assets/:assetId`                  | `server/src/api/routes.ts`         |
| `/folders` and below, `PUT /projects/:id/folder`                                  | `server/src/api/folderRoutes.ts`   |

## Errors

Project, folder, settings and job routes answer `ApiErrorBody`
(`shared/src/api.ts`). `STATUS` in `server/src/api/apiErrors.ts` fixes the
status for each `code`. `internal` is 500 with a generic message; the log has
the detail. A 409 on a document edit carries the stored `revision`, and on a
preview commit also the staged `draft`. `client/src/api.ts` turns any error
into `ApiError`; a body without `code` becomes `internal`.

An unknown `/api` path answers 404 `not_found`, malformed JSON 400
`validation` and a body over its size limit 413 `too_large`.

These answer `{ "error": string }` without `code`: the origin check, the
session guard (401 `unauthenticated`), the 403 `forbidden` from the project
access guard, `requireAdmin` and the members routes, the rate limiter (429
`rate limited` with `Retry-After` in seconds), and the auth, user, friend and
notice routes.

## Identity

- A request that is not `GET`, `HEAD` or `OPTIONS` needs an `Origin` listed in
  `ROCKETT_ALLOWED_ORIGINS`, checked before the session:
  `server/src/auth/origin.ts`.
- `PUBLIC_ROUTES` in `server/src/auth/middleware.ts` need no session. Every
  other route needs a session cookie or, when `ROCKETT_CF_ACCESS_TEAM` and
  `ROCKETT_CF_ACCESS_AUD` are set, a verified `Cf-Access-Jwt-Assertion` whose
  email matches an active user: `server/src/auth/cfAccess.ts`.
- `GET /health` returns only `{ ok: true }` without a full signed-in identity.
  Build, schema and kernel diagnostics require that identity; health stays
  available to anonymous and step-session callers.
- Admins must use TOTP; members may opt in. A sign-in that needs a code or
  enrolment gets a step session limited to `STEP_ROUTES` in
  `server/src/auth/middleware.ts`.
- Sessions end after `auth.sessionDays` or `auth.sessionMaxDays` unused
  (`shared/src/settings.ts`): `server/src/auth/sessions.ts`.
- Login takes a username or an email in any case; both names share one
  failure limit: `server/src/auth/userStore.ts`, `server/src/auth/rateLimit.ts`.
- Password policy: `server/src/auth/password.ts`.
- A public `User` never carries a password hash or TOTP secret:
  `toPublicUser` in `server/src/auth/userStore.ts`.
- User routes and blob collection are admin only. Project members routes need
  the owner or an admin. Anyone without project access gets 404, not 403. A
  `view` member may only read, plus the routes in `VIEWER_WRITES`
  (`server/src/api/projectAccess.ts`).
- Folder members inherit their role on the folder's projects: `folderRole`
  in `server/src/api/projectAccess.ts`.

## Document revisions

A project's `ETag` is `"<revision>"`, equal to `document.revision`; every
save raises it by one. Every route in `DOCUMENT_EDITS`, and every route
module mutation, needs `If-Match: "<revision>"`, checked inside the project
queue: missing is 428, malformed is 400, stale is 409, and none writes:
`server/src/api/revision.ts`. Other writes (view, thumbnail, checkpoints,
folders, members, settings, assets, export `retain`) take no revision.
Project deletion also requires the revision shown in the project list; a stale
request leaves the project intact. Unreadable projects list a `deleteTag`, a
quoted SHA256 of the stored document bytes. An unreadable manifest also binds
its stored bytes into the tag; only an admin may delete such a project. Deletion
needs that exact tag and refuses changed or now-readable contents. Storage
failures refuse listing and deletion. Temporary cleanup needs no revision.

## History

Every document edit except a project rename saves the document and one
labelled undo entry together. An edit that fails before its document file
lands writes nothing. One that fails after it lands keeps the edit and its
entry and answers 500 `kept`, never `internal`; the client then reloads the
project, so the edit shows and Undo names it:
`server/src/api/projectMutations.ts`, `client/src/store.ts`. Edits sharing an
`X-Rockett-Tx` (`TX_HEADER`) fold into the latest entry. Undo, redo and
restore are document edits; nothing to undo or redo is 409:
`server/src/store/historyStore.ts`. Entries and checkpoints carry `by`, the
signed-in user's id; the history list and a new checkpoint add `byName`. Both
are absent on older entries. Checkpoints keep their snapshots and blobs:
`server/src/store/blobGc.ts`. Checkpoints have a bound far above real use (see
Limits); one more is 409 with a plain message and keeps the rest.
`DELETE /projects/:id/checkpoints` with a listed checkpoint's `label`, `at` and
`snapshot` removes it and rewrites the log without snapshots nothing else
holds, so blobs nothing else references become collectable; an unknown
checkpoint is 404.

The log stores each feature once, keyed by the SHA256 of its JSON, and each
snapshot as the document with its features replaced by those keys:
`server/src/store/historyLog.ts`. A snapshot's hash is the SHA256 of that
form. Entries have no count limit. A project's log has a disk byte budget
(see Limits). Past it, the log drops its oldest entries until it fits in
what checkpoints, the current state and redo entries take, plus half the rest
of the budget. Those always stay, and so does one undo step while the log
still fits the budget. A version 2 log, one whole gzipped document per
snapshot, is backed up as `history2-<hash>` and rewritten on first open:
`server/src/store/historyUpgrade.ts`. A snapshot it cannot read is dropped
with its checkpoints, and undo steps over the gap; with none readable, history
starts again at the next edit. Snapshot hashes change then; a restore naming
an old hash is 404.

A feature add or edit with `X-Rockett-Preview` (`PREVIEW_HEADER`) and
`X-Rockett-Tx` stages the edit in memory for that user and session instead of
saving it. Only the preview commit route saves it. A restart drops open
previews: `Previews` in `server/src/api/routes.ts`.

Parameter and expression associations update together through
`PUT /projects/:id/parameters` with `parameters` and `parameterBindings`.
The document revision header is required; feature preview transaction headers
also apply. Successful edits regenerate dependent geometry and create one history
entry. Invalid names, cycles, numeric bounds or conflicting dimensions refuse the
edit before saving. Project files, history and reopen preserve associations.
`PUT /projects/:id/features/:fid` may also carry the whole `parameterBindings`
list, so a sketch edit that renumbers its constraints saves the moved bindings
in the same edit.

## Evaluation

- Mutations answer `WireMutationResponse` (`shared/src/routes.ts`).
- A request may send `held` (`HeldMeshes`); a body whose `meshKey` is held
  comes back as `HeldBodyPayload`: `server/src/api/heldMeshes.ts`.
- Stored sketch points are the model. A feature add or edit solves a sketch
  once when it adds or changes a constraint its points do not meet, and
  otherwise stores the points as sent. Evaluation re-solves a sketch only when
  a projected source moves: `editedEntities` in `shared/src/solver.ts`.
- `?position=N` evaluates the first N features without moving the saved
  marker: `evaluationPosition` in `server/src/api/routes.ts`.
- Mesh bytes come from the mesh route only for a hash in the project's current
  evaluation: `server/src/api/meshRoute.ts`.
- JSON responses from `GZIP_FROM_BYTES` up are gzipped when accepted:
  `server/src/api/gzipJson.ts`.
- Requests for one project run in order; projects run independently:
  `server/src/store/projectQueue.ts`. The queue does not lock across
  processes, so run one server per data directory.

### Kernel jobs

A request may send `Rockett-Job: <UUID v4>` to follow its kernel work at the
job events route (`text/event-stream`) or cancel it. Jobs belong to the
submitting user and project; anyone else gets 404. A worker that misses the
cancel watchdog is restarted and in-flight kernel requests get 503 `kernel`:
`server/src/kernel/jobs.ts`, `server/src/kernel/workerKernel.ts`.

## Naming upgrade

Stage and commit move a `namingVersion` 1 project to 2; nothing else changes
the naming version. Both back up the project first and name the backup. The
commit needs `If-Match` and is 409 while a `candidate` or `ambiguous` mapping
has no choice. A project already on version 2 is 409. Stage gives each
candidate and suggestion a `mesh` from the version 2 evaluation at its
mapping's position: a face or body index range, or an edge polyline, with the
body's `bbox`, so the client finds it in the version 1 mesh it shows. Types:
`NamingUpgradeProposal`, `NamingMapping` and `NamingDecision` in
`shared/src/api.ts`. Code: `server/src/store/namingUpgrade.ts`. Model rules:
[CAD_MODEL.md](CAD_MODEL.md), Naming upgrade.

## View state

Each user has their own view of a project (`projectView` in
`shared/src/routes.ts`), with its own `ETag`; a stale `If-Match` is 409.
Saving a view never edits the document, evaluates or raises the revision.
Visibility lives only in the view: a document edit carrying `visible` is 400.
Code: `server/src/store/viewStore.ts`.

## Settings layers

App, user and project layers are sparse; clients resolve defaults with
`resolveSettings` (`shared/src/settings.ts`). `PATCH` needs the layer `ETag`
in `If-Match`. App writes need an admin; project layers use project access:
`server/src/api/settingsRoutes.ts`. Import keeps unknown keys that match the
key grammar, so removed plugin values survive:
`server/src/store/settingsStore.ts`.

## Inspection & output

- `format` must name a registered exporter; `GET /formats` lists the exporter
  and importer registries.
- Export refuses a body blocked by an unresolved reference (`namingVersion` 2)
  with 422 `unprocessable`, and an id that is not a body with 400.
  Measure answers 400 for a body or name the live evaluation lacks.
- Writers: `server/src/geometry/exporters.ts`, `server/src/geometry/xde.ts`
  (STEP), `server/src/geometry/dxf.ts`.

## Extension points

- `registerRouteModule` (`server/src/api/routeModules.ts`) mounts project
  routes behind the access guard and project queue. `projectMutation` needs
  `If-Match`. A non-core module id `<moduleId>.<name>` must mount under
  `/projects/:id/m/<moduleId>/`, or mounting throws.
- `registerExporter` (`server/src/geometry/exporters.ts`) and
  `registerImporter` (`server/src/api/importers.ts`) return a disposer.
- Document `extensions` (`shared/src/model.ts`) survive upload, edits and
  reload. Blob collection skips a project that holds them:
  `server/src/store/blobGc.ts`.

## Modules

`GET /modules` returns one `ModuleInfo` (`shared/src/api.ts`) per listed
module, in load order:

```json
[
  {
    "id": "acme",
    "name": "Acme",
    "version": "1.2.3",
    "licence": "MIT",
    "author": "Acme Ltd",
    "status": "loaded",
    "error": null
  }
]
```

- `status` is `loaded`, `failed`, `incompatible` or `disabled`.
- `error` is null for `loaded`. Otherwise it is the manifest error, the
  thrown registration or activation message, or the plugin API range reason.
- `server/src/modules/host.ts` loads every module before the router mounts
  route modules. A module that throws during activation keeps none of its
  registrations; the others still load.
- A manifest that fails `parseManifest` reports `failed` with whichever of
  its identity fields are strings; the rest are empty.
- `activate` receives `ServerContext` (`plugin-api/src/index.ts`):
  `register` and `startKernelJob`. `register.routeModule` and
  `register.kernelJob` take `plugin-api` types; `exporter`, `importer`,
  `featureKind` and `extensionSpec` still take core types. Each call is
  tracked under the module's one disposer.
- A route module's `projectRoute` and `projectMutation` handlers get
  `params` from the route path and `body` as the route's request type when
  it has a body schema, `unknown` without one. Every route module receives
  `kernel` at runtime, but only the core `ModuleApi` type declares it.
- `register.kernelJob(id, entry)` registers a kernel job: `id` starts with
  the module id and a dot, and `entry` is the URL of a file whose default
  export, from `defineKernelJobs`, holds the job under that id.
- `startKernelJob(id, input, { onProgress, signal })` runs one of the
  module's own jobs in the kernel worker and resolves to its result. A job is
  synchronous; one that returns a promise is refused. The job
  receives the OCCT instance, `own` for every handle it makes and
  `progress(done, total, label)`. Its handles are freed when it returns,
  throws or is cancelled; an aborted signal cancels it at its next
  `progress` call.
- After sign-in, `client/src/modules/host.ts` activates the client part of
  each listed module that this route reports `loaded`, with `ClientContext`:
  `register` and `project`. `register.command`, `toolbarGroup`, `panel` and
  `workbench` take `plugin-api` types; `selectionKind` and `pickProvider`
  still take core types. Activation is atomic as on the server. A command
  `Control` and a workbench `tree` and `bar` draw inside the panel error
  boundary.
- A workbench's optional `tree` draws in the left dock and `bar` in the
  timeline row, in place of the model tree and timeline. The view toolbar
  group shows at the right end of every workbench.
- `project.get()` returns `{projectId, document}` for the open project,
  the same object until either changes; `project.subscribe(listener)` calls
  the listener on each change and returns its disposer. Both fit
  `useSyncExternalStore`.

## Project file

A `.rockett` file is `ProjectFile` in `shared/src/projectFile.ts`. Upload migrates
an older schema, validates, and rejects a newer `version` or `schemaVersion`
with 400; any failure creates nothing: `server/src/api/projectFile.ts`. A
stored project with a newer schema is listed as `tooNew`, and an invalid one
is 422 on load: `server/src/store/projectStore.ts`, which also owns temporary
projects.

Imports and project files stream to disk under `uploads/`. A file over the
import budget is 413 before it is read: `server/src/api/uploads.ts`. Imported
STEP and mesh sources live in the project blob store; the feature holds the
hash in `blob`, and `GET /projects/:id/assets/:assetId` serves any project
blob, so a `.rockett` file and a browser project carry them as assets.

## Validation

- A route with a `body` schema parses it before the handler; a mismatch is
  400 with the failing JSON Pointer in `detail`: `parseBody` in
  `server/src/api/routes.ts`.
- Features are checked by `validateFeature` in `server/src/api/validate.ts`
  through their registered `FeatureSpec` (`shared/src/featureSpec.ts`); an
  unregistered type is 400 `unknown feature type <type>`. Core schemas and
  `documentSchema` live in `shared/src/schema/features.ts`.
  `registerExtensionSpec` builds a dotted type's spec from its `params`
  schema and `version`; a feature at another version is 400.
- Feature add and update fill a missing reference `sig` from the model
  (`server/src/geometry/signature.ts`). They also write `targets`, leaving
  out bodies the caller's view hides: `server/src/api/routes.ts`. See
  [CAD_MODEL.md](CAD_MODEL.md), Tool targets.
- A validation failure writes nothing.

## Limits

| Limit                                 | Owner                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| JSON request body                     | `JSON_BODY_LIMIT_BYTES`, `server/src/api/uploads.ts`                                |
| Import and project file upload, disk  | `ROCKETT_UPLOAD_MAX_MB`, `IMPORT_LIMITS` in `server/src/tunables.ts`                |
| Import and project file read, heap    | `ROCKETT_IMPORT_BUDGET_MB`, `IMPORT_LIMITS` in `server/src/tunables.ts`             |
| Mesh import triangles                 | `MAX_MESH_TRIANGLES`, `server/src/geometry/importers.ts`                            |
| 3MF expanded entry                    | `server/src/geometry/read3mf.ts`                                                    |
| Browser project file                  | `PROJECT_FILE_LIMIT_MB`, `shared/src/projectFile.ts`                                |
| Thumbnail                             | `THUMBNAIL_LIMITS`, `shared/src/routes.ts`                                          |
| Reference image                       | `IMAGE_LIMIT_MB`, `server/src/store/projectStore.ts`                                |
| History labels                        | `LABEL_LIMIT`, `shared/src/schema/history.ts`                                       |
| History disk bytes, checkpoints       | `HISTORY_LIMITS.bytes`, `HISTORY_LIMITS.checkpoints`, `server/src/tunables.ts`      |
| Tool targets                          | `MAX_TARGETS`, `shared/src/schema/features.ts`                                      |
| Previews, jobs, timeouts, size search | `server/src/tunables.ts`                                                            |
| Settings import                       | `SETTINGS_IMPORT_MAX_BYTES`; nodes and depth in `server/src/store/settingsStore.ts` |
