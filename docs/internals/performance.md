# Performance baselines

Server benches live in `server/test/*.bench.ts` and run with vitest's built-in
benchmark mode. No extra dependency.

```sh
npm run bench -w server              # every server bench
npm run bench -w server -- evaluate  # evaluate.bench.ts only
npm run bench -w server -- payload   # payload.bench.ts only
npm run bench -w server -- importMesh # importMesh.bench.ts only
```

Each run prints one line per bench with its sample count, median and p95, and
writes the vitest JSON report, raw samples included, to
`server/dist/bench.json`. Vitest 5 has no `--outputJson` flag; the script uses
the JSON reporter with `--outputFile.json` instead. `dist/` is ignored by git
and not copied into the image.

## Method

- Samples: 2 warm-up runs, then exactly 10 measured runs (`warmupIterations`
  2, `iterations` 10, both time floors 0), unless a baseline row names
  another plan. Tinybench also makes one untimed probe call first, except in
  benches registered with `async: false`.
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

- `class-a`: x86-64 Linux desktop, AMD Ryzen 9 5900X, 12 cores and 24
  threads.

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

`server/test/helpers/perfFixtures.ts` builds two larger documents with fixed
ids, so every call returns the same document. `perfFixtures.test.ts` runs
under `npm test` and proves both evaluate with no error status.

- `many-feature` is `manyFeaturePart(n)`, default `n` 100: a base block of
  10 mm pitch cells, 100 x 100 x 10 mm for `n` 100, then per cell a 4 x 4 mm
  sketch on XY, a 5 mm pocket cut into the block, and a 0.5 mm fillet on the
  pocket's four vertical edges. 302 features, one body.
- `many-body` is `manyBodyPart()`: a 10 x 10 x 5 mm box with 1 mm fillets on
  its vertical edges, patterned 25 times along X, then all 25 bodies 40 times
  along Y, 15 mm apart and not combined. Five features, 1,000 bodies.

Benches over them:

- `evaluate cold many-feature`: a fresh engine per sample. The engine of the
  last sample stays warm for the next three benches.
- `evaluate noop many-feature`: the same document again, all cache hits.
- `evaluate edit-tail`: alternates the last fillet's radius between 0.5 and
  0.6 mm, so each sample re-evaluates one feature and re-tessellates the body.
- `evaluate edit-head`: alternates the base extrude's distance between 10 and
  11 mm, so each sample regenerates 301 features.
- `evaluate cold many-body`: a fresh engine per sample.
- `payload bytes many-body`: `JSON.stringify` of the cold many-body
  `EvaluateResult`. The bench prints the byte length; the median column holds
  bytes, the stringify time is printed with it.

The two many-feature full regenerations run 0 warm-up and 2 samples. Shapes
are never freed yet (PERF-005 and PERF-006), and one full many-feature
regeneration grows the kernel heap by about 700 MB, forced GC included. The
heap caps at 4 GB, so 12 regenerations in one process would abort. PERF-006
can restore the default plan. For the same reason `evaluate cold many-body`,
which grows the heap by about 100 MB per sample, lives in `payload.bench.ts`,
so it runs in its own worker.

`importMesh.bench.ts` imports UV spheres of radius 10 mm from
`server/test/helpers/meshFixtures.ts`, written as binary STL and stored base64
in one `importMesh` feature.

- `mesh-10k`: 100 slices by 51 rings, 10,000 triangles and 5,002 nodes.
- `mesh-100k`: 500 slices by 101 rings, 100,000 triangles and 50,002 nodes.
- `import mesh 10k` and `import mesh 100k`: a fresh engine evaluates the
  document per sample, which is the work an import request waits for: read,
  sew, solid, face names and tessellation. The 100k bench runs 0 warm-up and
  2 samples. One profile of a 10k import took 1.8 s to read and sew, 1.2 s to
  name faces and 4.4 s to tessellate 10,000 faces and 15,000 edges.

## Baselines

PERF-001 ranges span seven runs of `npm run bench -w server -- evaluate` on
2026-09-23. PERF-002 ranges span two runs of each file on its own, `-- evaluate`
then `-- payload`, on 2026-09-23 with a load average of 12 to 30 from other
agents. EXCH-019 ranges span two runs of `-- importMesh` on 2026-09-23 with a
load average of 8 to 18. Run the files one at a time when recording a baseline, because
`npm run bench -w server` runs every file at once.

