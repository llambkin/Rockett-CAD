import { readFileSync } from "node:fs";
import { once } from "node:events";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import type { CadDocument } from "@rockett/shared";

const mb = (bytes: number) => Math.round(bytes / 2 ** 20);

async function spawnAndEvaluate() {
  const started = performance.now();
  const worker = new Worker(new URL(import.meta.url));
  const [{ kernelInitMs }] = await once(worker, "message");
  const readyMs = Math.round(performance.now() - started);
  worker.postMessage("evaluate");
  const [{ statuses, evaluateMs }] = await once(worker, "message");
  return {
    worker,
    run: {
      readyMs,
      kernelInitMs,
      evaluateMs,
      statuses,
      rssMb: mb(process.memoryUsage().rss),
    },
  };
}

async function drive(count: number) {
  const baselineRssMb = mb(process.memoryUsage().rss);
  const first = await Promise.all(
    Array.from({ length: count }, spawnAndEvaluate),
  );
  await Promise.all(first.map(({ worker }) => worker.terminate()));
  const afterTerminateRssMb = mb(process.memoryUsage().rss);
  const second = await Promise.all(
    Array.from({ length: count }, spawnAndEvaluate),
  );
  process.stdout.write(
    JSON.stringify({
      node: process.version,
      workers: count,
      baselineRssMb,
      afterTerminateRssMb,
      rounds: [first, second].map((round) => round.map(({ run }) => run)),
    }) + "\n",
    () => process.exit(0),
  );
}

async function serve() {
  const { initKernel } = await import("../../src/geometry/kernel.js");
  const { engineFor } = await import("../../src/geometry/engine.js");
  const started = performance.now();
  await initKernel();
  const kernelInitMs = Math.round(performance.now() - started);
  const { document: doc }: { document: CadDocument } = JSON.parse(
    readFileSync(
      new URL("../fixtures/invalid-top-fillet.json", import.meta.url),
      "utf8",
    ),
  );
  parentPort!.on("message", () => {
    const t0 = performance.now();
    const result = engineFor(doc.id).evaluate(doc, doc.features.length - 1);
    parentPort!.postMessage({
      evaluateMs: Math.round(performance.now() - t0),
      statuses: result.featureStatuses.map((s) => s.status),
    });
  });
  parentPort!.postMessage({ kernelInitMs });
}

await (isMainThread ? drive(Number(process.argv[2] ?? 1)) : serve());
