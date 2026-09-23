import { readFileSync } from "node:fs";
import { beforeAll, expect, test } from "vitest";
import {
  createEmptyDocument,
  type CadDocument,
  type EvaluateResult,
  type Feature,
  type PlaneRef,
  type SketchFeature,
} from "@rockett/shared";
import { initKernel } from "../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../src/geometry/engine.js";
import {
  manyFeaturePart,
  record,
  SAMPLES,
  SLOW_SAMPLES,
} from "./helpers/perfFixtures.js";

const COLUMNS = [
  "metric",
  "fixture",
  "hardware class",
  "runtime",
  "warm-up",
  "repetitions",
  "median",
  "p95",
  "budget",
  "row",
];

const XY: PlaneRef = { kind: "origin", plane: "XY" };
const YZ: PlaneRef = { kind: "origin", plane: "YZ" };
const meta = (id: string) => ({ id, name: id, suppressed: false });
const topFace = {
  kind: "face" as const,
  bodyId: "b:box",
  faceName: "f:box:cap:end",
};

function rect(id: string, w: number, h: number): SketchFeature {
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  return {
    ...meta(id),
    type: "sketch",
    plane: XY,
    constraints: [],
    entities: [
      ...corners.map(([x, y], i) => ({
        id: `${id}-p${i}`,
        kind: "point" as const,
        x,
        y,
      })),
      ...corners.map((_, i) => ({
        id: `${id}-l${i + 1}`,
        kind: "line" as const,
        p1: `${id}-p${i}`,
        p2: `${id}-p${(i + 1) % 4}`,
      })),
    ],
  };
}

function goldenDocument(): CadDocument {
  const doc = createEmptyDocument("bench-golden", "bench-golden");
  doc.features = [rect("boxSk", 20, 30)];
  doc.timelinePosition = 1;
  const engine = engineFor(doc.id);
  const profileId = engine.evaluate(doc).sketches[0]!.profiles[0]!.id;
  dropEngine(doc.id);
  const features: Feature[] = [
    rect("boxSk", 20, 30),
    {
      ...meta("box"),
      type: "extrude",
      profiles: [{ sketchId: "boxSk", profileId }],
      distance: 10,
      direction: "normal",
      operation: "newBody",
    },
    { ...meta("sh"), type: "shell", openFaces: [topFace], thickness: 1 },
    {
      ...meta("mir"),
      type: "mirror",
      bodies: ["b:box"],
      plane: YZ,
      combine: true,
    },
  ];
  doc.features = features;
  doc.timelinePosition = features.length;
  return doc;
}

const cells = (line: string) =>
  line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function alternate(
  doc: CadDocument,
  index: number,
  edit: (feature: Feature) => Feature,
) {
  const edited = {
    ...doc,
    features: doc.features.map((f, i) => (i === index ? edit(f) : f)),
  };
  let calls = 0;
  return () => (calls++ % 2 === 0 ? edited : doc);
}

let golden: CadDocument;
let coldRuns = 0;

beforeAll(async () => {
  await initKernel();
  golden = goldenDocument();
  const id = "bench-check";
  const { bodies, featureStatuses } = engineFor(id).evaluate(golden);
  dropEngine(id);
  expect(featureStatuses.map((s) => s.status)).toEqual([
    "ok",
    "ok",
    "ok",
    "ok",
  ]);
  expect(bodies).toHaveLength(1);
}, 120_000);

test("evaluate golden", async ({ bench }) => {
  const warm = engineFor("bench-warm");
  warm.evaluate(golden);
  const results = await bench.compare(
    bench("evaluate cold golden", () => {
      const id = `bench-cold-${++coldRuns}`;
      engineFor(id).evaluate(golden);
      dropEngine(id);
    }),
    bench("evaluate warm golden", () => {
      warm.evaluate(golden);
    }),
    SAMPLES,
  );
  dropEngine("bench-warm");
  expect(coldRuns).toBeGreaterThanOrEqual(
    SAMPLES.warmupIterations + SAMPLES.iterations,
  );
  for (const name of ["evaluate cold golden", "evaluate warm golden"] as const)
    record(name, results.get(name), SAMPLES.iterations);
});

test("evaluate many-feature", { timeout: 1_800_000 }, async ({ bench }) => {
  const doc = manyFeaturePart();
  const id = "bench-many-feature";
  let cold: EvaluateResult | undefined;
  const sync = { async: false };
  record(
    "evaluate cold many-feature",
    await bench("evaluate cold many-feature", sync, () => {
      dropEngine(id);
      cold = engineFor(id).evaluate(doc);
    }).run(SLOW_SAMPLES),
    SLOW_SAMPLES.iterations,
  );
  expect(cold?.featureStatuses.filter((s) => s.status !== "ok")).toEqual([]);
  expect(cold?.bodies).toHaveLength(1);
  const engine = engineFor(id);
  const tail = alternate(doc, doc.features.length - 1, (f) => {
    if (f.type !== "fillet") throw new Error(`tail is ${f.type}`);
    return { ...f, radius: 0.6 };
  });
  const head = alternate(doc, 1, (f) => {
    if (f.type !== "extrude") throw new Error(`head is ${f.type}`);
    return { ...f, distance: 11 };
  });
  const runs = [
    ["evaluate noop many-feature", () => doc, SAMPLES],
    ["evaluate edit-tail", tail, SAMPLES],
    ["evaluate edit-head", head, SLOW_SAMPLES],
  ] as const;
  for (const [name, next, plan] of runs)
    record(
      name,
      await bench(name, sync, () => {
        engine.evaluate(next());
      }).run(plan),
      plan.iterations,
    );
  dropEngine(id);
});

test("every baseline row fills every column", () => {
  const doc = readFileSync(
    new URL("../../docs/internals/performance.md", import.meta.url),
    "utf8",
  );
  const lines = doc.split("\n");
  const header = lines.findIndex((l) => cells(l)[0] === "metric");
  expect(cells(lines[header] ?? "")).toEqual(COLUMNS);
  const rows = [];
  for (let i = header + 2; lines[i]?.startsWith("|"); i++)
    rows.push(cells(lines[i]!));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row, row[0]).toHaveLength(COLUMNS.length);
    expect(
      row.filter((c) => c === ""),
      row[0],
    ).toEqual([]);
  }
});
