# Feature Timeline

The timeline is the chronological list of parametric features at the bottom of
the workspace. It is the _product_ — everything else exists to keep it
editable.

## Semantics

- `document.features` is the ordered history; every modelling operation is a
  feature (`Sketch1`, `Extrude1`, `Fillet1`, …) with a stable id, a display
  name, a `suppressed` flag, parameters, and references to its inputs
  (profiles by sketch+profile id, topology by persistent face/edge names,
  bodies by body id — see CAD_MODEL.md).
- `document.timelinePosition` is the marker: the number of currently active
  features. Features after the marker exist but are **rolled back** — they are
  ghosted in the UI and skipped by the engine.

## Operations

| Action                | Mechanics                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Select / hover        | Chip click; tooltip shows type + any error                                                                                                     |
| Rename                | Context menu → inline edit (stored on the feature)                                                                                             |
| Edit                  | Double-click or context menu; sketches open the sketch editor, other features open their parameter dialog pre-filled (same dialog as creation) |
| Suppress / unsuppress | Context menu; suppressed features are skipped during evaluation but keep their place in history                                                |
| Delete                | Context menu (no confirm — Ctrl+Z restores)                                                                                                    |
| Roll back / forward   | Click any marker gap, the ⏮◀▶⏭ controls, or drag intent via repeated stepping                                                                  |
| Insert mid-history    | Roll back to the insertion point, then create features normally — new features insert **at the marker**, and the marker advances past them     |

## Rollback contract (the fundamental requirement)

Rolling the marker back to position _k_ shows the model exactly as it existed
after feature _k_. While rolled back you can:

- select faces that exist _at that point in history_,
- sketch on them, dimension, constrain,
- create features — they are inserted at the marker,
- edit earlier features (double-click),
- then return to the end of the timeline.

Later features rebuild against the modified model through their persistent
references. This is exercised end-to-end by
`server/test/geometry.test.ts` and `server/test/api.test.ts` (the MVP
workflow: 100×50 plate → hole → fillet → roll back → widen to 120 → roll
forward → hole and fillet regenerate).

## Dependencies and failures

Feature references form the dependency graph implicitly: a feature that
consumes `sketchId`s, `bodyId`s, or persistent face/edge names depends on
whatever produces them. The engine evaluates chronologically, so dependencies
are always evaluated first; an edit invalidates exactly the downstream suffix
(snapshot cache, CAD_MODEL.md → "Regeneration").

If an upstream change removes geometry a downstream feature references, that
feature is marked in the timeline:

> ⚠ Fillet1 — referenced edge no longer exists: e[f:…|f:…]

The model is **never silently corrupted**: the failed feature contributes
nothing, the pre-failure state carries forward, and the error text names the
missing reference. Fixing the upstream edit (or editing the failed feature to
re-select) clears the error. A guided "repair reference" flow is on the
roadmap.

## Undo/redo is not the timeline

Undo (Ctrl+Z) restores whole document snapshots — it un-does _your editing
actions_ (created a feature, changed a dimension, renamed, deleted…). The
timeline is part of the document being snapshotted. The two are independent
axes, as in mainstream CAD: undo moves through editing history, the marker
moves through modelling history.
