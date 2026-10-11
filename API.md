# REST API

Base path `/api`, JSON unless noted. The route tables own method, path, body
schema, effect and the request and response types (the `route<Req, Res>`
generics):

- `ROUTES` and `AUTH_ROUTES` in `shared/src/routes.ts`;
- settings entries in `shared/src/settingsRoutes.ts`;
- tangent edges and reference signing in `shared/src/refRepairRoutes.ts`;
- `FRIEND_ROUTES` in `shared/src/friends.ts`, `NOTICE_ROUTES` in
  `shared/src/notices.ts`.

A route's `effect` is `document` for a document edit or `viewer` for a write
a view-only member may make; `DOCUMENT_EDITS` and `VIEWER_WRITES` in
`shared/src/routeContract.ts` read it, and route modules declare it the same
way.

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
| `GET /health`                                                                     | `server/src/api/systemRoutes.ts`   |
| `GET /formats`                                                                    | `server/src/api/systemRoutes.ts`   |
| `GET /modules`, `GET /modules/:id/licence`                                        | `server/src/api/routes.ts`         |
| `GET /plugins/:id/client.mjs`                                                     | `server/src/api/routes.ts`         |
| `GET`, `POST /projects`                                                           | `server/src/api/projectRoutes.ts`  |
| `GET`, `DELETE /projects/:id`                                                     | `server/src/api/projectRoutes.ts`  |
| `POST /projects/:id/duplicate`, `/rename`                                         | `server/src/api/projectRoutes.ts`  |
| `GET`, `PUT /projects/:id/members`                                                | `server/src/api/projectMembers.ts` |
| `GET /projects/:id/file`, `POST /projects/file`                                   | `server/src/api/projectFile.ts`    |
| `POST /projects/import`, `/projects/:id/import`                                   | `server/src/api/importRoutes.ts`   |
| `PUT /projects/:id/parameters`                                                    | `server/src/api/documentRoutes.ts` |
| `POST /projects/:id/evaluate`                                                     | `server/src/api/geometryRoutes.ts` |
| `GET /projects/:id/meshes/:hash`                                                  | `server/src/api/meshRoute.ts`      |
| `GET /jobs/:jobId/events`, `DELETE /jobs/:jobId`                                  | `server/src/api/jobRoutes.ts`      |
| `POST /projects/:id/features`                                                     | `server/src/api/featureRoutes.ts`  |
| `PUT`, `DELETE /projects/:id/features/:fid`                                       | `server/src/api/featureRoutes.ts`  |
| `POST /projects/:id/features/:fid/project`, `/signature`                          | `server/src/api/featureRoutes.ts`  |
| `POST /projects/:id/timeline`                                                     | `server/src/api/featureRoutes.ts`  |
| `POST /projects/:id/undo`, `/redo`                                                | `server/src/api/previewRoutes.ts`  |
| `POST /projects/:id/previews/:tx/commit`, `DELETE /projects/:id/previews/:tx`     | `server/src/api/previewRoutes.ts`  |
| `GET /projects/:id/history`, `POST /projects/:id/checkpoints`, `/history/restore` | `server/src/api/historyRoutes.ts`  |
| `DELETE /projects/:id/checkpoints`                                                | `server/src/api/historyRoutes.ts`  |
| `PUT /projects/:id/bodies/:bodyId`                                                | `server/src/api/bodyRoutes.ts`     |
| `PUT /projects/:id/groups`                                                        | `server/src/api/bodyRoutes.ts`     |
| `POST /projects/:id/upgrade-naming`, `/commit`                                    | `server/src/api/documentRoutes.ts` |
| `POST /projects/:id/maintenance/gc`                                               | `server/src/api/documentRoutes.ts` |
| `GET`, `PUT /projects/:id/thumbnail`                                              | `server/src/api/documentRoutes.ts` |
| `GET`, `PUT /projects/:id/view`                                                   | `server/src/api/documentRoutes.ts` |
| `POST /projects/:id/tangent-edges`                                                | `server/src/api/geometryRoutes.ts` |
| `POST /projects/:id/size-limit`                                                   | `server/src/api/geometryRoutes.ts` |
| `POST /projects/:id/measure`                                                      | `server/src/api/measureRoutes.ts`  |
| `POST /projects/:id/export`                                                       | `server/src/api/geometryRoutes.ts` |
| `POST /projects/:id/assets`, `GET /projects/:id/assets/:assetId`                  | `server/src/api/geometryRoutes.ts` |
| `/folders` and below, `PUT /projects/:id/folder`                                  | `server/src/api/folderRoutes.ts`   |
| `/projects/:id/assemblies` and below                                              | `server/src/assembly/routes.ts`    |

## Errors

Project, folder, settings and job routes answer `ApiErrorBody`
(`shared/src/api.ts`). `STATUS` in `server/src/api/apiErrors.ts` fixes the
status for each `code`. `StoreError(message, code)` and `ValidationError`
(`shared/src/schema/validation.ts`) answer their own code and message; any
other throw is `internal`, 500 with a generic message, and the server log
gets the route, the error name and its first three stack frames, never the
message, the request or the document, because a message can carry user input. A 409 on a document edit carries the stored `revision`, and on a
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
  `view` member may only read, plus the `viewer` effect routes
  (`server/src/api/projectAccess.ts`).
- Folder members inherit their role on the folder's projects: `folderRole`
  in `server/src/api/projectAccess.ts`.
- A temporary copy answers only the user who opened it, its `temporary.json`
  `owner`; every other user, admins included, gets 404 on every
  `/projects/:id` route. A copy stored without an owner answers nobody and
  is swept 24 hours after its last touch.

## Document revisions

A project's `ETag` is `"<revision>"`, equal to `document.revision`; every
save raises it by one. Every `document` effect route, route module mutations
included, needs `If-Match: "<revision>"`, checked inside the project
queue: missing is 428, malformed is 400, stale is 409, and none writes:
`server/src/api/revision.ts`. Other writes (view, thumbnail, checkpoints,
folders, members, settings, assets, export `retain`) take no revision.
Project deletion also requires the revision shown in the project list; a stale
request leaves the project intact. Unreadable projects list a `deleteTag`, a
quoted SHA256 of the stored document bytes. An unreadable manifest also binds
its stored bytes into the tag; only an admin may delete such a project. Deletion
needs that exact tag and refuses changed or now-readable contents. Storage
failures refuse listing and deletion. Temporary cleanup needs no revision.

