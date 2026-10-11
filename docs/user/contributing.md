# Contributing

Send changes as pull requests to `main` on
[msegec/Rockett-CAD](https://github.com/msegec/Rockett-CAD). Mark (`msegec`)
or Liam (`llambkin`) reviews each one and merges it into `main`.

## Send a change

1. Fork the repository, or push a branch if you have write access.
2. Branch from `main`. Keep one change per pull request.
3. Set up with [DEVELOPMENT.md](../../DEVELOPMENT.md), but skip
   `npm run prepare`.
4. Run the checks below.
5. Open a pull request against `main` and fill in the template.

## Checks

```bash
npm run lint
npm run format:check
npm run lint:readme
npx vitest run --project node shared/test
```

Run the tests for the code you change; the last line is an example. With a
new dependency, also run `npm run lint:pins` and `npm run lint:notices`.

Some tests and their helpers stay in the maintainers' working copies, so
`npm test` and `npm run typecheck` fail in a fresh clone.
`npm run lint:comments`, `npm run lint:writing` and the pre-commit hook that
`npm run prepare` installs need a maintainer tool, so skip them. A maintainer
runs `npm run check` before merging.

## What a pull request needs

- What it changes and why, in plain words.
- Conventional Commit subjects, such as `fix(sketch): ...`. A `feat`, `fix`
  or `refactor` commit says why in its body.
- A test that fails without the change and passes with it, for a behaviour
  change.
- No code comments. The reason goes in the commit body.
- A change to what a user can do adds or updates its line under `## Features`
  in the [README](../../README.md).
- A saved project format change bumps `SCHEMA_VERSION` and adds a migration,
  as [DEVELOPMENT.md](../../DEVELOPMENT.md#geometry-layer) describes, and a
  `Schema N` line in [CHANGELOG.md](../../CHANGELOG.md).
- A new dependency at an exact version, listed in
  [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) if it ships.
- No secrets, environment files, real addresses, logs or user data.

## Licence

Rockett CAD's own licence is not set yet, and that includes the terms for
contributed code. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)
covers the third-party code it ships.
