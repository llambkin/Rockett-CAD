# Development

## Prerequisites

- Node.js ≥ 24
- npm ≥ 10 (workspaces)
- Docker (only for container builds)

## Setup & run

```bash
npm install
npm run dev
```

- API server: http://localhost:8788 (tsx watch; the OCCT WASM kernel takes a
  few seconds to load on each restart)
- Client: http://localhost:5173 (Vite, proxies `/api` to 8788)

Data in dev goes to `./data/` (gitignored).

## Workspaces

| Workspace | Commands                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `shared`  | `npm test -w shared` — solver + profile-detection tests                                                             |
| `server`  | `npm run dev -w server`, `npm test -w server`, `npm run build -w server` (esbuild bundle → `server/dist/server.js`) |
| `client`  | `npm run dev -w client`, `npm run build -w client` (Vite → `client/dist`)                                           |

`@rockett/shared` is consumed as TypeScript source (tsx and Vite both
transpile it); the server production build bundles it via esbuild.

## Testing

```bash
npm test          # shared + server suites
```

The suites map to the layers the brief requires:

- **Geometry** (`server/test/geometry.test.ts`) — extrude dimensions/volumes,
  boolean cut volume, fillet volume delta, face/edge/vertex counts and
  persistent names, parametric regeneration after upstream edits, timeline
  rollback, broken-reference error reporting.
- **Face extrude** (`server/test/faceExtrude.test.ts`) — extruding body faces
  directly (boss + pocket).
- **Solver** (`shared/test/solver.test.ts`) — dimensioned rectangle converges
  exactly, DOF classification, conflicting constraints detected, tangent,
  drag-with-polish.
- **Profiles** (`shared/test/profiles.test.ts`) — region extraction, holes,
  shared-edge subdivision, stable profile ids.
- **Persistence** (`server/test/store.test.ts`) — round-trip, duplicate, list,
  delete, path-traversal rejection.
- **Export** (`server/test/export.test.ts`) — binary STL structure + bounds,
  3MF unzips with named objects and millimetre units.
- **API integration** (`server/test/api.test.ts`) — the complete MVP workflow
  over real HTTP, ending in reload-and-verify.

Write geometry tests as _reproducible numeric models_ (exact volumes, bounding
boxes, face counts) — never rely on visual confirmation alone.

## Working on the geometry layer

- All raw kernel access stays inside `server/src/geometry/`. The OCCT API is
  typed loosely (`OC = any`); check binding signatures against
  `node_modules/opencascade.js/dist/opencascade.full.d.ts` — emscripten
  overloads carry `_1`, `_2`, … suffixes.
- Every feature evaluator must: validate inputs, use `kernelCall()` so kernel
  aborts become readable errors, and propagate persistent names
  (`naming.ts`) for every face of every produced shape.
- New feature types touch: `shared/src/model.ts` (schema + label),
  `server/src/geometry/features.ts` (evaluator + dispatcher),
  `server/src/api/validate.ts`, client dialog + `dialogPicks.ts`, and a test.
- Schema changes bump `SCHEMA_VERSION` and add a migration in
  `server/src/store/migrations.ts`.

## Conventions

- Internal units are always millimetres; convert only at display.
- Never reference topology by index — persistent names only (CAD_MODEL.md).
- The engine must keep working through feature failures: catch, record an
  actionable error, continue with the pre-failure state.
- Keep the working app runnable at every commit: `npm test` + open the UI and
  run a sketch→extrude→fillet loop before merging geometry changes.

Client history regressions run with `npm run test:client` (also included in `npm test`).
They cover sketch-mode preservation, authoritative solved positions, undoing the
sketch creation, and repeated undo input while a request is pending.