## Assemblies

An assembly is a project document of manifest type `assembly`
(`shared/src/assembly.ts`), stored as `documents/<id>.json` beside the part
and validated on every load; a corrupt or invalid one is 422, and an id the
manifest does not list as an assembly is 404. `POST /projects/:id/assemblies`
creates an empty one and lists it in the manifest. The instance routes add
(`POST .../instances`), update (`PATCH .../instances/:instance` with any of
`name`, `placement`, `grounded`) and remove (`DELETE`) one instance each.
They, `undo` and `redo` are document edits on the assembly: its `revision` is
their `ETag` and `If-Match`, and each saves one history entry. An instance
must name a part the manifest lists, else 400 at `/instance/documentId`; the
first instance of a part adds its `ComponentRef` at the part's revision, and
removing its last instance drops it. Each assembly keeps its own history log
at `documents/<id>/history/log.bin`, so undo in one document never reaches
another's entries: `server/src/assembly/store.ts`.

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
previews: `Previews` in `server/src/store/historyStore.ts`.

Parameter and expression associations update together through
`PUT /projects/:id/parameters` with `parameters` and `parameterBindings`.
The document revision header is required; feature preview transaction headers
also apply. Successful edits regenerate dependent geometry and create one history
entry. Invalid names, cycles, numeric bounds or conflicting dimensions refuse the
edit before saving. Project files, history and reopen preserve associations.
`PUT /projects/:id/features/:fid` may also carry the whole `parameterBindings`
list, so a sketch edit that renumbers its constraints saves the moved bindings
in the same edit. Feature dialog and Quick Edit edits, previews included, send
it too.

## Evaluation

- Evaluate answers `EvaluateResult` and mutations `MutationResponse`
  (`shared/src/routes.ts`). Each `BodyPayload` carries `bodyId`, `name`,
  `color`, `reference`, `approximate`, `meshKey`, `bbox` and `mesh`, the
  hash and byte size of its mesh, never the mesh itself. A B-Rep body with
  at least 1,024 triangles whose mesh at 12 times the viewport deflection has at most half of them
  also carries `coarse`, that level's hash and byte size; the mesh route
  serves both. The client
  fetches each hash from the mesh route once: `client/src/three/meshes.ts`.
- `BodyPayload.color` is the body's stored `bodyMeta` colour, else the
  `#rrggbb` a STEP file gave it, kept per body id through later features
  (`EvalState.imported`).
- `PUT /projects/:id/bodies/:bodyId` sends exactly one of `name` or `color`,
  each its own undo step. `color` is lowercase `#rrggbb`, or `null` to clear
  it. Anything else, an unknown key included, is a 400; a body id that is not
  an own key of `bodyMeta` is a 404. Renaming a module body is a 422
  `unprocessable`, `<name> takes its name from its module`.
- A STEP `importStep` status carries `importTree`: each assembly and part
  instance with its name, its `path` of child indices from the file's roots
  and, for a part, the body ids its solids became. It is derived on every
  evaluation and never stored. The model tree nests each component's bodies
  under it by body id, so a renamed body keeps its place, a body in a user
  group shows only in the group, a body a later feature removed drops out and
  a component left empty is hidden: `client/src/importTree.ts`.
- Stored sketch points are the model. A feature add or edit solves a sketch
  once when it adds or changes a constraint its points do not meet, and
  otherwise stores the points as sent. Evaluation re-solves a sketch only when
  a projected source moves: `editedEntities` in `shared/src/solver.ts`.
- `?position=N` evaluates the first N features without moving the saved
  marker: `evaluationPosition` in `server/src/api/routes.ts`.
- The mesh route sends a `shared/src/meshFormat.ts` mesh for a hash in the
  project's current evaluation, or among its latest 4096 preview and
  rolled-back hashes while cached in memory or on disk; any other hash is a
  404: `server/src/kernel/meshCache.ts`.
- JSON responses from `GZIP_FROM_BYTES` up are gzipped when accepted:
  `server/src/api/gzipJson.ts`.
- Requests for one project run in order; projects run independently:
  `server/src/store/projectQueue.ts`. The queue does not lock across
  processes, so run one server per data directory.

### Kernel jobs

A request may send `Rockett-Job: <UUID v4>` to follow its kernel work at the
job events route (`text/event-stream`) or cancel it. Jobs belong to the
submitting user and project; anyone else gets 404. A job fails with a plain
`message` on its `failed` event when no feature finishes within `jobStall`,
or when it runs past `jobCeiling` (`server/src/tunables.ts`); both cancel it.
A retry resumes from the snapshots that cancel kept, unless the worker was
restarted. A worker that misses the cancel watchdog is restarted and
in-flight kernel requests get 503 `kernel`:
`server/src/kernel/jobs.ts`, `server/src/kernel/workerKernel.ts`.

## Naming upgrade

Stage and commit move a `namingVersion` 1 project to 2; nothing else changes
the naming version. Both back up the project first and name the backup. The
commit needs `If-Match` and is 409 while a `candidate` or `ambiguous` mapping
has no choice. A project already on version 2 is 409. Stage gives each
candidate and suggestion a `mesh` from the version 2 evaluation at its
mapping's position: a face or body index range, or an edge polyline, with the
body's `bbox`, so the client finds it in the version 1 mesh it shows. Stage
also lists `failures`: each feature that errors under either version, with
that version, its message and any unresolved refs. The commit is 422 while a
feature fails under version 2 and not under version 1. Both refuse when the
engine's kernel is not initialised. Types: `NamingUpgradeProposal`,
`NamingMapping`, `NamingFailure` and `NamingDecision` in `shared/src/api.ts`.
Code: `server/src/store/namingUpgrade.ts`. Model rules:
[CAD_MODEL.md](CAD_MODEL.md), Naming upgrade.

## View state

Each user has their own view of a project (`projectView` in
`shared/src/routes.ts`), with its own `ETag`; a stale `If-Match` is 409.
Saving a view never edits the document, evaluates or raises the revision.
Visibility lives only in the view: a document edit carrying `visible` is 400.
Code: `server/src/store/viewStore.ts`. A temporary project's views stay in
server memory, never on disk, and go when it is removed
(`server/src/store/projectStore.ts`). A server restart drops them: the view
reads as empty, and a view PUT for that user skips the `If-Match` check, so
the browser's next view change or reopen sends the record's view back.

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
- An empty `bodyIds` exports every body the user's view shows except
  reference bodies; the export panel sends the same list unless bodies are
  selected. Naming a reference body exports it.
