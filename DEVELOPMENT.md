# Development

## Prerequisites

- Node.js 24 or newer (`engines.node` is `>=24`). Develop on 24, the line the
  Docker image pins (`node:24-trixie-slim`).
- npm ≥ 10 (workspaces)
- Docker (only for container builds)
- `~/masterrulez/scripts/lint-writing` (only for `npm run check`)

## Setup & run

```bash
npm ci
npm run prepare
export ROCKETT_ALLOWED_ORIGINS=http://localhost:5173
npm run dev
```

The server will not start without `ROCKETT_ALLOWED_ORIGINS`, and every write
to `/api` needs an `Origin` in it. List bare origins separated by commas,
such as `http://localhost:5173,https://cad.example.com`.

`.npmrc` sets `ignore-scripts=true`, so `npm ci` skips lifecycle scripts.
`npm run prepare` installs the husky git hooks.

- API server: http://localhost:8788 (tsx watch; the OCCT WASM kernel takes a
  few seconds to load on each restart)
- Client: http://localhost:5173 (Vite, proxies `/api` to 8788)

Data in dev goes to `./data/` (gitignored).

## Workspaces

| Workspace | Commands                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `shared`  | `npm test -w shared`: solver + profile-detection tests                                                              |
| `server`  | `npm run dev -w server`, `npm test -w server`, `npm run build -w server` (esbuild bundle → `server/dist/server.js`) |
| `client`  | `npm run dev -w client`, `npm run build -w client` (Vite → `client/dist`), `npm run test:client` (from the root)    |

`@rockett/shared` is consumed as TypeScript source (tsx and Vite both
transpile it); the server production build bundles it via esbuild.

## Testing

```bash
npm test              # typecheck, then shared, server and client suites
npm run test:browser  # real-browser smoke test against a disposable built app
npm run check         # ship command: lint, format, comments, cost, writing, README,
                      # pins, notices, build, test, browser smoke, work order
```

Run `npm run check` before every commit. It stops at the first failure.

`playwright-core` ships no browser. Install the pinned headless shell once
with `npx playwright-core install chromium-headless-shell`.

The suites map to the layers the brief requires:

- **Geometry** (`server/test/geometry.test.ts`): extrude dimensions/volumes,
  boolean cut volume, fillet volume delta, face/edge/vertex counts and
  persistent names, parametric regeneration after upstream edits, timeline
  rollback, broken-reference error reporting.
- **Face extrude** (`server/test/faceExtrude.test.ts`): extruding body faces
  directly (boss + pocket).
- **Solver** (`shared/test/solver.test.ts`): dimensioned rectangle converges
  exactly, DOF classification, conflicting constraints detected, tangent,
  drag-with-polish.
- **Profiles** (`shared/test/profiles.test.ts`): region extraction, holes,
  shared-edge subdivision, stable profile ids.
- **Persistence** (`server/test/store.test.ts`): round-trip, duplicate, list,
  delete, path-traversal rejection.
- **Export** (`server/test/export.test.ts`): binary STL structure + bounds,
  3MF unzips with named objects and millimetre units.
- **API integration** (`server/test/api.test.ts`): the complete MVP workflow
  over real HTTP, ending in reload-and-verify.
- **Client** (`client/test/`, DOM tests in `client/test/dom/`): sketch-mode
  preservation, authoritative solved positions, undoing the sketch creation,
  and repeated undo input while a request is pending.

Write geometry tests as _reproducible numeric models_ (exact volumes, bounding
boxes, face counts). Never rely on visual confirmation alone.

## Working on the geometry layer

- All raw kernel access stays inside `server/src/geometry/`. The OCCT API is
  typed loosely (`OC = any`); check binding signatures against
  `node_modules/opencascade.js/dist/opencascade.full.d.ts`. Emscripten
  overloads carry `_1`, `_2`, … suffixes.
- Every feature evaluator must: validate inputs, use `kernelCall()` so kernel
  aborts become readable errors, and propagate persistent names
  (`naming.ts`) for every face of every produced shape.
- New feature types touch: `shared/src/model.ts` (schema + label),
  `server/src/geometry/features.ts` (evaluator + dispatcher),
  `server/src/api/validate.ts`, client dialog + `dialogPicks.ts`, and a test.
- Schema changes bump `SCHEMA_VERSION` and add a step, keyed by the old
  version, to `documentMigrations` in `server/src/store/migrations.ts`.

## Conventions

- Internal units are always millimetres; convert only at display.
- Never reference topology by index. Use persistent names only (CAD_MODEL.md).
- The engine must keep working through feature failures: catch, record an
  actionable error, continue with the pre-failure state.
- Keep the working app runnable at every commit: `npm run check` + open the UI and
  run a sketch→extrude→fillet loop before merging geometry changes.
