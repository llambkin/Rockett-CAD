# Changelog

Versions follow semver. `SCHEMA_VERSION` (document format) is versioned
separately in `shared/src/model.ts`; `/api/health` reports both.

## Unreleased

### Fixed

- Rewinding the timeline (sketch edit, tangent-edge and projection queries)
  no longer discards cached downstream features, so returning to the end does
  not regenerate them.
- Reopening a feature for editing keeps its references: circular and linear
  pattern edge or sketch-line axes, split body tools, and midplane inputs were
  lost and replaced by defaults on OK.
- Editing a suppressed feature no longer unsuppresses it.
- The API rejects unknown feature types, changing a feature's type, missing
  reference arrays, and unknown export formats with 400. Sweep, loft, combine,
  split body, mirror and chamfer edges are now validated.
- M opens Move and I starts Measure, matching Fusion 360. Before, M was shown
  for both and started Measure.

### Changed

- `/api/health` returns `version`, `schemaVersion` and `commit`.
- `npm test` runs `tsc` on all workspaces first.
- Docker: base image pinned by digest; build and runtime installs use `npm ci`
  from the lockfile. `docker/runtime-package.json` is removed.
- Dependencies at their latest releases, pinned exactly: Express 5, multer 2,
  React 19, three 0.186, Vite 8, Vitest 5, TypeScript 7, esbuild 0.28.
  `npm audit` reports 0 vulnerabilities, down from 8 (1 critical, 1 high).
  Node 24 is the minimum; the image is `node:24-trixie-slim`.
  `npm-run-all` is replaced by its maintained fork `npm-run-all2`.

## 0.1.0

Initial source: parametric sketcher and solver, B-Rep features on OpenCascade
WASM, persistent topology naming, feature timeline, STEP import, STL and 3MF
export, sketch offsets and temporary timeline rewind.