- Measure takes face and body refs, up to `MEASURE_MAX_REFS`
  (`shared/src/api.ts`), and edge or vertex refs only when it has at most two
  refs; either breach answers 400 saying so. `items` holds one entry per ref,
  in request order: faces carry exact area and bodies exact volume
  (`BRepGProp`). Distance and angle come only for exactly two refs. A
  duplicate ref is resolved once per request.
- Writers: `server/src/geometry/exporters.ts`, `server/src/geometry/xde.ts`
  (STEP and GLB), `server/src/geometry/dxf.ts`.

## Extension points

- `registerRouteModule` (`server/src/api/routeModules.ts`) mounts project
  routes behind the access guard and project queue. `projectMutation` needs
  `If-Match`. A non-core module id `<moduleId>.<name>` must mount under
  `/projects/:id/m/<moduleId>/`, or mounting throws. Its `userRoute` mounts
  under `/m/<moduleId>/` for the signed-in user; one with an `effect` or an
  `:id` parameter throws. A route refuses with
  `throw new StoreError(reason, "unprocessable")`, which the plugin API
  exports: 422 with the one-line reason.
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

`GET /modules/:id/licence` returns `{ "text": "..." }`, the `LICENSE` file in
the folder the host loaded the module from (`HostModule.folder`). It is 404
when no module has that id, or when the module has no folder or no `LICENSE`
file. The Modules settings page shows it beside a line naming
`THIRD-PARTY-NOTICES.md`.

- `status` is `loaded`, `failed`, `incompatible` or `disabled`.
- `client` is `true` only for a `loaded` third-party plugin that ships
  `client.mjs`, and absent otherwise.
- `error` is null for `loaded` and `disabled`. Otherwise it is the manifest
  error, the thrown registration or activation message, or the plugin API
  range reason.
- `disabled` means the app setting `plugin.<moduleId>.enabled` is `false`.
  Only an admin can set it (`PATCH /settings`). The host reads it at startup,
  so a change applies on the next start. A third-party plugin is also
  `disabled` until both of its settings below match.
- The user setting `plugin.<moduleId>.hidden` (`PATCH /me/settings`) hides
  the module's client UI for that user only. Its status stays `loaded`.
- Keys ending in `.enabled` or `.hidden` belong to the host; a manifest that
  lists one in `contributes.settings` fails `parseManifest`.
- `server/src/modules/host.ts` loads every module before the router mounts
  route modules. A module that throws during activation keeps none of its
  registrations; the others still load.
- A manifest that fails `parseManifest` reports `failed` with whichever of
  its identity fields are strings; the rest are empty.
- `activate` receives `ServerContext` (`plugin-api/src/server.ts`):
  `register`, `services`, `startKernelJob`, `userData`, `files`,
  `kernelVersion`, `bodies`, `signFaces` and `dxf`. `register.routeModule`,
  `kernelJob`, `timelineFeature`, `setting` and `extensionSpec` take
  `plugin-api` types;
  `exporter`, `importer` and `featureKind` take core types. Each call is
  tracked under one disposer.
- API 0.9.0 adds `services.provide(id, handler)`: the id starts with the
  module id and a dot, and the call returns its tracked disposer. Duplicate
  or invalid ids fail activation and remove the module's earlier
  registrations. Project-route callbacks get `services.get(id)`: `undefined`
  without a provider, otherwise `(input: unknown) => Promise<unknown>`. Each
  call resolves the current provider, so a retained callable refuses with 422
  `unprocessable` after unload or failed activation. The handler receives
  `(document, input, context)` bound to the authorised project, the
  authenticated user and read-only `blobs.get`; request fields cannot choose
  another user or project. Providers and consumers validate their own input
  and result schemas. User routes get no services; the host stores no
  service data.
- API 0.23.0 exports `moduleBodyId(moduleId, featureId, key)` from
  `shared/src/topoRefs.ts`, the one owner of the keyed body id
  `<moduleId>:<featureId>:<key>`, and `themed(material, token)` on the
  client, which sets a material's colour from the theme token's CSS
  variable and records the token so a theme switch recolours it. CAM's
  stock and toolpath layers and the Electrical pad highlight use both or
  either. All four first-party manifests use `^0.23`.
- API 0.22.0 adds `unzstd(bytes, maxBytes)` to project route and mutation
  contexts (`server/src/modules/unzstd.ts`), since modules may not import
  Node builtins. It runs Node's `zstdDecompressSync` with `maxOutputLength`
  set to `maxBytes`, so oversized output stops at the cap instead of being
  allocated. Input over the import budget is 413 with the core import's
  message. Output over `maxBytes` is 413:
  `The compressed data expands past <maxBytes>, the limit.`
  Input Node cannot decode is 400:
  `The compressed data is not valid Zstandard.`
  A truncated frame returns short output, possibly empty, without an error,
  so callers check the size or content they expect. All four first-party
  manifests use `^0.22`.
- API 0.21.0 exports `Placement` from `shared/src/placement.ts`, the one
  owner of placement maths, as a type and a value: `applyToPoint`,
  `applyToDirection`, `compose`, `invert` and the other helpers core uses.
  All four first-party manifests use `^0.21`.
- API 0.20.0 adds `readStep(bytes)` to a timeline feature's `evaluate`
  scope. It runs the core STEP importer (`readXdeStep` in
  `server/src/geometry/xde.ts`) and returns one shape per STEP part, owned
  by the scope like any `own`ed handle. Bytes over the import budget
  (`ROCKETT_IMPORT_BUDGET_MB`) are refused before reading with the core
  import's message, `This file is <size>; imports are limited to <budget>.`;
  bytes the reader cannot parse fail with `STEP file could not be read`.
  Either refusal fails the feature and keeps the previous bodies. All four
  first-party manifests use `^0.20`.
- API 0.19.0 adds `register.menuItem({ id, menu, command, after, before })`
  to the client context. `menu` must name a core context menu that has core
  items (`MenuTargets` in `client/src/commands/menus.ts`), and the id must
  start with the module id and a dot; either failure throws and fails
  activation. The item joins the same menu registry as core items, ordered
  by `after` or `before` against a core item id `<menu>.<name>`. All four
  first-party manifests use `^0.19`.
