# Development

## Prerequisites

- Node.js 24 (`engines.node` is `>=24`; the image pins `node:24-trixie-slim`).
- npm 10 or newer (workspaces).
- Docker, only for container builds.
- `~/masterrulez/scripts/lint-writing`, only for `npm run check`.

## Setup and run

```bash
npm ci                 # .npmrc sets ignore-scripts=true
npm run prepare        # installs the husky hooks
export ROCKETT_ALLOWED_ORIGINS=http://localhost:5173
npm run dev            # API on :8788, Vite client on :5173
```

The server will not start without `ROCKETT_ALLOWED_ORIGINS`. Every write to
`/api` needs an allowed `Origin`: `server/src/auth/origin.ts`.

The OCCT kernel takes a few seconds to load after each server restart. Dev
data goes to `./data/` (gitignored).

## Workspaces

| Workspace | Commands                                                                  |
| --------- | ------------------------------------------------------------------------- |
| `shared`  | `npm test -w shared`                                                      |
| `server`  | `npm run dev -w server`, `npm test -w server`, `npm run build -w server`  |
| `client`  | `npm run dev -w client`, `npm run build -w client`, `npm run test:client` |

`@rockett/shared` is consumed as TypeScript source; the server build bundles
it with esbuild.

## Testing

```bash
npm test              # typecheck, then node and dom suites
npm run test:browser  # real-browser smoke test against a built app
npm run check         # ship command; see package.json "check"
```

Run `npm run check` before every commit. It stops at the first failure.

`playwright-core` ships no browser. Install it once with
`npx playwright-core install chromium-headless-shell`.

The public repository carries `shared/test/` and `modules/cam/test/`. The
server, client, DOM and browser suites stay in the team's working copies.

Geometry tests assert numbers: volumes, bounding boxes, face counts. Never
rely on a picture.

## Geometry layer

- Raw kernel access stays in `server/src/geometry/`. The API reaches it only
  through `KernelClient` in `server/src/kernel/client.ts`, so
  `server/src/api/` imports no geometry.
- The OCCT binding is typed loosely. Check signatures against
  `node_modules/opencascade.js/dist/opencascade.rockett.d.ts` and
  `dist/rockett-helpers.d.ts`. Emscripten overloads carry `_1`, `_2`
  suffixes. Int64 values are BigInt; `Standard_Size` is a number.
- Wrap kernel calls in `kernelCall()` (`server/src/geometry/kernel.ts`) so
  aborts become readable errors.
- A feature type registers through `shared/src/featureSpec.ts` and
  `server/src/geometry/kinds.ts`. `shared/test/featureSpec.test.ts` fails on
  a missing registration.
- A schema change bumps `SCHEMA_VERSION` and adds a step, keyed by the old
  version, to `documentMigrations` in `server/src/store/migrations.ts`.

## Conventions

- Stored geometry is millimetres; convert only at display.
- Never reference topology by index. Use persistent names (CAD_MODEL.md).
- A failed feature records an error and the engine carries on with the
  pre-failure state: `server/src/geometry/engine.ts`.
- Before merging geometry changes, run a sketch, extrude, fillet loop in the
  UI.

## Browser test waits

A browser test waits for a state the app shows before its next action: a
status badge, a measure line, or the stored document. A click handler that
finds the app busy drops the click, and `.busy-indicator` can still be absent
right after a click, so its absence alone is not a wait. Fix a load failure
with the right wait, never a longer timeout or a fixed delay.
