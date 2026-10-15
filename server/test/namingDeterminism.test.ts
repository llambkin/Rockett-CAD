import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { initKernel } from "../src/geometry/kernel.js";
import { dumpNames, TIMELINES, type NameDump } from "./helpers/dumpNames.js";

beforeAll(initKernel, 120_000);

it("a fresh process gives the same body ids and face, edge and vertex names", () => {
  const local = dumpNames();
  expect(Object.keys(local)).toEqual(Object.keys(TIMELINES));
  for (const { statuses } of Object.values(local))
    expect(statuses.filter((s) => s !== "ok")).toEqual([]);
  const helper = fileURLToPath(
    new URL("./helpers/dumpNames.ts", import.meta.url),
  );
  const { status, signal, stdout, stderr } = spawnSync(
    process.execPath,
    ["--import", "tsx", helper],
    { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 2 ** 20 },
  );
  expect({ status, signal, stderr }).toMatchObject({ status: 0, signal: null });
  const child: NameDump = JSON.parse(stdout.trim().split("\n").at(-1)!);
  for (const key of Object.keys(TIMELINES))
    expect(child[key], key).toEqual(local[key]);
}, 150_000);