- API 0.18.0 adds `dxf(projectId, user, source)` to the server context,
  below. `writeDxf` in `server/src/geometry/dxf.ts` takes an optional layer
  name; without one its output is unchanged. All four first-party manifests
  use `^0.18`.
- API 0.17.0 lets `evaluate` add a `bodies` list beside `shape`, each entry
  `{key, name, shape, faces, reference, approximate}`. Each becomes body
  `<moduleId>:<featureId>:<key>`; a key is 1 to 128 characters of `a-z`,
  `0-9`, `_`, `:` and `-`, starting with a letter or digit, so the id
  survives edits, reorders and reopening. The body belongs to its feature
  for Auto targets, tree selection and group pruning, and a manifest id `b`
  is refused because `b:` starts core body ids. `shape` must be one solid,
  `faces` labels it as API 0.14.0 does, `name` is 1 to 200 characters
  without control characters, and the flags are booleans. The module's name
  replaces the stored `bodyMeta` name on every evaluation; the colour stays
  the user's.
  A `BodyPayload`, a `ProjectBody` and a `ServerBody` carry
  `reference: true` for a reference body; `BodyPayload` also carries
  `approximate: true`. A default export and a new CAM setup's bodies leave
  reference bodies out until the user picks them. An invalid or repeated
  key, an invalid name or flag, a shape of two solids, or an id an earlier
  feature already made fails the feature and keeps the previous bodies.
- API 0.16.0 exports `placementSchema` from `shared/src/placement.ts`, the
  one owner of a stored placement: a unit quaternion `rotation`
  `[x, y, z, w]` within `UNIT_DOT_TOL`, refused as
  `must be a unit quaternion`, and a `translation` in mm. Assemblies and
  module feature params use it.
- API 0.15.0 adds an optional manifest `dataVersion`, an integer from 1, and
  an optional `migrations` member on the server entry,
  `{[from]: (data) => data}`, keyed by the data version each step upgrades
  from. On load the host runs them on `extensions[<moduleId>].data` up to
  `dataVersion`, with the document migrations; the first save backs the
  project up first. A key
  outside 1 to `dataVersion - 1`, a step that is not a function, or
  `migrations` without `dataVersion` fails activation. A gap in the steps
  makes the project unreadable, as a core gap does. Data or a feature newer
  than the module is kept as stored; the feature evaluates to
  `<type> version <n> is newer than this module reads (<m>)`, and the module's
  routes see the stored `version`.
- API 0.14.0 lets `evaluate` return `{shape, faces: [[face, label], ...]}`
  instead of a bare solid. Each label is 1 to 64 characters of `a-z`, `0-9`,
  `_`, `:` and `-`, starting with a letter or digit, for example `top`,
  `bottom` or `edge:3`. Core names that face `f:<featureId>:l:<label>` under
  either naming version, so the name survives parameter edits, placement
  changes and reopening. Unlabelled faces keep the names a bare solid gets.
  A duplicate label, a face labelled twice, an invalid label or a face the
  shape does not contain fails the feature and keeps the previous body.
- API 0.13.0 adds `defineTimelineFeature({spec, evaluate})` and
  `await register.timelineFeature(feature, new URL("./kernel.ts", import.meta.url))`.
  One definition owns the feature's spec, schema-typed params and optional
  `resolveInputs`. The module's server entry registers it and its `kernel.ts`
  lists it in a `features` export. The host registers the spec under the
  module's id, then the kernel installs the listed definition of that type;
  a foreign type, a missing list or an unlisted type fails activation and
  keeps nothing. `evaluate` receives the kernel job scope, a detached copy of
  params and the committed `inputs` with asset bytes, and returns one solid.
  Disable, unload or a missing module reports `Requires module`; missing
  asset bytes refuse with 404 and corrupt bytes with 500, keeping the document.
- API 0.12.0 types `register.extensionSpec(spec)`. It registers a feature type
  under the module's id before the type's last dot and infers its params from
  the schema. Its optional `resolveInputs` receives detached immutable JSON
  params and only the owning module's committed extension envelope, as
  `extensions[<moduleId>]`. It returns immutable canonical JSON `identity` and
  unique SHA-256 `assets`. Inputs and output use the shared module-data byte
  bound and a nesting bound. Project source delivery checks each unique asset
  in that project's blob store, including held sources. Missing or corrupt
  bytes refuse. Geometry keys, implicit-target aliases, crash quarantine and
  body fingerprints include the same resolved inputs; core keys stay
  unchanged. The existing evaluator context receives `inputs` without changing
  saved params. An extension-only replacement invalidates warm geometry and
  CAM identity; undo restores both. Source delivery and project files resolve
  named numeric bindings before selecting module assets. No resolved state is
  saved, and unloading the spec removes its resolver.
- `register.setting(definition)` takes a `SettingDefinition` whose key
  starts with `plugin.<moduleId>.`, is listed in `contributes.settings` and
  is not a host key, or the load fails naming the key. Settings routes then
  validate its values with its schema. The client part registers the same
  definition, so the Settings panel draws it under the module's section.
- Route callbacks receive typed `params`, `body` and the signed-in `user`.
  Project reads get `blobs.get(hash)`; mutations add `blobs.put(bytes)`.
  Reads copy bytes; writes snapshot them and return SHA-256. Both bind to the authorised project, with no id argument or delete.
  Access, `If-Match`, queue and import byte budget precede put; bad hashes and corrupt bytes refuse through the blob store.
  API 0.8.0's mutation-only `assets.set(hashes)` replaces exact manifest namespace refs with a detached array.
  Only this capability declares bounded, unique hashes that must resolve here before document/history commit; opaque metadata stays.
  `moduleAssets.namespaces` owns portable refs; opaque extension JSON stays.
  Sources survive save, undo, reopen, duplicate and `.rockett` export/import without a feature, including disabled or absent modules.
  Blob collection conservatively refuses extension data.
  User routes get neither capability and take no user id; only core `ModuleApi` declares the runtime `kernel`.
