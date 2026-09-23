# Last run

- 86 commits since adoption (`e328a0f`). Done: OPS-001 to 016, 018 to 022,
  024 to 031; BUG-001 to 003, 009 to 025 and BUG-CP; KIT-001 to 007, 016, 017,
  019 to 023; AUTH-002 to 004 and 008; SET-006, SET-008; PERF-001, 009, 020;
  CUST-003; EXCH-001; DEC-403.
- AUTH-008: every write to `/api` needs an `Origin` listed in
  `ROCKETT_ALLOWED_ORIGINS`, and the server will not start without it. The
  browser smoke harness reserves a port and passes its own origin.
- New rows from Mark on 2026-09-23: OPS-032 to 034 (README feature lines, cost
  table, god file benches), BUG-026 and 027 (line angle constraint, angle snap
  and lock), SET-022 (user snap angles).
- Dev runs `c8e6b94`. Prod is unchanged.
- In flight: OPS-017, OPS-032, KIT-018, KIT-024, SET-009, BUG-026.

## Next

OPS-017

## Stuck

0
