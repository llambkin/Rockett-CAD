# Last run

Paused on request after the running rows finished. No agents are running.

- Done this run: CUST-030, CUST-031, CUST-032, BUG-038, BUG-039, BUG-040,
  PERF-041, REF-004, PERF-035, and DOC-010, DOC-011, DOC-012, DOC-015 and
  DOC-017. `npm run check` passed on each merge: 944 tests, 20 browser tests
  and the work order check.
- Dev runs `ba3ac60`, schema 10.
- Prod still runs schema 6. Deploying it migrates every project from schema
  6 to 10, which needs Mark's approval first.
- A fillet drag on the 1,000-body model takes about 70 ms, down from about
  500 ms, because edits now send only the meshes the client lacks.

## Next

CUST-033 (drag handles on every feature) is queued and not started. After
it, DOC-018.

## Left open

- The toolbar error message contains an em dash.
- A crash mid-import leaves a file in `uploads/`, and nothing removes it.
- `app.ts` cannot configure the import limits.
- `view.json` has no backups.
- Pick labels follow payload order.
- REF-004 proposes hashing identity outside names.
- PERF-035 covers linear patterns only, not circular patterns, mirrors or
  moves.
- PERF-041 set its timing budgets after the before run. The engine missed
  100 ms at load average 22.
- `api.ts` keeps one evaluation's meshes after a project closes.
- When editing, BUG-040 counts bodies from later features as bodies to cut.

## Waiting on Mark

- The schema 6 to 10 prod migration.
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
