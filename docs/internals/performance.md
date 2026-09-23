# Performance baselines

Server benches live in `server/test/*.bench.ts` and run with vitest's built-in
benchmark mode. No extra dependency.

```sh
npm run bench -w server              # every server bench
npm run bench -w server -- evaluate  # evaluate.bench.ts only
npm run bench -w server -- payload   # payload.bench.ts only
npm run bench -w server -- importMesh # importMesh.bench.ts only
npm run bench -w server -- stepImport # stepImport.bench.ts only
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
are never freed yet (see Memory soak, Destructors), and one full
many-feature regeneration grows the kernel heap by about 700 MB, forced GC included. The
heap caps at 4 GB, so 12 regenerations in one process would abort. PERF-006
could not change that, since the kernel binding frees almost nothing. For the same reason `evaluate cold many-body`,
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

`stepImport.bench.ts` imports `largeStepFixture(355)` from
`server/test/helpers/stepFixture.ts`: 355 boxes of 10 mm with a 1 mm fillet
on all 12 edges, 15 mm apart in a 19 by 19 grid, each transferred through
`STEPControl_Writer` as its own root. The STEP text is 24,975,842 bytes. The
first build added about 160 s to a run under load, so the text is cached in
the OS temp directory, keyed by the box count and a content version.

- `import large STEP`: what the import route does after its size checks.
  `readImport` reads the file once to validate it, then a fresh engine
  evaluates the one-feature document, reading it again and tessellating
  355 bodies. 0 warm-up and 2 samples.
- `evaluate noop large STEP`: the same document again on the engine of the
  last import sample.

The PERF-003 no-op figures below predate PERF-034. The tessellation cache
then held 64 bodies and evicted in insertion order, so with 355 bodies every
lookup missed and each no-op re-tessellated every body. PERF-034 bounds the
cache by bytes instead; see Edits on many-body.

## Baselines

PERF-001 ranges span seven runs of `npm run bench -w server -- evaluate` on
2026-09-23. PERF-002 ranges span two runs of each file on its own, `-- evaluate`
then `-- payload`, on 2026-09-23 with a load average of 12 to 30 from other
agents. EXCH-019 ranges span two runs of `-- importMesh` on 2026-09-23 with a
load average of 8 to 18. PERF-003 ranges span three runs of `-- stepImport` on
2026-09-23 with a load average of 13 to 40. Run the files one at a time when recording a baseline, because
`npm run bench -w server` runs every file at once.

PERF-025 made the viewport deflection scale with the body. Its rows span two
runs of `-- payload` on 2026-09-23 with a load average of 13 to 24, alternated
with two runs of the previous code, which gave cold many-body medians of 9.34
and 10.02 s and p95 of 18.0 and 19.5 s. The 10 x 10 x 5 mm bodies now mesh at
0.0075 mm instead of 0.08 mm, so the payload grew 7.1 percent, past its
25,000,000 byte budget.

| metric                     | fixture                       | hardware class | runtime      | warm-up | repetitions | median                         | p95                            | budget                    | row      |
| -------------------------- | ----------------------------- | -------------- | ------------ | ------- | ----------- | ------------------------------ | ------------------------------ | ------------------------- | -------- |
| evaluate cold golden       | golden                        | class-a        | Node 24.12.0 | 2       | 10          | 95 to 172 ms                   | 100 to 204 ms                  | median 250 ms, p95 400 ms | PERF-001 |
| evaluate warm golden       | golden                        | class-a        | Node 24.12.0 | 2       | 10          | 0.007 to 0.017 ms              | 0.033 to 0.107 ms              | median 1 ms, p95 5 ms     | PERF-001 |
| evaluate cold many-feature | many-feature (n 100)          | class-a        | Node 24.12.0 | 0       | 2           | 141.7 to 146.7 s               | 150.8 to 160.9 s               | median 200 s, p95 240 s   | PERF-002 |
| evaluate noop many-feature | many-feature (n 100)          | class-a        | Node 24.12.0 | 2       | 10          | 0.343 to 0.444 ms              | 0.352 to 0.762 ms              | median 5 ms, p95 20 ms    | PERF-002 |
| evaluate edit-tail         | many-feature (n 100)          | class-a        | Node 24.12.0 | 2       | 10          | 1.92 to 1.93 s                 | 2.22 to 3.80 s                 | median 3 s, p95 6 s       | PERF-002 |
| evaluate edit-head         | many-feature (n 100)          | class-a        | Node 24.12.0 | 0       | 2           | 151.9 to 161.5 s               | 157.7 to 165.0 s               | median 200 s, p95 240 s   | PERF-002 |
| evaluate cold many-body    | many-body                     | class-a        | Node 24.12.0 | 2       | 10          | 9.37 to 9.58 s                 | 14.8 to 22.5 s                 | median 15 s, p95 30 s     | PERF-002 |
| payload bytes many-body    | many-body                     | class-a        | Node 24.12.0 | 2       | 10          | 23,674,467 to 23,674,468 bytes | 23,674,467 to 23,674,468 bytes | at most 25,000,000 bytes  | PERF-002 |
| import mesh 10k            | mesh-10k                      | class-a        | Node 24.12.0 | 2       | 10          | 6.90 to 7.19 s                 | 13.6 to 14.7 s                 | median 10 s, p95 20 s     | EXCH-019 |
| import mesh 100k           | mesh-100k                     | class-a        | Node 24.12.0 | 0       | 2           | 59.2 to 65.4 s                 | 61.0 to 73.0 s                 | median 90 s, p95 120 s    | EXCH-019 |
| evaluate cold many-body    | many-body                     | class-a        | Node 24.12.0 | 2       | 10          | 9.19 to 9.77 s                 | 9.35 to 19.1 s                 | median 15 s, p95 30 s     | PERF-025 |
| payload bytes many-body    | many-body                     | class-a        | Node 24.12.0 | 2       | 10          | 25,356,592 to 25,356,593 bytes | 25,356,592 to 25,356,593 bytes | at most 25,000,000 bytes  | PERF-025 |
| import large STEP          | large STEP (24,975,842 bytes) | class-a        | Node 24.12.0 | 0       | 2           | 65.3 to 71.8 s                 | 68.8 to 73.8 s                 | median 120 s, p95 180 s   | PERF-003 |
| evaluate noop large STEP   | large STEP (24,975,842 bytes) | class-a        | Node 24.12.0 | 2       | 10          | 4.03 to 7.64 s                 | 5.04 to 26.2 s                 | median 5 ms, p95 20 ms    | PERF-003 |

`evaluate noop large STEP` misses its budget by three orders of magnitude,
for the tessellation cache reason above. The three runs gave p95 of 5.04,
17.6 and 26.2 s.

The last test in `evaluate.bench.ts` fails when a row of this table misses a
column or leaves a cell empty. It runs with the benches, not with `npm test`.

The payload size moves by a byte with the digit count of `kernelMs`. Its
`JSON.stringify` took a median of 107 to 122 ms. Regeneration grows faster than
the feature count: one probe of `manyFeaturePart(25)` took 10 s cold, so 4
times the pockets costs about 14 times the time.

## Edits on many-body

PERF-034 measured what an edit costs on the `many-body` fixture, on
`class-a`, Node 24.12.0, load average 12 to 34. Route figures are one HTTP
call each over loopback through `createApp`, from request to last byte: three
calls per route, one for the last two rows.

Before, a no-op evaluation took 5.26 s. Feature evaluation was all cache hits
and cost nothing, `shapeHash` took 0.3 ms for 1,000 bodies, and
re-tessellating 1,000 bodies took 4.87 s: the 64-entry cache missed every
body. `JSON.stringify` of the 25.4 MB result took 127 to 141 ms, and
`JSON.parse` 59 to 74 ms in Node. On the client, `syncBodies` rebuilt all
1,000 bodies after every evaluation, because a parsed payload is never the
same object.

| call                    | before      | after                         |
| ----------------------- | ----------- | ----------------------------- |
| engine no-op evaluate   | 5.26 s      | 1 to 2 ms                     |
| `GET evaluate`          | 5.1 to 25 s | 179 to 276 ms                 |
| `GET evaluate`, gzip    | 5.5 to 14 s | 230 to 336 ms, 3.4 MB on wire |
| `PUT groups`            | 5.4 to 13 s | 170 to 260 ms                 |
| body rename             | 9.9 to 15 s | 176 to 241 ms                 |
| body visibility         | 6.9 to 12 s | 207 to 248 ms                 |
| add a sketch at the end | 5.2 s       | 179 to 188 ms                 |
| pattern count 40 to 41  | 9.8 s       | 9.7 to 10.1 s                 |

The before figures grow between calls because every tessellation leaks
kernel memory (see Destructors). After PERF-034:

- The tessellation cache is least recently used and bounded at 256 MB per
  engine, counting 8 bytes per number in the mesh arrays and edge polylines.
  The fixture's 1,000 bodies count 17.4 MB. The key is the body id and shape
  hash; name and visibility are applied per response, so a rename re-meshes
  nothing.
- A JSON response of 64 KiB or more is gzipped at level 1 when the request
  accepts gzip: 25.4 MB becomes 3.4 MB for 88 ms of compression. Level 6
  gives 1.75 MB for 207 ms.
- Each body carries `meshKey`, a SHA-256 of its mesh JSON without name or
  visibility, and `syncBodies` keeps a body's objects while the key holds.
  Hashing adds about 0.2 s to the 10 s cold evaluation. PERF-021's
  `mesh.hash` replaces it.

A change upstream of the pattern still makes every body a new shape, so it
re-evaluates the pattern and re-meshes all bodies: the pattern count edit
above. Responses still carry every mesh until PERF-024.

## Audit of 2026-09-23

Mark asked for the recent fixes to reach every place with the same shape:
render on demand, a dwell before previews, a byte-bounded cache keyed by
content, gzip, a content key per client object, and one input per frame.
Figures come from throwaway probes on `class-a`, Node 24.12.0, happy-dom
20.14.5 for client code, load average 7 to 28: the server fixtures, the
client bench fixtures, and `ViewportView` mounted on the fake renderer.
Rows are ordered by measured benefit.

| place                                                                         | cost measured                                                                                                       | verdict                                                                                                                     | row                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| linear pattern copies meshed from scratch                                     | count edit 40 to 41: 9.4 to 10.7 s, 8.5 to 9.5 s of it meshing 975 to 1,000 copies; moving a cached payload 0.01 ms | new row                                                                                                                     | PERF-035           |
| `pointermove` render nudge and gizmo repaint                                  | 60 moves over empty space render 60 frames for 1 hover change; a many-body frame costs a median 5 ms (PERF-027)     | new row                                                                                                                     | PERF-036           |
| model tree re-renders every row                                               | 1,000 bodies: 15 to 21 ms per evaluation, 15 to 19 ms per selection, two renders per edit                           | new row                                                                                                                     | PERF-037           |
| preview tints compare mesh arrays                                             | 1,000 unchanged bodies: 23 ms per preview evaluation, 0.08 ms by `meshKey`                                          | done: `preview tints many-body` median 20.4 to 20.7 ms, now 0.10 to 0.11 ms                                                 | PERF-038           |
| sketches rebuilt on every evaluation                                          | 11.3 ms for one 2,000-entity sketch, 10.2 ms for 50 sketches of 32 entities                                         | new row                                                                                                                     | PERF-039           |
| static client assets raw and revalidated                                      | JS 1,114,913 bytes, 307,258 gzipped; CSS 14,563, 3,507 gzipped; `max-age=0` on both                                 | done: JS 1,118,034 to 309,454 bytes on the wire, CSS 14,669 to 3,482, both `immutable`; `index.html` `no-cache`             | PERF-040           |
| every response re-serialises every mesh, including renames and timeline peeks | many-body: 120 to 140 ms `JSON.stringify` and 88 ms gzip per response                                               | covered                                                                                                                     | PERF-021, PERF-024 |
| hover picks per pointer event                                                 | 0.6 to 1.1 ms a pick                                                                                                | covered                                                                                                                     | PERF-029           |
| sketches rebuilt on hover                                                     | 55 to 63 ms a hover change                                                                                          | covered                                                                                                                     | PERF-032           |
| highlights copy whole body meshes                                             | PERF-004 baseline                                                                                                   | covered                                                                                                                     | PERF-023           |
| `engines` map has no bound                                                    | one many-body engine: 47 MB JS heap, 20 MB WASM heap                                                                | covered, figure added                                                                                                       | PERF-007           |
| snapshot shapes never freed                                                   | PERF-005 curve                                                                                                      | covered                                                                                                                     | PERF-006           |
| `featureKey` stringifies imported bytes twice per evaluation                  | 11 ms per stringify of a 6.7 MB mesh import                                                                         | covered for STEP                                                                                                            | PERF-008, DOC-014  |
| client undo keeps 50 full deep copies                                         | 13 to 21 ms and 6.7 MB per entry for the mesh import                                                                | covered, figure added                                                                                                       | UNDO-005           |
| unaborted timeline peeks                                                      | one evaluation per abandoned dwell                                                                                  | covered: the server cannot stop an evaluation before jobs                                                                   | PERF-015           |
| construction planes rebuilt per evaluation                                    | 1.2 ms for 20 planes                                                                                                | not worth: about a millisecond                                                                                              | -                  |
| reference image planes rebuilt per evaluation                                 | 1.2 ms for 50 images                                                                                                | not worth: textures are already cached by URL                                                                               | -                  |
| revolve and extrude ghosts rebuilt per drag event                             | 0.4 ms at 64 profile points, 5.5 and 2.6 ms at 1,000                                                                | not worth: inside a frame for real profiles                                                                                 | -                  |
| timeline chips re-render per evaluation                                       | 5.6 ms at 302 features                                                                                              | not worth: one chip per feature                                                                                             | -                  |
| peek back from before a pattern                                               | one 1,000-body rebuild, 70 ms plus upload                                                                           | not worth: keeping both generations doubles GPU memory for a hover                                                          | -                  |
| pointer events not coalesced per frame                                        | not measured                                                                                                        | not worth: Chromium already sends one `pointermove` a frame; the per-event work is what PERF-029, PERF-036 and PERF-039 cut | -                  |
| inputs sending a request per keystroke                                        | none found                                                                                                          | not worth: no search boxes exist, renames commit on Enter or blur, dialogs and quick edit dwell 300 ms                      | -                  |
| ETag hashing of JSON responses                                                | 3.5 ms for 3.4 MB gzipped, 124 ms for 25.4 MB plain                                                                 | not worth: browsers take gzip, and the ETag gives 304s                                                                      | -                  |
| STL export not compressed                                                     | 100 bodies: 940,084 bytes, 183,138 gzipped                                                                          | not worth: one download per export, after an export re-mesh                                                                 | -                  |
| project file read and validated per request                                   | 6.7 MB mesh import: load 32 to 45 ms, save 55 to 72 ms                                                              | not worth: only inline import bytes make it large, and a parsed cache needs DOC-009 revisions                               | -                  |
| measure, project edge and tangent edges run a full `evaluate`                 | 1 to 2 ms on many-body                                                                                              | not worth: all cache hits                                                                                                   | -                  |
| tessellations at earlier positions (peek, project edge)                       | bounded                                                                                                             | not worth: PERF-034 bounds them at 256 MB per engine                                                                        | -                  |

Frame-aligned `pointermove` was not checked in Firefox or Safari. If either
sends several moves a frame, PERF-029's one hover pick per frame covers it.

## Client benches

`client/test/viewport.bench.ts` and `client/test/tree.bench.ts` run with
`npm run bench:client`, in the `dom` project only, so happy-dom provides the
document. `vitest.config.ts` gives the `node` and `browser` projects no bench
files. Method, sample plan and printed lines match the server benches. No JSON
report is written.

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

- `sync bodies many-body`: `syncBodies` with new payload objects and new
  mesh keys each sample, so all 1,000 bodies are disposed and rebuilt.
- `sync bodies unchanged many-body`: `syncBodies` with new payload objects
  and the same mesh keys, as after an edit that changes no mesh.
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
- `preview tints many-body`: `previewTints` for the many-body payloads
  against a JSON round trip of the same bodies, as after a live preview
  that changes no mesh.
- `tree rerender many-body`: `ModelTree` with the many-body payloads, then a
  new evaluation of copies of the same bodies each sample.
- `tree select many-body`: the same tree, selecting one of two bodies in
  turn.

### Client baselines

Ranges span five runs of `npm run bench:client` on 2026-09-23 with a one-minute
load average of 17 to 22 from other agents. The PERF-034 row spans three runs
on 2026-09-23 at a load average of 38 to 42. The PERF-037 rows span three runs
on 2026-09-23 at a load average of 22 to 24, interleaved with three runs of the
tree before PERF-037: 18.6 to 20.1 ms a new evaluation and 14.3 to 14.9 ms a
selection. The PERF-038 row spans three runs on 2026-09-23 at a load average
of 18 to 20, after three runs comparing mesh arrays: a median of 20.4 to
20.7 ms, p95 21.6 to 22.7 ms.

| metric                          | fixture               | hardware class | runtime                         | warm-up | repetitions | median              | p95                 | budget                      | row      |
| ------------------------------- | --------------------- | -------------- | ------------------------------- | ------- | ----------- | ------------------- | ------------------- | --------------------------- | -------- |
| sync bodies many-body           | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 71.3 to 76.4 ms     | 80.4 to 88.1 ms     | median 1 s, p95 2 s         | PERF-004 |
| sync bodies unchanged many-body | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 0.154 to 0.294 ms   | 0.366 to 0.585 ms   | median 16 ms, p95 50 ms     | PERF-034 |
| pick hover many-body            | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 0.614 to 0.729 ms   | 0.917 to 2.571 ms   | median 4 ms, p95 16 ms      | PERF-004 |
| highlight face many-body        | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 0.034 to 0.053 ms   | 0.049 to 0.081 ms   | median 2 ms, p95 8 ms       | PERF-004 |
| sketch hover 2000 entities      | square sketch         | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 54.7 to 59.7 ms     | 62.3 to 71.9 ms     | median 16 ms, p95 50 ms     | PERF-004 |
| texture scene bytes             | 50 images 4096 x 4096 | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 4,473,924,200 bytes | 4,473,924,200 bytes | at most 4,473,924,200 bytes | PERF-004 |
| preview tints many-body         | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 0.102 to 0.111 ms   | 0.117 to 0.133 ms   | median 1 ms, p95 1 ms       | PERF-038 |
| tree rerender many-body         | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 8.0 to 10.3 ms      | 19.1 to 23.0 ms     | median 16 ms, p95 50 ms     | PERF-037 |
| tree select many-body           | many-body payloads    | class-a        | Node 24.12.0, happy-dom 20.14.5 | 2       | 10          | 3.4 to 4.5 ms       | 4.5 to 22.9 ms      | median 16 ms, p95 50 ms     | PERF-037 |

`sketch hover 2000 entities` misses its budget. Every hover rebuilds all 2,250
sketch objects and reruns `detectProfiles`; PERF-032 owns that. The texture
budget is one mip chain per image, so any texture kept past eviction shows as
a larger figure. The texture sync took a median of 1.46 to 1.69 ms, p95 1.79
to 7.24 ms. The pick hover median is under DEC-202's 4 ms.

## Memory soak

`server/test/memorySoak.test.ts` sits in its own `soak` vitest project, so
`npm test` and `npm run check` skip it. The default 300 cycles take about 6
minutes.

```sh
npm test -w server -- memorySoak
ROCKETT_SOAK_CYCLES=1000 npm test -w server -- memorySoak
```

It evaluates `manyFeaturePart(25)` cold, then runs three phases of the same
cycle count on one engine:

- `edit-tail`: alternates the last fillet's radius between 0.6 and 0.5 mm,
  as the bench does, so each cycle regenerates one feature and tessellates
  the new body.
- `rewind`: evaluates 3 features before the end, then at the end, as the
  timeline's temporary rewind does.
- `tessellate`: calls `tessellateBody` on the unchanged tip body. The body
  already carries its triangulation, so this is tessellation with no new
  mesh.

At cycle 0, every 100 cycles, the last cycle and after `dropEngine`, it
forces GC twice (`--expose-gc` is set at runtime) and prints one `memory soak`
JSON line: RSS, V8 heap used, WASM heap size, handle counts and the one-minute
load average. The WASM heap never shrinks, so its size is the high-water mark,
and use under the initial 100 MB does not show. The test asserts that the
samples exist and are finite, and that live handles grow by under 500 a cycle
from cycle 100 to the last in each phase (PERF-006).

Handle counts come from wrapping every Embind class constructor, static
function and method at start-up. A returned class handle is live until its
`.delete()`. A live handle whose JS wrapper has been collected is orphaned:
nothing can free its C++ object any more. `finalizedHandles` counts handles
Embind's own finalizer freed. `.get()` on an OCCT handle returns a non-owning
pointer that counts too, so the count is an upper bound.

The soak uses 25 pockets because 100 cannot finish 300 cycles: edit-tail at
`manyFeaturePart(100)` grows the heap 17.3 MB a cycle and would pass the 4 GB
cap near cycle 190.

### Curve

One run on 2026-09-23, `class-a`, Node 24.12.0, `manyFeaturePart(25)` (77
features, one body), 300 cycles a phase, 6 min 14 s. Load average 31.4 at the
start and 20.7 to 44.4 at the samples. Reachable is live minus orphaned.

| phase      | cycle | RSS MB | JS heap MB | WASM heap MB | live handles | reachable | tessellation entries |
| ---------- | ----- | ------ | ---------- | ------------ | ------------ | --------- | -------------------- |
| kernel     | 0     | 737    | 247        | 100          | 0            | 0         | 0                    |
| cold       | 77    | 835    | 259        | 100          | 96,267       | 51        | 1                    |
| edit-tail  | 100   | 1,666  | 335        | 613          | 2,475,067    | 51        | 64                   |
| edit-tail  | 200   | 2,129  | 347        | 998          | 4,853,867    | 51        | 64                   |
| edit-tail  | 300   | 2,577  | 339        | 1,479        | 7,232,667    | 51        | 64                   |
| rewind     | 100   | 2,571  | 331        | 1,479        | 7,250,933    | 51        | 64                   |
| rewind     | 200   | 2,572  | 331        | 1,479        | 7,250,933    | 51        | 64                   |
| rewind     | 300   | 2,572  | 331        | 1,479        | 7,250,933    | 51        | 64                   |
| tessellate | 100   | 3,026  | 379        | 1,576        | 9,152,633    | 51        | 64                   |
| tessellate | 200   | 3,164  | 387        | 1,768        | 11,054,333   | 51        | 64                   |
| tessellate | 300   | 3,302  | 395        | 1,865        | 12,956,033   | 51        | 64                   |
| dropEngine | 0     | 3,302  | 330        | 1,865        | 12,956,033   | 0         | 0                    |

`finalizedHandles` stayed 0 throughout. Growth per cycle:

| phase      | handles                | WASM heap                      | top classes per cycle                                                                                   |
| ---------- | ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| edit-tail  | 23,788 in both windows | 4.33 MB over cycles 100 to 300 | `TopoDS_Shape` 7,193, `gp_Pnt` 4,855, `gp_Dir` 4,855, `TopTools_ListOfShape` 3,481, `TopoDS_Edge` 1,212 |
| rewind     | 18,266 once, then 0    | 0                              | the first rewind tessellates the body at feature 74 once                                                |
| tessellate | 19,017 in every window | 1.29 MB over cycles 0 to 300   | `TopoDS_Shape` 4,923, `gp_Pnt` 4,855, `gp_Dir` 4,855, `TopTools_ListOfShape` 2,040, `TopoDS_Edge` 612   |

The WASM heap grows in steps, so single windows read 3.85 and 4.81 MB for
edit-tail and 0.97 to 1.92 MB for tessellate. The JS heap rose 76 MB while the
tessellation cache filled to 64 entries, then stayed flat.

One probe with the same code at `manyFeaturePart(100)` (302 features), load
average 25.7 to 34.9: the cold build took 193 s, took the WASM heap from 100
to 805 MB and left 1,227,792 live handles, 201 of them reachable. After 100
edit-tail cycles the heap was 2,537 MB, RSS 4,714 MB and live handles
10,656,592: 94,288 handles and 17.3 MB a cycle. The 64 cached payloads held
277 MB of JS heap, 4.4 MB each. The run then failed with `Unknown Error: 24`,
a thrown kernel exception, after 1,122 s and before cycle 200.

### Findings

- The kernel frees nothing. No handle was finalized out of 13 million.
  Embind's `attachFinalizer` registers a handle only when `$$.smartPtr` is
  set, and opencascade.js binds OCCT handles as value classes (`Handle_*`), so
  no class handle has one. Forced GC collects JS wrappers only.
- The engine cache is not what holds the handles. At the end 51 of 12,956,033
  live handles were reachable; the rest were orphaned. The snapshots hold the
  body and sketch shapes, and `engine.ts:67` (`this.snapshots.length =
