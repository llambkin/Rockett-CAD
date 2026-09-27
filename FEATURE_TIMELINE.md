# Feature timeline

The timeline is the chronological list of parametric features at the bottom of
the workspace. It is the _product_: everything else exists to keep it
editable.

## Semantics

- `document.features` is the ordered history; every modelling operation is a
  feature (`Sketch1`, `Extrude1`, `Fillet1`, …) with a stable id, a display
  name, a `suppressed` flag, parameters, and references to its inputs
  (profiles by sketch+profile id, topology by persistent face/edge names,
  bodies by body id, see CAD_MODEL.md).
- `document.timelinePosition` is the marker: the number of currently active
  features. Features after the marker exist but are **rolled back**: they are
  ghosted in the UI and skipped by the engine.

## Operations

| Action                | Mechanics                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select / hover        | Chip click selects the bodies `bodyMadeBy` gives the feature plus its status `targets`, Ctrl or Cmd adds, and an open dialog takes them into its active input; tooltip shows type + any error; resting 0.3 s on a chip shows the model after it without changing the document, and highlights the faces it named, its sketch or its plane |
| Rename                | Context menu → inline edit (stored on the feature)                                                                                                                                                                                                                                                                                        |
| Edit                  | Double-click or context menu; sketches open the sketch editor, other features open their parameter dialog pre-filled (same dialog as creation)                                                                                                                                                                                            |
| Suppress / unsuppress | Context menu; suppressed features are skipped during evaluation but keep their place in history                                                                                                                                                                                                                                           |
| Delete                | Context menu (no confirm, Ctrl+Z restores)                                                                                                                                                                                                                                                                                                |
| Roll back / forward   | Click any marker gap, the ⏮◀▶⏭ controls, or drag intent via repeated stepping                                                                                                                                                                                                                                                             |
| Insert mid-history    | Roll back to the insertion point, then create features normally. New features insert **at the marker**, and the marker advances past them                                                                                                                                                                                                 |

## Rollback contract (the fundamental requirement)

Rolling the marker back to position _k_ shows the model exactly as it existed
after feature _k_. While rolled back you can:

- select faces that exist _at that point in history_,
- sketch on them, dimension, constrain,
- create features, which are inserted at the marker,
- edit earlier features (double-click),
- then return to the end of the timeline.

Later features rebuild against the modified model through their persistent
references. The MVP workflow exercises this end to end: 100×50 plate → hole →
fillet → roll back → widen to 120 → roll forward → hole and fillet regenerate.

## Dependencies and failures

Feature references form the dependency graph implicitly: a feature that
consumes `sketchId`s, `bodyId`s, or persistent face/edge names depends on
whatever produces them. The engine evaluates chronologically, so dependencies
are always evaluated first; an edit invalidates exactly the downstream suffix
(snapshot cache, CAD_MODEL.md → "Regeneration").

Snapshots own the kernel shapes and face name maps in their state. The
kernel never frees a shape by itself, so when snapshots are truncated,
invalidated or their engine is dropped, `releaseSnapshots` in `engine.ts`
deletes every body shape and name map that only discarded snapshots hold. A
shape or map a kept snapshot shares through `cloneState` stays. A failed
feature releases its partial state the same way. Name maps made while a
feature evaluates are released when it ends unless a body in its result holds
them.
A caller that needs a shape after its engine is dropped reads what it needs
first. Short-lived handles, such as explored faces and edges, name lookups
and adaptors, are deleted by the code that made them. Kernel calls share the
one progress range `progress()` returns, which lives as long as the kernel
and which no caller deletes.

If an upstream change removes geometry a downstream feature references, that
feature fails and is marked in the timeline. Its error names the reference:
a fillet reports `referenced edge no longer exists: e[f:…|f:…]`, or under
`namingVersion` 2 `edge e[f:…|f:…] no longer exists on b:…`.

The failed feature contributes nothing and the pre-failure state carries
forward. Under `namingVersion` 2 a feature whose references do not resolve
also blocks the later features that use its bodies; see CAD_MODEL.md,
Resolution. Fixing the upstream edit (or editing the failed feature to
re-select) clears the error. A reference can still resolve on the wrong face,
edge or split piece without an error; see CAD_MODEL.md, Known limitations.

When the feature's status carries `refs`, the chip's tooltip lists each one
as candidate, ambiguous or missing instead of the raw error. The edit dialog
opens with a References section, one row per reference. A candidate row names
the proposed face or edge and its basis, lineage or signature, and pointing at
it highlights it. Accept writes that face or edge into the feature through the
normal feature update, one undo step, keeping a tool feature's chosen targets;
the server signs the new reference. Nothing uses a candidate before Accept.

An ambiguous or missing row lists each candidate, then each `suggestions`
entry on another body, one row each with Accept, and pointing at a row
highlights it. Its Pick button takes the next click in the viewport instead:
the dialog's pick filter applies, a face or edge of the reference's kind goes
through the same Accept path, and any other click is ignored. Stop, or
closing the dialog, ends picking. The dialog's own selection is untouched.

On a `namingVersion` 1 project the edit dialog also shows a Naming section.
Upgrade naming stages the upgrade (see API.md, Naming upgrade) and lists every
mapping with its status, a count per status and the backup name. A candidate
or ambiguous mapping takes a choice through the same rows and Accept, and each
choice stages the report again. These rows offer no Pick and no highlight,
since the viewport shows version 1 geometry. Apply upgrade stays disabled
until every candidate and ambiguous mapping has a choice, then commits as one
undo step, and undo returns the project to version 1. The dialog closes after
the commit. A report staged on an older revision is hidden.

## Undo/redo is not the timeline

Undo (Ctrl+Z) restores whole document snapshots. It un-does _your editing
actions_ (created a feature, changed a dimension, renamed, deleted…). The
timeline is part of the document being snapshotted. The two are independent
axes, as in mainstream CAD: undo moves through editing history, the marker
moves through modelling history.
