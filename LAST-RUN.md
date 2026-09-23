# Last run

- DEC-003 done: Mark adopted the 2026-09-23 revision of `WORK-ORDER.md`. The
  proposal notice is gone; `## Proposed` reads None.
- OPS-029 done: `scripts/check-work-order.sh` rejects done or in-flight rows on
  unfinished dependencies, adds the ruled `deferred` status, parks rows named by
  Proposed entries and checks checkpoint coverage. `--complete` rejects every
  unfinished row.
- `scripts/test-work-order.sh` covers each rule with 20 fixtures; 14 fail
  against the old checker.
- `AGENTS.md` Verification names the checker tests.

## Next

OPS-001

## Stuck

0
