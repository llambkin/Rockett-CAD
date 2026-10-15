import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

type Report = {
  openMs: number;
  editMs: number[];
  statuses: string[];
  bodies: number;
  faces: number;
  volume: number;
};

it("pushing up a filleted copy's top face in the many-body fixture opens and edits within budget", () => {
  const helper = fileURLToPath(
    new URL("./helpers/pushPull.ts", import.meta.url),
  );
  const { status, signal, stdout, stderr } = spawnSync(
    process.execPath,
    ["--import", "tsx", helper],
    { encoding: "utf8", timeout: 60_000 },
  );
  expect({ status, signal, stderr }).toMatchObject({ status: 0, signal: null });
  const report: Report = JSON.parse(stdout);
  process.stdout.write(`push pull many-body ${stdout}\n`);
  expect(report.statuses.filter((s) => s !== "ok")).toEqual([]);
  expect(report.bodies).toBe(1000);
  expect(report.volume).toBeCloseTo(15 * (96 + Math.PI), 6);
  expect(report.openMs).toBeLessThan(20_000);
  const median = report.editMs[Math.floor(report.editMs.length / 2)]!;
  expect(median).toBeLessThan(2_000);
  expect(report.editMs.at(-1)).toBeLessThan(5_000);
}, 90_000);