- `POST /projects/:id/m/rockett/kicad/upload` takes `{source}` as canonical
  base64 original `.kicad_pcb` bytes and `If-Match`; returns `linkId` with the
  normal edit response. KiCad 9 is the floor; invalid UTF-8 or boards get 400
  before storage. `extensions["rockett.kicad"]` holds `{version: 2, data: {links}}`;
  version 1, from before model uploads, still reads, and the host backs it up
  as `rockett.kicad.v1.v2` before its first version 2 save.
  Source and `{version: 1, data}` snapshot hashes are portable
  assets. Original bytes retain a BOM; JSON caps decoded source below 37.5 MiB.
  An optional `linkId` updates that link instead, or refuses with 422 when
  the project has no such link. The update keeps the link id, outline owner
  and uploaded models, replaces source, snapshot and generator fields in one
  undoable edit labelled `Update KiCad board`, and returns
  `diff: {added, removed, moved, modelChanged, outlineChanged, thicknessChanged}`.
  The lists hold footprint uuids; moved covers position, angle and side.
  Component bodies keep their ids; a reference to a removed footprint's body
  reports `missing` until the footprint returns.
- Footprint model paths resolve by name. A path must start with
  `${KICAD9_3DMODEL_DIR}/`, `${KICAD10_3DMODEL_DIR}/` or `${KIPRJMOD}/`; the
  name is the path with a trailing `.wrl` read as `.step`, and must end in
  `.step` or `.stp`. Every root resolves only to uploaded content: the
  server never reads host files or fetches the network. URLs, other
  substitutions, `$`, `%`, `\`, braces after the root, and empty, `.` or `..`
  segments are refused, as is a scale that is not one positive factor on
  every axis.
- `GET /projects/:id/m/rockett/kicad/models/:linkId` needs view access and
  returns `{models: [{footprintUuid, reference, path, status, ...}]}` in
  board order: `uploaded` with `name` and `sha256`, `missing` with `name`, or
  `refused` with `reason`. A link outside the project refuses with 422.
- `POST /projects/:id/m/rockett/kicad/models/:linkId` takes `{name, source}`,
  `source` canonical base64 STEP bytes, and `If-Match`. It refuses with 400,
  before storage, a name the rules above refuse or would rewrite, a name no
  footprint on that board references, and bytes that do not start
  `ISO-10303-21;`. It stores the bytes as a portable asset and records
  `models[name] = sha256` on the link, replacing an earlier upload of that
  name; returns `name` and `sha256` with the normal edit response.
- Feature `rockett.kicad.board` version 1 takes params
  `{linkId, placement, options}`. `placement` follows the plugin API
  `placementSchema`; `options` is `{}`. It
  reads only the link's committed snapshot, extrudes the outline from z=0 by
  the board thickness and cuts cutouts, round drills and oval slots through
  it. A link outside the project refuses with 422. Body `b:<featureId>`
  labels its faces `top`, `bottom`, `edge:<s>` for outline segment `s`,
  `cutout:<c>:<s>` for segment `s` of cutout `c`, and
  `drill:<footprintUuid>:<p>:<s>` for wall `s` of pad `p`'s hole (one wall
  when round; line, arc, line, arc when oval). Indices count from 0 in
  snapshot order. A wall split into pieces, or a hole in a footprint without
  a uuid, keeps unlabelled names. Each footprint with a uuid and a
  courtyard of nonzero area also makes body
  `rockett.kicad:<featureId>:<linkId>:<footprintUuid>`, named by its
  Reference: a box over the courtyard bounds, 1 mm high, on the top face
  for a front part and under the board for a back part, flagged `reference` and
  `approximate`. A Reference rename keeps the body id. When every model of a
  footprint is uploaded, the same body is instead those STEP parts, placed
  and not approximate, even without a courtyard. Each STEP hash is read once
  per evaluation through `readStep`. For column vectors a model goes to
  `placement * T(x,y,0) * Rz(angle) * B * T(o) * Rz(-rz) * Ry(-ry) * Rx(-rx) * S`
  with board `x` and `y` (KiCad y negated), angles in degrees, `B` identity
  on front and `Rx(180)` on back, `S` the model scale, and `o` the model
  offset with `z` raised by 0.05 plus the board thickness on front, or by
  0.05 alone on back.
- `GET /projects/:id/m/rockett/kicad/outline/sketch/:sketchId` and
  `GET /projects/:id/m/rockett/kicad/outline/face/:bodyId/:faceName` need
  view access and return, as a JSON string, the DXF R12 text the export menu
  writes for that sketch or planar face of the final model, every
  non-construction entity on layer `Edge.Cuts` in mm, for KiCad File, Import,
  Graphics. They call the server context `dxf`, so its refusals apply.
  Command `rockett.kicad.exportOutline` downloads the one selected face's
  outline as `<body name>.dxf`.
- Service `rockett.kicad.boardNets` takes a `linkId` string and returns
  `{nets: [{name, members: [{footprintUuid, reference, pad}]}]}` in board
  order. It reads pad nets by name from the link's stored original bytes:
  KiCad 9 `(net <code> "<name>")` and KiCad 10 `(net "<name>")`; an empty
  name is no net. Invalid input, a link outside the authorised project, or a
  missing or invalid source refuses with 422.
- Service `rockett.kicad.board` takes a `linkId` string and returns
  `{thickness, placement, footprints}` from the link's stored snapshot, each
  footprint `{uuid, libId, reference, side, pads: [{number, x, y}]}` in
  board order, with the placement of the one unsuppressed
  `rockett.kicad.board` feature on that link. No such feature, or more than
  one, refuses with 422, as do invalid input, a link outside the authorised
  project, or a missing or invalid snapshot.
- `GET /projects/:id/m/rockett/elec/boards/:linkId/nets` needs view access and
  returns those nets after `rockett.elec` validates them with its own schema.
  Without a `rockett.kicad` provider it refuses with 422
  `Requires module rockett.kicad`; an invalid result refuses with 422.
- `GET /projects/:id/m/rockett/elec/boards/:linkId/pins` needs view access and
  returns, as a JSON string, the connector pin table as CSV: header
  `Reference,Pin,Net,X,Y,Z`, then one row per connector pin in board order,
  positions in mm in model space, rounded to 0.0001, CRLF line ends. A
  field holding a comma, quote, CR or LF is quoted with its quotes doubled;
  a pin with no net leaves Net empty. It reads both kicad services and
  refuses as they do. Command `rockett.elec.exportPins`, after the outline
  item in the face menu, downloads the selected KiCad board's table as
  `<body name> pins.csv`.
- `GET /projects/:id/m/rockett/elec/boards/:linkId/pads` needs view access
  and returns `{nets, footprints}`: the net names in board order, and each
  footprint with a uuid and side as
  `{footprintUuid, reference, connector, pins}`, each pin
  `{pad, net, position}` with the position in mm in model space, and
  `connector` by the ELEC-003 Reference rule. It reads both kicad services
  and refuses as they do. Command `rockett.elec.openPanel`, after the pin
  table item in the face menu, opens panel `rockett.elec.panel` on the
  selected board: searchable Nets and Connectors lists, and the Reference
  and nets of a selected component body
  `rockett.kicad:<featureId>:<linkId>:<footprintUuid>`. Clicking a net
  draws its pads, and only its pads, in the `selection` colour on layer
  `rockett.elec.nets`.
- `register.kernelJob(id, entry)` registers a kernel job: `id` starts with
  the module id and a dot, and `entry` is the URL of a file whose default
  export, from `defineKernelJobs`, holds the job under that id.
- `userData(name, version)` gives the module a per-user store at
  `users/<userId>/modules/<moduleId>/<name>.json`, holding
  `{ version, data }`. `name` follows the store id rule, or activation
  fails. `read(user)` returns `{ version, data, etag, readOnly }` or null.
  `write(user, data, etag)` needs the etag it read, or null for none yet,
  and runs in the store's write queue: a stale etag is 409 `conflict`, a
  file over the cap 413 `too_large`, and neither writes. Data saved at a
  higher `version` than the module passes reads as `readOnly`, and a write
  over it is 409. Code: `server/src/store/moduleData.ts`.
- `files` is the module's own folder, `modules/<moduleId>/` under the data
  folder, beside and never inside any user's folder. `read(name)` returns
  the bytes or null, `write(name, data)` writes atomically, `remove(name)`
  deletes, and `list()` returns every file's name relative to the folder.
  A name that is absolute, empty or holds `..` is refused before any read
  or write. Code: `server/src/modules/files.ts`.
- `kernelVersion` is the `{ occt, commit }` the running kernel reports, the
  value `bodyFingerprint` hashes, or null while the kernel starts. The
  naming version is the document's `namingVersion`, already in each body
  fingerprint.
- `bodies(projectId, user)` reads the stored document under the same access
  rule as a project route. A user without view access and a missing project
  get the same `not_found` rejection, "project not found", which a route
  answers as 404. It returns
  `{ id, name, reference, bbox, brep, faceNames, fingerprint, problems }`
  for each body at the end of the timeline, whatever the Design rollback, in model
  millimetres. `brep` is the OCCT BREP text of the body. `faceNames` holds
  one regen face name per face, in the order `TopExp_Explorer` visits the
  faces of the shape read back from `brep`, so a kernel job resolves a
  `FaceRef` by taking the face at the index of its `faceName`. A face the
  name map does not cover holds `""`. A face the explorer visits twice
  appears at both indexes, and a repeated name resolves to its first index,
  as core resolves it. A `~?` name never resolves as a `FaceRef`.
  `fingerprint` is `bodyFingerprint` (CAM-003) over the resolved features
  the body depends on, with identity placement, no selection and an empty
  CAM version. The rule errs toward stale. Walking back from the end, a
  feature is left out only when its type is a core type, it evaluated `ok`,
  and its reach is known and meets no body or feature already counted. Its
  reach is the bodies it names, targets, modifies or made, and a sketch or
  plane or reference image also reaches itself. A split piece `X:n` also
  counts `X`. Every other feature counts, including one that failed, was
  cancelled or warned, and a geometry feature with no known reach. An
  extension type, or a geometry feature with no known reach, makes every
  earlier feature count.
  A counted face extrude, face revolve or Move makes every earlier sketch
  count, since each reads all sketches, and a Move counts when a counted
  sketch is earlier than it. An edit to another body leaves the fingerprint
  unchanged, unless a counted feature also reaches that body. `problems`
  lists the evaluate status of each counted feature that failed, was
  cancelled or has unresolved references, empty when there are none. A
  failed or cancelled feature counts for every body, so it is in every
  body's `problems`. A failed feature leaves the body as it was before
  that feature, so a body with problems is not the model as designed.
  Nothing is cached: each call evaluates, writes BREP for every body, reads
  its face names from the evaluated name map and hashes the import
  sources. Code: `server/src/modules/bodies.ts`.
- `dxf(projectId, user, { sketchId } | { face })` returns the DXF R12 bytes
  the export route writes for that sketch or planar face of the final model,
  under the same access rule as `bodies`. An optional `layer` puts every
  non-construction entity on that layer and lists it in the layer table;
  construction stays on `CONSTRUCTION`. A layer name is 1 to 255 printable
  ASCII characters without spaces. A source that is not exactly one of a
  non-empty `sketchId` or a `{ kind: "face", bodyId, faceName }`, or a
  non-string layer, is refused as "dxf takes { sketchId } or { face }, and
  an optional layer name"; a non-planar face as "face <name> is not planar";
  an unknown sketch as "sketch <id> is not in the model". Each refusal is a
  `ValidationError`. Code: `server/src/modules/host.ts`.
- `startKernelJob(id, input, { onProgress, signal })` runs one of the
  module's own jobs in the kernel worker and resolves to its result. A job is
  synchronous; one that returns a promise is refused. The job
  receives the OCCT instance, `own` for every handle it makes and
  `progress(done, total, label)`. Its handles are freed when it returns,
  throws or is cancelled; an aborted signal cancels it at its next
  `progress` call. A job's thrown error keeps its `name` and message across
  the worker, so a module can tell its own refusals from failures.
- After sign-in, `client/src/modules/host.ts` activates the client part of
  each listed module that this route reports `loaded`, with `ClientContext`:
  `register`, `project`, `ui`, `settings` and `request`. `register.command`,
  `toolbarGroup`, `menuItem`, `panel`, `workbench`, `layer`, `setting` and
  `settingsPage` take `plugin-api` types; `selectionKind` and `pickProvider`
  take core types. Activation is atomic as on the server. A command
  `Control`, a workbench `tree` and `bar` and a settings page draw inside the
  panel error boundary.
- `register.settingsPage({ id, title, component })` lists a page with id
  `<moduleId>.<name>` under the module's Settings section, with the title
  above `component`. `ui.openSettings(page)` opens Settings at that page.
- `settings.get(key)` returns the resolved value of one of the module's own
  settings, `settings.set(key, value)` writes it to the narrowest layer its
  `scopes` allow that this user can write, and
  `settings.subscribe(key, listener)` calls the listener with each new value
  and returns its disposer, removed with the module. The key must start with
  `plugin.<moduleId>.`, must not be a host key and must be in
  `contributes.settings`; any other key throws, and `set` rejects, naming
  the key. There is no server-side access.
- A workbench's optional `tree` draws in the left dock and `bar` in the
  timeline row, in place of the model tree and timeline. The view toolbar
  group shows at the right end of every workbench.
- `project.get()` returns `{projectId, document, bodies}` for the open
  project, the same object until the project, document or evaluation
  changes. `bodies` lists `{id, name, bbox}` for each body of the current
  evaluation, in model millimetres. `project.subscribe(listener)` calls the
  listener on each change and returns its disposer. Both fit
  `useSyncExternalStore`.
- `project.mutate(route, body)` sends a document-edit route of the open
  project through the same write queue, transaction id and `If-Match` as a
  core edit, and applies the returned document and history. A route that is
  not a document edit, or no open project, rejects.
- `project.read(route, params)` GETs a project route of the open project,
  filling `:id` with its id and the other path parameters from `params`,
  and resolves the route's typed JSON response. A route that is not GET, a
  path parameter of `.` or `..`, or no open project, rejects before a
  request goes out. A reply that lands after the open project changed
  rejects.
- API 0.10.0 adds `project.picks()`, `select(refs)`, `pick(mode)` and
  `measure(refs)`. A pick ref is a `MeasureRequest` ref: `body`, `face`,
  `edge` or `vertex`. `picks()` lists the selection as unsigned pick refs,
  the same array until the selection changes; `select(refs)` replaces it.
  `pick({ command, kinds, hint, onPick, onEnd })` starts a viewport pick
  mode owned by `command`, which must start with the module id and a dot,
  or the call throws. Hover and
  clicks take only `kinds`; each click calls `onPick` with the picked ref,
  or `null` on empty space, and the module sets the selection itself. The
  viewport shows `hint`, and the command's toolbar button shows active.
  Escape, the command's own key, another command, a project or document
  change, the returned disposer or unload ends the mode once, calling
  `onEnd`. `measure(refs)` posts to `/projects/:id/measure` for the open
  project and resolves its `MeasureResult`, under the same access rule and
  open-project checks as `read`.
- `ui` passes the core `DraggablePanel`, `DialogFooter`, `NumField`,
  `LengthField`, `AngleField`, `SelectField`, `CheckField`, `TextField`,
  `TextAreaField` and `ContextMenu`, so a module dialog uses the KIT fields
  and a module right-click menu is the core menu. `LengthField`
  takes millimetres and shows the user's length unit. The
  `ui.useFormatLength()` hook returns `(mm, power?)`, formatted as core
  formats lengths, or areas and volumes for power 2 and 3, in the user's
  length unit, and redraws when the unit changes. `ui.openPanel(id)`
  and `ui.closePanel(id)` open and close a core panel.
- API 0.11.0: `DraggablePanel` takes optional `id` and `className` as core
  panels do. With an `id` the panel keeps its dragged position in
  `layout.panels`; the id must start with the module id and a dot, or the
  panel throws when it renders. `className` adds classes to the panel, so
  a module can use a core placement such as `measure`.
  `ui.formatAngle(deg, digits)` is the core angle format: degrees rounded
  to `digits` decimals with a degree sign. `ui.showError(message)` shows
  `message` on the core error line, as a core failure does.
- A number field's `value` may be `undefined`, which shows a blank box.
  With `onClear`, clearing the box calls it, so the module can store
  `undefined`; without it, a blank box shows "Enter a value" and calls
  nothing.
- `TextAreaField` takes `label`, `value`, `onChange`, a `maxLength` in
  characters, and optional `rows` (3) and `disabled`. Line breaks arrive
  as LF, because browsers normalise CRLF in a textarea. An edit past
  `maxLength` keeps the existing text and as much of the new text as fits,
  puts the caret after the kept insertion and shows
  `Cut to the <maxLength> character limit`. The alert clears on the next
  edit that fits or when the module changes `value`. An IME composition is
  cut when it ends.
- `ui.confirm(message)` asks through the core Confirm panel and resolves
  true on OK, false on Cancel or Escape. A newer confirm answers the open
  one false.
- `ui.download({ fileName, data, type })` saves `data` as a file named
  `fileName` of MIME `type` through the core download.
- `ui.pickFile({ accept, maxBytes })` opens the browser file picker for
  `accept` and resolves `{ name, text }`, or `null` on Cancel. A file over
  `maxBytes` rejects before it is read, stating the limit exactly: "This
  file is over the 2 KB file limit." or "over the 1000 B file limit."
  `maxBytes` is capped at `MODULE_DATA_MAX_BYTES`, 8 MB, the module user
  data limit; a `maxBytes` of 0, below 0 or NaN rejects.
- Where the browser lacks the file input `cancel` event, a cancelled pick
  never settles.
- `request(method, path, body?)` calls the module's own user routes under
  `/m/<moduleId>/`, with the dots of the id as slashes: `rockett.cam`
  sending `"tools"` reaches `/m/rockett/cam/tools`. It goes through the core
  client request, so the API prefix, JSON body, `ApiError` rejections and
  sign-out on 401 match core calls. `path` is one or more segments of
  letters, digits, `-` and `_` joined by single slashes; anything else,
  such as `..`, a leading slash, a URL, `%`, `?` or `#`, rejects before a
  request goes out. Project routes are not reachable: a read goes through
  `project.read` and a document edit through `project.mutate`. A user-data
  etag travels in the JSON body, as `userData` reads and writes it.

