# Performance baselines

Server benches live in `server/test/*.bench.ts` and run with vitest's built-in
benchmark mode. No extra dependency.

```sh
npm run bench -w server              # every server bench
npm run bench -w server -- evaluate  # evaluate.bench.ts only
```

Each run prints one line per bench with its sample count, median and p95, and
writes the vitest JSON report, raw samples included, to
`server/dist/bench.json`. Vitest 5 has no `--outputJson` flag; the script uses
the JSON reporter with `--outputFile.json` instead. `dist/` is ignored by git
and not copied into the image.

## Method

- Samples: 2 warm-up runs, then exactly 10 measured runs (`warmupIterations`
  2, `iterations` 10, both time floors 0). Tinybench also makes one untimed
  probe call first.
- Median is tinybench's p50. p95 is the nearest-rank p95 of the 10 retained
  samples, so with 10 samples it equals the slowest one.
- The kernel loads once before the benches. Its start-up is not measured.
- A budget is declared before the figure it judges. The bench does not
  enforce budgets; a reader compares the figures against them.
- Figures compare only within one hardware class and runtime. The runtime
  column names the Node that ran the bench, on the host or in the image.

## Hardware classes

Class labels are anonymous. The mapping from a label to a machine stays outside
this repository.

- `class-a`: x86-64 Linux desktop.

Caveat on the `class-a` figures below: other agents ran builds and tests on the
same machine during every run, with a load average of 20 to 25. The slowest cold
median was 1.8 times the fastest. Treat these figures as a noisy upper bound, and repeat
on a quiet machine before tightening a budget.

## Fixtures

`golden` is built in `evaluate.bench.ts` from the `featureGolden.test.ts`
building blocks: the 20 x 30 x 10 mm base box (sketch `boxSk` and extrude
`box`), a 1 mm shell open at the top face, and a mirror across YZ combined into
the box. Four features, one body. The bench checks that every feature
evaluates `ok` before timing.

- `evaluate cold golden`: a fresh engine per sample, so every feature and the
  tessellation run from scratch.
- `evaluate warm golden`: a no-op re-evaluation of the same document on an
  engine that has already evaluated it, so every snapshot and tessellation is
  a cache hit.

## Baselines

Ranges span seven runs of `npm run bench -w server -- evaluate` on 2026-09-23.

| metric               | fixture | hardware class | runtime      | warm-up | repetitions | median            | p95               | budget                    | row      |
| -------------------- | ------- | -------------- | ------------ | ------- | ----------- | ----------------- | ----------------- | ------------------------- | -------- |
| evaluate cold golden | golden  | class-a        | Node 24.12.0 | 2       | 10          | 95 to 172 ms      | 100 to 204 ms     | median 250 ms, p95 400 ms | PERF-001 |
| evaluate warm golden | golden  | class-a        | Node 24.12.0 | 2       | 10          | 0.007 to 0.017 ms | 0.033 to 0.107 ms | median 1 ms, p95 5 ms     | PERF-001 |

The last test in `evaluate.bench.ts` fails when a row of this table misses a
column or leaves a cell empty. It runs with the benches, not with `npm test`.
