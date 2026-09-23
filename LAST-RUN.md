# Last run

Paused on request after the running rows finished. DOC-018 then ran alone,
then BUG-041, then DOC-019.
No agents are running.

- Done this run: CUST-030, CUST-031, CUST-032, BUG-038, BUG-039, BUG-040,
  PERF-041, REF-004, PERF-035, and DOC-010, DOC-011, DOC-012, DOC-015,
  DOC-017, DOC-018 and DOC-019. `npm run check` passed on each: 966
  tests, 20 browser tests and the work order check on DOC-019.
- DOC-018 moves visibility out of the document into `view.json` and bumps
  the schema to 11. A project migrates on its next write, and `view.json` is
  in its backup. Legacy `visible` patches still work until DOC-020.
- Dev runs `ca82151`, schema 11, with DOC-018 and BUG-041. Each dev project
  moves to schema 11 on its next write, after a backup. DOC-019 is not
  deployed.
- DOC-019: the client hides and shows through `PUT /view`. A toggle is no
  undo step, sends no document edit and requests no evaluation. Undo and
  feature edits no longer send `visible`, so they cannot overwrite the view.
- Prod still runs schema 6. Deploying it migrates every project from schema
  6 to 11, which needs Mark's approval first.
- A fillet drag on the 1,000-body model takes about 70 ms, down from about
  500 ms, because edits now send only the meshes the client lacks.
- BUG-041: pushing up the top face of a filleted body hung the server in
  OCCT's face unify, an infinite loop on one 18-face solid, which is what
  hung the dev instance on the 1,000-body project. The fixture now opens in
  1.4 s and edits in about 200 ms. The Docker health probe gives up after 5 s.
  Deployed to dev. The 1,000-body project there evaluates in 1.9 s cold and
  0.15 s warm.

## Next

DOC-020. CUST-033 (drag handles on every feature) is still queued and not
started.

## Left open

- The toolbar error message contains an em dash.
- A crash mid-import leaves a file in `uploads/`, and nothing removes it.
- `app.ts` cannot configure the import limits.
- A view PUT overwrites `view.json` with no backup. Only a document
  migration backs it up.
- Pick labels follow payload order.
- REF-004 proposes hashing identity outside names.
- PERF-035 covers linear patterns only, not circular patterns, mirrors or
  moves.
- PERF-041 set its timing budgets after the before run. The engine missed
  100 ms at load average 22.
- `api.ts` keeps one evaluation's meshes after a project closes.
- When editing, BUG-040 counts bodies from later features as bodies to cut.
- Project files, duplicates and browser projects no longer carry hidden
  bodies or sketches. See Proposed.
- A construction plane's eye still suppresses the plane. See Proposed.
- BUG-041 leaves a seam ring where a pushed-up fillet's cylinder meets one
  whose frame differs. A kernel call that never returns still blocks the
  server until the PERF-011 worker lands.

## Waiting on Mark

- The schema 6 to 11 prod migration.
- OCP novtk.
- Backup retention.
- Mesh upload limit.
- Payload budget.
- Insert DXF and SVG icons.
- The DEC-403 accent split.
- Integer-only pattern counts.
- EXCH-026 database ownership.
- Browser folder controls.

## Stuck

0