### Third-party plugins

Third-party plugins are trusted code, not sandboxed (DEC-501). Code:
`server/src/modules/thirdParty.ts`, limits in `PLUGIN_LIMITS`
(`server/src/tunables.ts`).

- Install by folder drop only: `ROCKETT_PLUGIN_DIR` (default
  `<DATA_DIR>/plugins`) holds `<id>/manifest.json`, `<id>/server.mjs` and
  an optional `<id>/client.mjs`.
  No route accepts uploads or writes plugins. The host scans the folder at
  startup and lists every plugin folder through `GET /modules`, after the
  shipped modules, sorted by folder name.
- The executable closure is the whole plugin folder: every file, whatever
  its name. Its sha256 hashes, in order of relative path (`/`-separated,
  sorted by UTF-16 code unit), the UTF-8 path, a NUL byte, the decimal byte
  length, a NUL byte and the file bytes. Empty folders do not count.
- A plugin `failed` when its folder or anything in it is a symlink or not
  a file or folder, when it exceeds `PLUGIN_LIMITS`, when the manifest is
  not JSON or fails `parseManifest`, when its `id` is not the folder name,
  when `server.mjs` is missing or has no default export with `activate`,
  or when a `.mjs`, `.cjs` or `.js` file names a module outside the folder:
  a literal `import`, `from` or `require` specifier must be a Node builtin
  or a relative path that stays inside. `client.mjs` may also name
  `HOST_IMPORTS` (`shared/src/moduleManifest.ts`), which the import map
  resolves to the host. A computed specifier is not checked.
