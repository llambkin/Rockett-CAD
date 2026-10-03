# Architecture

The triangle mesh is only a picture. The B-Rep model that OpenCascade builds
from the parametric document is the geometry.

```
Browser UI (React)
   ↓ selection, tool state, dialogs
3D viewport (three.js)
   ↓ REST (JSON)
Parametric document (shared TypeScript schema)
   ↓
Geometry service (Node.js, regeneration engine + caches)
   ↓
CAD kernel (OpenCascade 8.0.1 compiled to WebAssembly)
   ↓
B-Rep model (TopoDS solids, faces, edges, vertices)
```

## Repository layout

| Path          | Role                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `shared/`     | Document schema, sketch solver, profiles, routes, units. Browser and server run the same code. |
| `server/`     | Express API, project store, kernel worker and geometry layer.                                  |
| `client/`     | React and three.js UI.                                                                         |
| `modules/`    | Optional modules, such as CAM.                                                                 |
| `plugin-api/` | `@rockett/plugin-api`, the only core package a module imports.                                 |
| `docker/`     | Unraid template.                                                                               |

## Key decisions

**Kernel: OpenCascade WASM on the server.** A full B-Rep kernel with no
native build. Geometry lives in `server/src/geometry/`; the API reaches it
only through `KernelClient` (`server/src/kernel/client.ts`).
`WorkerKernel` runs it in one worker thread so health and requests stay
responsive during a long regeneration; `ROCKETT_KERNEL=inprocess` runs it on
the main thread. A worker crash quarantines the running feature, blocks its
dependents and exports, and restarts with a bounded backoff:
`server/src/kernel/workerKernel.ts`.

**Server owns the document.** Clients send feature-level edits; the server
validates, evaluates, saves and returns the document with the model. Every
document edit except a project rename goes through `mutateProject` in
`server/src/api/routes.ts`. A stale revision gets 409 and writes nothing:
`server/src/api/revision.ts`. Undo is server history, separate
from the timeline (FEATURE_TIMELINE.md). Hidden items and the camera are
per-user view state, outside the document and undo:
`server/src/store/viewStore.ts`. API.md owns the routes, revisions and
history contracts.

**Storage.** `server/src/store/` owns persistence. Writes are atomic
(`server/src/store/storage.ts`). A migration backs up the whole project
before its first write (`backupNamespace` in `server/src/store/jsonStore.ts`).
The history log survives a crash mid-save
(`server/src/store/historyStore.ts`).
DOCKER.md owns the disk layout and the backup and restore steps.

**Shared parametric code.** The solver and profile detection run in the
browser while dragging and on the server during regeneration. One
implementation, so they cannot drift.

**Two tiers.** Drag solving, profile highlight and selection stay in the
browser; committed operations run through the kernel. An edit to feature _k_
re-evaluates only _k..end_: `server/src/geometry/engine.ts`. CAD_MODEL.md,
Regeneration engine, has the detail.

**Units.** Stored geometry is millimetres. The `units.length` setting in
`shared/src/settings.ts` owns the display unit; `shared/src/units.ts` owns
conversion and parsing (`shared/test/units.test.ts`).

**Dialog form kit.** `client/src/components/form/` holds every dialog field
and the one OK and Cancel footer. No other component renders a raw number
input. An empty or partial box never writes 0 or NaN:
`client/src/components/form/fields.tsx`.

## Identity

Middleware order in `server/src/app.ts`: origin check, session, router. A
state-changing request without an allowed `Origin` fails before
authentication (`server/src/auth/origin.ts`). Only health, setup, status and
login pass without a session (`server/src/auth/middleware.ts`). The CAD
router checks project access first (`server/src/api/projectAccess.ts`).

## Security posture

- The API exposes modelling operations only, no command execution.
- `server/src/api/validate.ts` checks every parameter before the kernel.
- Ids are validated on every path access; traversal is refused:
  `storagePath` in `server/src/store/storage.ts`.
- Images are checked by magic bytes and size capped: `imageMime` in
  `server/src/store/projectStore.ts`.
- The container runs as a non-root user and writes only `/data`.
- Passwords are scrypt hashes (`server/src/auth/password.ts`); sessions use
  HttpOnly cookies. Project owners and members decide access.

## Performance

- Regeneration is incremental, cached per feature.
- Engines, tessellations and encoded meshes sit in bounded LRU caches.
  Engines evict by measured bytes against `ENGINE_CACHE` in
  `server/src/tunables.ts`, a share of the host memory limit; the mesh limit
  is in `server/src/kernel/meshCache.ts`.
- Viewport work never calls the kernel.
- Sketch drags solve in the browser; API.md, Evaluation, says when a sketch
  write or evaluation solves.
