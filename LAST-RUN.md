# Last run

- DOC-010, DOC-011, DOC-012, DOC-015 and DOC-017 are done on `lane/design`,
  one commit each. `npm run check` passed before every commit: 911 tests, 20
  browser tests and the work order check on the last one.
- Document edits need `If-Match: "<revision>"`. A stale edit gets 409, and
  the client keeps it until the user reapplies or discards it.
- Schema is 10: `extensions` holds module data. A deploy migrates each
  project below 10 on its next save and backs it up first.
- Model imports stream to `uploads/` and move into the blob store. Both
  limits stay at 10 MB. An 8.3 MB STEP peaks at about 1.1 GB RSS in the test
  process, and the WASM heap stays at 100 MB.
- `GET` and `PUT /projects/:id/view` store hidden bodies and features in
  `view.json`. Nothing reads it yet; DOC-018 moves visibility there. Nothing
  was pushed or deployed.

## Next

DOC-018

## Stuck

0