valid`), `invalidate()` and `dropEngine` drop them without `.delete()`. That
  is one body a cycle in edit-tail: few handles, but the whole B-rep and its
  triangulation. `dropEngine` deleted no handle; its 51 reachable handles
  turned orphaned.
- Transient handles leak on every path. Tessellation alone leaves 19,017 of
  the 23,788 a cycle. `explore()` in `kernel.ts` never deletes `ex.Current()`,
  and `faces()`, `edges()`, `vertices()` and `solids()` add a second copy per
  subshape that callers rarely delete. `surfaceInfo` and `curveInfo` in
  `tessellate.ts` leave the `gp_Pln` or `gp_Cylinder`, `gp_Ax1`, `gp_Pnt` and
  `gp_Dir` of each face and circular edge, hence equal `gp_Pnt` and `gp_Dir`
  counts. `listToArray` leaves each `First_1()` copy, and `computeEdgeNames`
  and `computeVertexNames` leave every `FindKey` and `FindFromIndex` copy.
- Each undeleted `TopoDS_Shape` holds a reference on its TShape, so these
  handles keep old faces and edges alive after their body goes. Deleting the
  engine's body shapes alone will not return the geometry.
- Bytes per edit-tail cycle at 25 pockets: tessellating an unchanged body
  costs 1.29 MB of the 4.33 MB. The other 3.0 MB is the fillet result, its
  new faces and their triangulation, plus naming. This split is inferred from
  two phases; the module exports no `mallinfo`.
- The 64-entry tessellation cache is bounded JS memory and holds no handles:
  76 MB at 25 pockets, 277 MB at 100. `dropEngine` returned 65 MB of it.
- A rewind costs one tessellation of an uncached body, then nothing.
- RSS outgrows the WASM and JS heaps: 3,302 MB at the end against 1,865 plus
  330 MB. The remainder is not attributed.

### Destructors

PERF-006 deleted every shape its snapshots drop and every short-lived handle
on the soak paths, and the heap kept growing. The kernel binding cannot free
most objects. Run on 2026-09-23, `class-a`, Node 24.12.0, same fixture and
cycles, load average 10.7 to 37.3:

| phase      | before: handles a cycle | after: handles a cycle | before: WASM heap, cycle 100 to 300 | after: WASM heap, cycle 100 to 300 |
| ---------- | ----------------------- | ---------------------- | ----------------------------------- | ---------------------------------- |
| cold       | 96,267 in all           | 1,474 in all           | 100 MB                              | 100 MB                             |
| edit-tail  | 23,788                  | 232                    | 613 to 1,479 MB                     | 516 to 1,383 MB                    |
| rewind     | 0                       | 0                      | 1,479 MB, flat                      | 1,383 MB, flat                     |
| tessellate | 19,017                  | 231                    | 1,576 to 1,865 MB                   | 1,479 to 1,672 MB                  |

The handles left each cycle are 231 `Poly_Triangulation` pointers from
`.get()`, which own nothing, plus one `Message_ProgressRange` in edit-tail. Heap growth barely
moved: 4.3 MB an edit-tail cycle and about 1 MB a tessellation.

The cause is in `opencascade.js` 2.0.0-beta.b5ff984. A class bound under its
own name, such as `TopoDS_Shape`, `gp_Pnt`, `BRepFilletAPI_MakeFillet` or
`BRepCheck_Analyzer`, shares one Embind destructor that frees nothing: a
24-byte block passed to it is not returned to `malloc`. A constructor
overload class such as `gp_Pnt_3` has a working destructor. So `.delete()`
frees what `new X_n(...)` made, and nothing that a kernel call returned or
that a single-constructor class made. Measured bytes per call:

| call                                                         | bytes kept |
| ------------------------------------------------------------ | ---------- |
| `new gp_Pnt_3()` then `.delete()`                            | 0.5        |
| `p.Transformed(t)` then `.delete()`, or without `.delete()`  | 32         |
| `new TopoDS_Shape()` then `.delete()`                        | 16.6       |
| `new BRepFilletAPI_MakeFillet(box)` then `.delete()`         | 13,429     |
| one-edge fillet of a box, builder deleted                    | 39,711     |
| `BRepCheck_Analyzer` of a box, deleted                       | 59,761     |
| meshed sphere, shape deleted                                 | 329,441    |
| meshed sphere, `Nullify()` then deleted                      | 1,352      |
| edit-tail at 25 pockets, with or without `Nullify` on delete | 4,413,440  |
| `tessellateBody` of an unchanged 25-pocket body              | 1,114,522  |

`Nullify()` frees the geometry behind a returned shape, but the fillet builder
and the validity analyzer are never destroyed, and each holds its result
body, so edit-tail keeps every fillet and its triangulation. Tessellation
keeps 32 bytes for each `gp_Pnt` and `gp_Dir` a node returns. No JavaScript
change bounds the heap. Mark chose on 2026-09-23 to recycle the worker, so
PERF-018 owns the heap bound, and the soak asserts live handles instead: under
500 a cycle from cycle 100 to the last, in every phase.

The tessellation cache key stays the body id and shape hash, and since REF-004
each entry keeps the body shape it meshed: a hit needs that shape undeleted
and `IsSame` as the body's. A hash collision, or a kernel build whose freed
shapes reuse addresses, re-meshes instead of serving a stale body. On
PERF-034's cache every edit-tail cycle adds an entry: 301 entries and 288 MB
more JS heap after 300 cycles, bounded by its 256 MB payload cap.

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
