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

## Cost table

`npm run cost` prints what each large file and plugin costs, so tidy-up
candidates show without reading the code. It lists every tracked source file
over 500 lines, every package under `modules/`, and any file holding a function
over 80 lines or a benched function. Tests and benches are not source. Under
each entry it lists every function over 40 lines, and every benched one, with
its line count and bench median, else `no bench`.

- Limits: a file over 500 lines or a function over 80 lines is marked `tidy`.
  Function rows show from 40 lines.
- Sizes come from oxlint's `max-lines` and `max-lines-per-function`, counting
  every line. A function oxlint does not name takes the name before it on its
  first line: the variable it is assigned to, or its call such as
  `useEffect()` or `kernelCall("extrude")`.
- Medians are the p50 of each `*/dist/bench.json` and
  `modules/*/dist/bench.json` that exists. A bench task names its function as
  its first word, such as `solveSketch rectangle`, and matches functions in the
  workspace that wrote the file. The table never runs benches; run
  `npm run bench -ws --if-present` first.
- `scripts/cost-baseline.txt` holds every `tidy` file and function with its
  line count; a repeated name in one file takes `#2`, `#3` in file order.
  `npm run lint:cost`, part of `npm run check`, fails when one grows, a new
  one crosses a limit, or one shrinks without the baseline.
  `npm run cost -- --update` rewrites the baseline; a commit that grows an
  entry says why.
