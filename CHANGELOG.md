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
- Docker: Node 22 base image pinned by digest; build and runtime installs use
  `npm ci` from the lockfile. `docker/runtime-package.json` is removed.

## 0.1.0

Initial source: parametric sketcher and solver, B-Rep features on OpenCascade
WASM, persistent topology naming, feature timeline, STEP import, STL and 3MF
export, sketch offsets and temporary timeline rewind.
