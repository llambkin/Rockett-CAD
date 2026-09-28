# REST API

Base path `/api`, JSON unless noted. The route tables own method, path, body
schema and the request and response types (the `route<Req, Res>` generics):

- `ROUTES`, `AUTH_ROUTES` and `DOCUMENT_EDITS` in `shared/src/routes.ts`;
- settings entries in `shared/src/settingsRoutes.ts`;
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
| `GET`, `POST /projects`                                                           | `server/src/api/routes.ts`         |
| `GET`, `DELETE /projects/:id`                                                     | `server/src/api/routes.ts`         |
| `POST /projects/:id/duplicate`, `/rename`                                         | `server/src/api/routes.ts`         |
| `GET`, `PUT /projects/:id/members`                                                | `server/src/api/projectMembers.ts` |
| `GET /projects/:id/file`, `POST /projects/file`                                   | `server/src/api/projectFile.ts`    |
| `POST /projects/import`, `/projects/:id/import`                                   | `server/src/api/routes.ts`         |
| `POST /projects/:id/evaluate`                                                     | `server/src/api/routes.ts`         |
| `GET /projects/:id/meshes/:hash`                                                  | `server/src/api/meshRoute.ts`      |
| `GET /jobs/:jobId/events`, `DELETE /jobs/:jobId`                                  | `server/src/api/jobRoutes.ts`      |
| `POST /projects/:id/features`                                                     | `server/src/api/routes.ts`         |
| `PUT`, `DELETE /projects/:id/features/:fid`                                       | `server/src/api/routes.ts`         |
| `POST /projects/:id/features/:fid/project`                                        | `server/src/api/routes.ts`         |
| `POST /projects/:id/timeline`                                                     | `server/src/api/routes.ts`         |
| `POST /projects/:id/undo`, `/redo`                                                | `server/src/api/routes.ts`         |
| `POST /projects/:id/previews/:tx/commit`, `DELETE /projects/:id/previews/:tx`     | `server/src/api/routes.ts`         |
| `GET /projects/:id/history`, `POST /projects/:id/checkpoints`, `/history/restore` | `server/src/api/routes.ts`         |
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
(`shared/src/api.ts`). `STATUS` in `server/src/api/routes.ts` fixes the
status for each `code`. `internal` is 500 with a generic message; the log has
the detail. A 409 on a document edit carries the stored `revision`, and on a
preview commit also the staged `draft`. `client/src/api.ts` turns any error
into `ApiError`; a body without `code` becomes `internal`.

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
- Admins must use TOTP; members may opt in. A sign-in that needs a code or
  enrolment gets a step session limited to `STEP_ROUTES` in
  `server/src/auth/middleware.ts`.
- Sessions end after `auth.sessionDays` or `auth.sessionMaxDays` unused
  (`shared/src/settings.ts`): `server/src/auth/sessions.ts`.
- Login takes a username or an email in any case; both names share one
  failure limit: `server/src/auth/userStore.ts`, `server/src/auth/rateLimit.ts`.
- Password length: `server/src/auth/password.ts`.
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

## History

Every document edit except a project rename saves the document and one
labelled undo entry together; a failed edit writes nothing. Edits sharing an
`X-Rockett-Tx` (`TX_HEADER`) fold into the latest entry. Undo, redo and
restore are document edits; nothing to undo or redo is 409:
`server/src/store/historyStore.ts`. Entries and checkpoints carry `by`, the
signed-in user's id; the history list and a new checkpoint add `byName`. Both
are absent on older entries. Checkpoints keep their snapshots and blobs:
`server/src/store/blobGc.ts`.

A feature add or edit with `X-Rockett-Preview` (`PREVIEW_HEADER`) and
`X-Rockett-Tx` stages the edit in memory for that user and session instead of
saving it. Only the preview commit route saves it. A restart drops open
previews: `Previews` in `server/src/api/routes.ts`.

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
has no choice. A project already on version 2 is 409. Types:
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
  Measure refuses an unresolved face or edge reference with 400.
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

## Project file

A `.rockett` file is `ProjectFile` in `shared/src/routes.ts`. Upload migrates
an older schema, validates, and rejects a newer `version` or `schemaVersion`
with 400; any failure creates nothing: `server/src/api/projectFile.ts`. A
stored project with a newer schema is listed as `tooNew`, and an invalid one
is 422 on load: `server/src/store/projectStore.ts`, which also owns temporary
projects.

## Validation

- A route with a `body` schema parses it before the handler; a mismatch is
  400 with the failing JSON Pointer in `detail`: `parseBody` in
  `server/src/api/routes.ts`.
- Features are checked by `validateFeature` in `server/src/api/validate.ts`
  through their registered `FeatureSpec` (`shared/src/featureSpec.ts`); an
  unregistered type is 400 `unknown feature type <type>`. Core schemas and
  `documentSchema` live in `shared/src/schema/features.ts`.
- Feature add and update fill a missing reference `sig` from the model
  (`server/src/geometry/signature.ts`). They also write `targets`, leaving
  out bodies the caller's view hides: `server/src/api/routes.ts`. See
  [CAD_MODEL.md](CAD_MODEL.md), Tool targets.
- A validation failure writes nothing.

## Limits

| Limit                                 | Owner                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| JSON request body                     | `JSON_BODY_LIMIT_BYTES`, `server/src/api/uploads.ts`                                |
| Import upload                         | `IMPORT_LIMITS`, `server/src/api/uploads.ts`                                        |
| Mesh import triangles                 | `MAX_MESH_TRIANGLES`, `server/src/geometry/importers.ts`                            |
| 3MF expanded entry                    | `server/src/geometry/read3mf.ts`                                                    |
| Document after an import              | 40 MB inline in `server/src/api/routes.ts`                                          |
| Project file                          | `PROJECT_FILE_LIMIT_MB`, `shared/src/routes.ts`                                     |
| Thumbnail                             | `THUMBNAIL_LIMITS`, `shared/src/routes.ts`                                          |
| Reference image                       | `IMAGE_LIMIT_MB`, `server/src/store/projectStore.ts`                                |
| History entries, labels               | `HISTORY_LIMIT`, `LABEL_LIMIT`, `shared/src/schema/history.ts`                      |
| Tool targets                          | `MAX_TARGETS`, `shared/src/schema/features.ts`                                      |
| Previews, jobs, timeouts, size search | `server/src/tunables.ts`                                                            |
| Settings import                       | `SETTINGS_IMPORT_MAX_BYTES`; nodes and depth in `server/src/store/settingsStore.ts` |
