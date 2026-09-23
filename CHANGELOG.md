# Changelog

Versions follow semver. The root `package.json` owns the one app version;
the workspace versions stay `0.1.0`. `SCHEMA_VERSION` (document format) is
versioned separately in `shared/src/model.ts`; `/api/health` reports both.

A release moves `Unreleased` into a dated `## X.Y.Z` section and gets an
annotated tag `vX.Y.Z` on that `origin/main` commit. Every `SCHEMA_VERSION`
change gets a `Schema N` line in the section that ships it.

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
- Sweep paths with arcs build, and a path sweeps the same whatever order its
  curves were drawn in. A branched or disconnected path is a feature error.
- A shell with no open faces hollows the body. Before, it replaced the body
  with its inner offset solid.
- The API rejects malformed features and documents with 400 instead of a 500
  or a saved bad value: references, list items, enums, flags, plane and axis
  refs, `suppressed`, the document base shape, and feature keys the type does
  not declare.
- Export rejects unknown body ids, naming them, and a non-numeric `quality`.
  Before, unknown ids were dropped and `quality` fell back to 0.05.
- Reading an evaluation no longer rewrites the project file.
- A STEP import writes its own kernel file, so it cannot overwrite or delete
  another import's.
- A move no longer changes when a later feature is added.
- Reopening an extrude and pressing OK without edits leaves it unchanged, so
  later features are not regenerated.
- Esc cancels an open feature dialog and reverts its preview.
- Live previews keep one request in flight. A late reply no longer overwrites
  a newer preview, a cancel or a commit.
- Sketch rebuilds, construction plane updates, reference image changes and
  closing the viewport free their GPU geometry, materials and unused textures.

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
- Export requires `bodyIds`; a missing or non-array value returns 400. An
  empty array still exports every visible body. `ExportRequest.binary` is
  removed: STL export was always binary.

### Known issues

- Face naming: sweep and loft faces and the end faces of a full revolve take
  fallback `x` names, joins, mirrors and patterns with `combine` keep coplanar
  splits, and press/pull renames the moved face. BUG-004, BUG-005, BUG-006,
  BUG-007 and BUG-008 fix these under naming version 2; existing projects keep
  today's names (DEC-101).
- A circular pattern with `combine` and disjoint copies renumbers its bodies
  by volume, so references to the original body move (REF-018).
- Closing or switching projects does not end a live preview session.
- Gizmo geometry is disposed twice when the viewport unmounts (KIT-003 to
  KIT-005).
- A missing file under `/assets` returns the app page instead of 404.
- Each sketch arc edge leaks three kernel `gp_Pnt` objects.
- Feature updates check the patch keys, not the merged feature, so an unknown
  key saved before this release survives an edit.

## 0.1.0 (2026-09-23)

Initial source: parametric sketcher and solver, B-Rep features on OpenCascade
WASM, persistent topology naming, feature timeline, STEP import, STL and 3MF
export, sketch offsets and temporary timeline rewind.

- Schema 4: a sketch keeps an `offsets` list, so an offset can be edited by
  distance. The 3 to 4 migration only bumps the version.
