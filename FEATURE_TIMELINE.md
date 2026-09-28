# Feature timeline

The timeline is the chronological list of features at the bottom of the
workspace. It is the _product_: everything else exists to keep it editable.
The user guide covers the controls.

## Semantics

- `document.features` is the ordered history. Each feature has a stable id,
  a name, a `suppressed` flag, parameters and references to its inputs:
  profiles, persistent face and edge names, body ids (CAD_MODEL.md).
- `document.timelinePosition` is the marker: the count of active features.
  Features after it are rolled back, ghosted and skipped.
- New features insert at the marker, and the marker moves past them.
- Suppressed features keep their place and are skipped.

## Rollback contract

At marker _k_ the model is exactly as it was after feature _k_. You can pick
its faces, sketch on them, add features there and edit earlier ones. Later
features then rebuild through their persistent references.

Proof: `client/test/browser/coreModelling.test.ts` (plate, hole, fillet,
roll back, widen, insert, roll forward) and `server/test/geometry.test.ts`.

## Dependencies and failures

References form the dependency graph. The engine evaluates in order, so an
edit invalidates exactly the downstream suffix:
`server/test/engineCache.test.ts`. CAD_MODEL.md, Regeneration engine.

A feature whose reference is gone fails, is marked, and contributes nothing;
the pre-failure state carries forward. Its error names the reference. Under
`namingVersion` 2 it also blocks later features that use its bodies
(CAD_MODEL.md, Resolution). A reference can still land on the wrong face
without an error; see CAD_MODEL.md, Known limitations.

Nothing uses a proposed candidate until the user accepts it:
`client/test/refRepair.test.tsx`. API.md, Naming upgrade, owns the upgrade
contract.

## Kernel memory

The kernel never frees a shape by itself.

- Snapshots own their shapes and face name maps. `releaseSnapshots` in
  `server/src/geometry/engine.ts` frees what only discarded snapshots hold;
  a failed feature is released the same way.
- Short-lived handles (explored faces, lookups, adaptors) are deleted by the
  code that made them.
- Nobody deletes the shared `progress()` range.
- Read what you need from a shape before its engine is dropped.

Proof: `server/test/engineCache.test.ts`, `server/test/memorySoak.test.ts`.

## Undo is not the timeline

Undo restores whole document snapshots and walks your editing actions. The
timeline is part of the document. Undo moves through editing history; the
marker moves through modelling history. Proof:
`server/test/historyRoutes.test.ts`.