- An incompatible `apiRange` lists `incompatible` and its code is never
  imported.
- Otherwise it stays `disabled` until an admin sets the app settings
  `plugin.<id>.enabled` to `true` and `plugin.<id>.sha256` to the closure
  sha256, which the `disabled` error names. Any later change to the folder
  changes the sha256 and disables it again, with a reason naming the new
  one.
- An enabled plugin is copied from the bytes it hashed into
  `<DATA_DIR>/plugin-stage/<id>/<sha256>/`, read-only, and imported from
  there, so edits to the source folder never reach running code. The stage
  is cleared at each start. The rest is the shipped module path above.
- The closure sha256 of every enabled plugin joins each body fingerprint,
  so a plugin update that keeps its data `version` still makes CAM
  operations stale.
- `GET /plugins/:id/client.mjs` serves a plugin's staged `client.mjs` as
  `text/javascript` to signed-in users, read-only, only while `GET /modules`
  lists it with `client: true`. Each request hashes the staged folder again
  and answers 404 once it no longer matches the closure sha256 it was
  enabled with.
- After the shipped client modules activate, `client/src/modules/thirdParty.ts`
  imports each listed `client` and calls its default export's `activate`
  with the same `ClientContext`. A failed import or activation logs
  `[rockett] module <id> failed: <message>` and skips only that plugin. The
  client context has no manifest `contributes`, so `settings` refuses every
  key.

