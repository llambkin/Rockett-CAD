# Kernel worker lifecycle

PERF-009 asked whether the OCCT kernel can run in a `worker_threads` worker on
the shipped Node 24 line without the out-of-memory abort an earlier session saw
at exit. It can. Keep Node 24 on the Dockerfile's pinned `node:24-trixie-slim`
digest.

## Probe

`server/test/helpers/lifecycleWorker.ts` runs as the main thread and as the
worker. The main thread starts N workers. Each loads the OCCT kernel and
evaluates the first 14 features of `server/test/fixtures/invalid-top-fillet.json`
(sketches, extrudes, chamfers, a fillet). The main thread terminates the
workers, starts N fresh ones, evaluates again and calls `process.exit(0)` with
those workers still alive. It prints one JSON line with boot time, evaluation
time and process RSS.

`server/test/kernelLifecycle.test.ts` runs it with one worker in a child
process and asserts exit code 0, no signal, and both evaluations `ok`.

Host:

```sh
npm test -w server -- kernelLifecycle
```

Container, on the Dockerfile's runtime image, with the checkout mounted
read-only:

```sh
podman run --rm --security-opt label=disable -v "$PWD:/app:ro" -w /app \
  "$(sed -n 's/^FROM \(node:[^ ]*\) AS runtime/\1/p' Dockerfile)" \
  npm test -w server -- kernelLifecycle
```

Three workers: `node --import tsx server/test/helpers/lifecycleWorker.ts 3`.

## Results, 2026-09-23

Hardware: 24-thread x86-64 desktop, shared with other workloads during the runs.
No warm-up. Boot is `initKernel()` inside the worker. RSS covers the whole
process, including the main thread and the tsx loader.

| Runtime             | Workers | Runs | Exit        | Boot per worker | Evaluate      | Peak RSS      | RSS after terminate |
| ------------------- | ------- | ---- | ----------- | --------------- | ------------- | ------------- | ------------------- |
| Host Node v24.12.0  | 1       | 4    | 0 every run | 4.6 to 7.2 s    | 0.75 to 1.8 s | 759 to 817 MB | 581 to 583 MB       |
| Host Node v24.12.0  | 3       | 2    | 0 every run | 5.3 to 8.7 s    | 0.9 to 1.9 s  | up to 2017 MB | 1531 to 1550 MB     |
| Image Node v24.21.0 | 1       | 2    | 0 every run | 4.5 to 7.1 s    | 0.8 to 1.6 s  | 772 to 800 MB | 579 to 598 MB       |
| Image Node v24.21.0 | 3       | 3    | 0 every run | 4.1 to 8.1 s    | 0.7 to 1.0 s  | up to 2052 MB | 1572 to 1589 MB     |

The baseline process RSS before any worker was 70 to 86 MB. Two early host
test runs passed, so exited 0, but their numbers were not captured.
A separate probe started three workers and called `process.exit(0)` 1.5 s and
4 s later, while they were still booting. It exited 0 on both runtimes.

Findings:

- No abort at exit in 15 runs across both Node 24 builds, including three
  workers and exit during boot. The earlier abort was on Node 24.12 with three
  workers; the same host version ran clean here. The earlier session's exact
  sequence was not recorded, so these runs cover the sequences PERF-011 will
  produce, not every possible one.
- One worker adds about 700 MB, above the 340 MB of the earlier Node 20 and
  24.12 probes. The earlier
  method is not recorded; these figures include one evaluated fixture and the
  main thread.
- Terminating a worker does not return its memory to the OS. A respawned
  worker reuses it: RSS after the second round stayed within 90 MB of the first
  round's peak. Budget one worker's peak, not one per restart.
- Boot took 4.1 to 8.7 s, slower than the earlier 3.6 to 4.8 s. The desktop was
  loaded by other work during every run, so treat 9 s as the planning figure.
  The image's 60 s healthcheck start period covers it.
