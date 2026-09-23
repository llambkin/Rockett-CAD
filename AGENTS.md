# Agent rules

## Taste

- Read `WORK-ORDER.md` (header and your row) and `LAST-RUN.md` before work.
  `WORK-ORDER.md` owns scope, rulings and queue state.
- Load the `complexity` skill before adding behaviour, state, a dependency, a
  service or a data model. Make the smallest surgical change that meets the row.
- Reuse before adding. When a second copy of a rule, constant, helper or UI
  pattern appears, the row that adds it concentrates it instead.
- Code carries no comments. The reason for a change goes in the commit body.
- Visual work needs an approved design first; without one, ask.

@~/masterrulez/GLOBAL_AGENT_WRITING_RULES.md

## Dangers

- Production changes need Mark's exact approval every time.
  Dev deploys follow the row that names them.
- Saved projects are user data. A change to the document shape ships a
  migration, a backup before migrating, and a test that loads the previous
  schema.
- Secrets, password hashes and session tokens stay out of logs, output and
  commits.
- This public repository contains application code and project documentation
  only. Never commit or publish secrets, environment files or actual environment
  values, machine names, deployment ports, IP addresses, private paths, fleet
  inventories, infrastructure configuration, logs, backups or user data.
  Keep operational records outside this checkout and out of public handoffs,
  commit messages, issues and pull requests. Generic application defaults and
  configuration variable names belong here; our deployment values do not.
- Before committing or publishing, inspect all staged content and outgoing
  commits for that boundary. Ignore rules do not protect tracked files or
  history. If sensitive material is found in history, stop publication and
  report its location without repeating its contents; agree remediation before
  rewriting history or changing credentials.
- Third-party code is supply chain: exact pins, frozen lockfile, installs with
  scripts disabled, and read what a pin brings in. Record its licence.
- Stop only processes you started.

## Surfaces

- `WORK-ORDER.md`: purpose, constraints, rulings, decisions and the row queue.
- `LAST-RUN.md`: handoff between runs, overwritten each run.
- `ARCHITECTURE.md`, `CAD_MODEL.md`, `FEATURE_TIMELINE.md`, `API.md`: update
  the one that owns a fact your row changes.
- `Brief.md`: the original 3D-printing brief, kept as history. It is not the
  scope.

## Verification

- Write the row's rejecting check first and watch it fail, then pass.
- Then `npm run check`, `git diff --check`, and read the diff.
- `scripts/check-work-order.sh` passes before and after every row. A change
  to the checker or the row statuses it knows also passes
  `scripts/test-work-order.sh`.
- Claim only checks you watched pass.

## Standard

Read `~/masterrulez/CODING-STANDARD.md` before changing code, tests, docs,
structure, tooling or delivery configuration. Local rules in `WORK-ORDER.md`
add to it.