PERF-025 made the viewport deflection scale with the body. Its rows span two
runs of `-- payload` on 2026-09-23 with a load average of 13 to 24, alternated
with two runs of the previous code, which gave cold many-body medians of 9.34
and 10.02 s and p95 of 18.0 and 19.5 s. The 10 x 10 x 5 mm bodies now mesh at
0.0075 mm instead of 0.08 mm, so the payload grew 7.1 percent, past its
25,000,000 byte budget.

| metric                     | fixture              | hardware class | runtime      | warm-up | repetitions | median                         | p95                            | budget                    | row      |
| -------------------------- | -------------------- | -------------- | ------------ | ------- | ----------- | ------------------------------ | ------------------------------ | ------------------------- | -------- |
| evaluate cold golden       | golden               | class-a        | Node 24.12.0 | 2       | 10          | 95 to 172 ms                   | 100 to 204 ms                  | median 250 ms, p95 400 ms | PERF-001 |
| evaluate warm golden       | golden               | class-a        | Node 24.12.0 | 2       | 10          | 0.007 to 0.017 ms              | 0.033 to 0.107 ms              | median 1 ms, p95 5 ms     | PERF-001 |
| evaluate cold many-feature | many-feature (n 100) | class-a        | Node 24.12.0 | 0       | 2           | 141.7 to 146.7 s               | 150.8 to 160.9 s               | median 200 s, p95 240 s   | PERF-002 |
| evaluate noop many-feature | many-feature (n 100) | class-a        | Node 24.12.0 | 2       | 10          | 0.343 to 0.444 ms              | 0.352 to 0.762 ms              | median 5 ms, p95 20 ms    | PERF-002 |
| evaluate edit-tail         | many-feature (n 100) | class-a        | Node 24.12.0 | 2       | 10          | 1.92 to 1.93 s                 | 2.22 to 3.80 s                 | median 3 s, p95 6 s       | PERF-002 |
| evaluate edit-head         | many-feature (n 100) | class-a        | Node 24.12.0 | 0       | 2           | 151.9 to 161.5 s               | 157.7 to 165.0 s               | median 200 s, p95 240 s   | PERF-002 |
| evaluate cold many-body    | many-body            | class-a        | Node 24.12.0 | 2       | 10          | 9.37 to 9.58 s                 | 14.8 to 22.5 s                 | median 15 s, p95 30 s     | PERF-002 |
| payload bytes many-body    | many-body            | class-a        | Node 24.12.0 | 2       | 10          | 23,674,467 to 23,674,468 bytes | 23,674,467 to 23,674,468 bytes | at most 25,000,000 bytes  | PERF-002 |
| import mesh 10k            | mesh-10k             | class-a        | Node 24.12.0 | 2       | 10          | 6.90 to 7.19 s                 | 13.6 to 14.7 s                 | median 10 s, p95 20 s     | EXCH-019 |
| import mesh 100k           | mesh-100k            | class-a        | Node 24.12.0 | 0       | 2           | 59.2 to 65.4 s                 | 61.0 to 73.0 s                 | median 90 s, p95 120 s    | EXCH-019 |
| evaluate cold many-body    | many-body            | class-a        | Node 24.12.0 | 2       | 10          | 9.19 to 9.77 s                 | 9.35 to 19.1 s                 | median 15 s, p95 30 s     | PERF-025 |
| payload bytes many-body    | many-body            | class-a        | Node 24.12.0 | 2       | 10          | 25,356,592 to 25,356,593 bytes | 25,356,592 to 25,356,593 bytes | at most 25,000,000 bytes  | PERF-025 |

The last test in `evaluate.bench.ts` fails when a row of this table misses a
column or leaves a cell empty. It runs with the benches, not with `npm test`.

The payload size moves by a byte with the digit count of `kernelMs`. Its
`JSON.stringify` took a median of 107 to 122 ms. Regeneration grows faster than
the feature count: one probe of `manyFeaturePart(25)` took 10 s cold, so 4
times the pockets costs about 14 times the time.

## Client benches

