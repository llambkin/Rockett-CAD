import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

type Report = {
  node: string;
  baselineRssMb: number;
  afterTerminateRssMb: number;
  rounds: {
    readyMs: number;
    kernelInitMs: number;
    evaluateMs: number;
    rssMb: number;
    statuses: string[];
  }[][];
};

it("boots, evaluates, terminates, respawns and exits one kernel worker cleanly", () => {
  const helper = fileURLToPath(
    new URL("./helpers/lifecycleWorker.ts", import.meta.url),
  );
  const { status, signal, stdout, stderr } = spawnSync(
    process.execPath,
    ["--import", "tsx", helper, "1"],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect({ status, signal, stderr }).toMatchObject({ status: 0, signal: null });
  const report: Report = JSON.parse(stdout);
  const runs = report.rounds.flat();
  process.stdout.write(`kernel lifecycle ${stdout}`);
  expect(runs).toHaveLength(2);
  for (const run of runs) {
    expect(run.statuses.filter((s) => s !== "ok")).toEqual(["rolledBack"]);
    expect(run.kernelInitMs).toBeGreaterThan(0);
    expect(run.rssMb).toBeGreaterThan(report.baselineRssMb);
  }
}, 150_000);