## Project file

A `.rockett` file is `ProjectFile` in `shared/src/projectFile.ts`. Upload migrates
an older schema, validates, and rejects a newer `version` or `schemaVersion`
with 400; any failure creates nothing: `server/src/api/projectFile.ts`. A
stored project with a newer schema is listed as `tooNew`, and an invalid one
is 422 on load: `server/src/store/projectStore.ts`, which also owns temporary
projects.

Version 2 adds an optional `view`, the `PUT /projects/:id/view` body.
Version 3 adds `assemblies`, every assembly the manifest lists, in its order.
Download always writes it. Upload validates each one and every component must
name the file's part; the import, like Duplicate, rewrites those refs to the
new part id, keeps an acknowledged revision that matched the part's as the new
part's revision and sets any other to 0. A file without `assemblies` carries
none. A browser project cannot hold an assembly, so keeping such a file in the
browser fails and leaves the server copy.
Download writes the requesting user's view; upload stores it as the
uploader's, and a browser project keeps it in its record. A `view` that fails
that schema is 400 like a bad document. A file without one, such as any
version 1 file, takes its view from the document's old visibility flags as
before. Duplicate copies only the requesting user's view.

Imports and project files stream to disk under `uploads/`. A file over the
import budget is 413 before it is read: `withinImportBudget` in
`server/src/api/importers.ts`, which modules' `readStep` and `unzstd` use. Imported
STEP and mesh sources live in the project blob store; the feature holds the
hash in `blob`, and `GET /projects/:id/assets/:assetId` serves any project
blob, so a `.rockett` file and a browser project carry them as assets. A 3MF
source keeps only its content types, relationship and model parts;
thumbnails, slicer settings and other parts are dropped before storing. Model
parts whose declared sizes pass the 3MF package limit are 413. A package is
400 when its parts overlap, run past the zip directory, or would rebuild
larger than the upload: `slim3mf` in `server/src/geometry/read3mf.ts`. A
package that understates its expanded sizes fails as 400 at evaluation.

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
  (`server/src/geometry/signature.ts`). They also write the default targets,
  leaving out bodies the caller's view hides: `server/src/api/featureRoutes.ts`.
  See [CAD_MODEL.md](CAD_MODEL.md), Tool targets.
- A validation failure writes nothing.

## Limits

| Limit                                 | Owner                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| JSON request body                     | `JSON_BODY_LIMIT_BYTES`, `server/src/api/uploads.ts`                                |
| Import and project file upload, disk  | `ROCKETT_UPLOAD_MAX_MB`, `IMPORT_LIMITS` in `server/src/tunables.ts`                |
| Import and project file read, heap    | `ROCKETT_IMPORT_BUDGET_MB`, `IMPORT_LIMITS` in `server/src/tunables.ts`             |
| Mesh import triangles                 | `MAX_MESH_TRIANGLES`, `server/src/geometry/importers.ts`                            |
| Cut through a mesh body, triangles    | `MESH_LIMITS.cutTriangles`, `server/src/tunables.ts`                                |
| 3MF expanded package                  | `MAX_3MF_EXPANDED`, `server/src/geometry/read3mf.ts`                                |
| 3MF component placements              | `MAX_3MF_COMPONENTS`, `server/src/geometry/read3mf.ts`                              |
| Browser project file                  | `PROJECT_FILE_LIMIT_MB`, `shared/src/projectFile.ts`                                |
| Thumbnail                             | `THUMBNAIL_LIMITS`, `shared/src/routes.ts`                                          |
| Reference image                       | `IMAGE_LIMIT_MB`, `server/src/store/projectStore.ts`                                |
| History labels                        | `LABEL_LIMIT`, `shared/src/schema/history.ts`                                       |
| History disk bytes, checkpoints       | `HISTORY_LIMITS.bytes`, `HISTORY_LIMITS.checkpoints`, `server/src/tunables.ts`      |
| Previews, jobs, timeouts, size search | `server/src/tunables.ts`                                                            |
| Settings import                       | `SETTINGS_IMPORT_MAX_BYTES`; nodes and depth in `server/src/store/settingsStore.ts` |
| Module user data file and file pick   | `MODULE_DATA_MAX_BYTES`, `shared/src/units.ts`                                      |