`client/test/viewport.bench.ts` runs with `npm run bench:client`, in the `dom`
project only, so happy-dom provides the document. `vitest.config.ts` gives the
`node` and `browser` projects no bench files. Method, sample plan and printed
lines match the server benches. No JSON report is written.

The viewport is a real `CadViewport` in a 1280 by 800 pixel container.
`client/test/helpers/fakeRenderer.ts` replaces `THREE.WebGLRenderer`: it
draws nothing, and its `render` only updates world matrices. The figures are
CPU time in Node for scene building, raycasts and bookkeeping. They say
nothing about frame time, GPU memory or draw cost. Real-browser WebGL evidence
at a stated viewport and workload is separate, and no texture-scale claim
rests on these benches.

`client/test/helpers/perfFixtures.ts` builds the inputs:

- `manyBodyPayloads()`: 1,000 synthetic `BodyPayload`s in a 25 by 40 grid,
  15 mm apart. Each is a 10 x 10 x 5 mm box, every side a 13 by 13 grid of
  quads: 2,028 triangles, 6 faces, 12 edges of 14 points, 8 vertices.
- `squareSketch()`: 250 squares of 6 mm at a 10 mm pitch on XY, 1,000 points
  and 1,000 lines, drawn as the active sketch with profiles on and no
  precomputed profiles, as `ViewportView.tsx` passes the draft.
- `imageScene(id)`: 50 reference images of 4096 by 4096 pixels on XY. The
  bench stubs `THREE.ImageLoader` to hand back an unloaded `img` of that size
  once the sync returns, so no pixels exist.

Benches:

- `sync bodies many-body`: `syncBodies` with new payload objects each sample,
  so all 1,000 bodies are disposed and rebuilt, as after a re-evaluation.
- `pick hover many-body`: a hover pick for faces, edges and vertices at the
  canvas centre after `zoomToFit`. The bench checks it hits.
- `highlight face many-body`: `clearHighlights` then a hover `addHighlight`,
  alternating between two faces of one body.
- `sketch hover 2000 entities`: from the top view, zoomed to half the fit, a
  sketch-entity pick alternating between two lines, the `renderSketches`
  rebuild with that hover, then `render`. The bench checks each pick hovers
  the intended line.
- `texture scene bytes`: `syncReferenceImages` for a new document id, so all
  50 textures are new, then the fake loads settle and the previous 50 are
  evicted. The printed byte count is the RGBA8 size of every texture the scene
  holds, with the full mip chain, as `TextureLoader` textures generate
  mipmaps. The median column holds bytes; the sync time is in the text.

### Client baselines

Ranges span five runs of `npm run bench:client` on 2026-09-23 with a one-minute
load average of 17 to 22 from other agents.

| metric                     | fixture               | hardware class | runtime                         | warm-up | repetitions | median              | p95                 | budget                      | row      |
| -------------------------- | --------------------- | -------------- | ------------------------------- | ------- | ----------- | ------------------- | ------------------- | --------------------------- | -------- |
| sync bodies many-body      | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 71.3 to 76.4 ms     | 80.4 to 88.1 ms     | median 1 s, p95 2 s         | PERF-004 |
| pick hover many-body       | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 0.614 to 0.729 ms   | 0.917 to 2.571 ms   | median 4 ms, p95 16 ms      | PERF-004 |
| highlight face many-body   | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 0.034 to 0.053 ms   | 0.049 to 0.081 ms   | median 2 ms, p95 8 ms       | PERF-004 |
| sketch hover 2000 entities | square sketch         | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 54.7 to 59.7 ms     | 62.3 to 71.9 ms     | median 16 ms, p95 50 ms     | PERF-004 |
| texture scene bytes        | 50 images 4096 x 4096 | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 4,473,924,200 bytes | 4,473,924,200 bytes | at most 4,473,924,200 bytes | PERF-004 |

`sketch hover 2000 entities` misses its budget. Every hover rebuilds all 2,250
sketch objects and reruns `detectProfiles`; PERF-032 owns that. The texture
budget is one mip chain per image, so any texture kept past eviction shows as
a larger figure. The texture sync took a median of 1.46 to 1.69 ms, p95 1.79
to 7.24 ms. The pick hover median is under DEC-202's 4 ms.

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
