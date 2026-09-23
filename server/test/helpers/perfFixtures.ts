import { expect, type BenchResult } from "vitest";
import {
  createEmptyDocument,
  detectProfiles,
  type CadDocument,
  type EdgeRef,
  type ExtrudeFeature,
  type Feature,
  type FilletFeature,
  type LinearPatternFeature,
  type SketchFeature,
} from "@rockett/shared";

export const SAMPLES = {
  iterations: 10,
  warmupIterations: 2,
  time: 0,
  warmupTime: 0,
  retainSamples: true,
};

export function record(name: string, result: BenchResult, iterations: number) {
  const samples = result.latency.samples ?? [];
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1] ?? NaN;
  console.log(
    `${name}: ${samples.length} samples, median ${result.latency.p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms`,
  );
  expect(samples).toHaveLength(iterations);
}

const STAMP = "2026-01-01T00:00:00.000Z";
const PITCH = 10;
const POCKET = 4;
const BOX = 10;
const BODY_SPACING = 15;

const meta = (id: string) => ({ id, name: id, suppressed: false });

function rect(
  id: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
): SketchFeature {
  const corners: [string, number, number][] = [
    ["a", x0, y0],
    ["b", x0 + w, y0],
    ["c", x0 + w, y0 + h],
    ["d", x0, y0 + h],
  ];
  return {
    ...meta(id),
    type: "sketch",
    plane: { kind: "origin", plane: "XY" },
    constraints: [],
    entities: [
      ...corners.map(([p, x, y]) => ({
        id: `${id}-${p}`,
        kind: "point" as const,
        x,
        y,
      })),
      ...corners.map(([p], i) => ({
        id: `${id}-l${i + 1}`,
        kind: "line" as const,
        p1: `${id}-${p}`,
        p2: `${id}-${corners[(i + 1) % 4]![0]}`,
      })),
    ],
  };
}

function extrude(
  id: string,
  sketch: SketchFeature,
  distance: number,
  operation: ExtrudeFeature["operation"],
): ExtrudeFeature {
  const profile = detectProfiles(sketch.entities)[0];
  if (!profile) throw new Error(`fixture: ${sketch.id} has no profile`);
  return {
    ...meta(id),
    type: "extrude",
    profiles: [{ sketchId: sketch.id, profileId: profile.id }],
    distance,
    direction: "normal",
    operation,
  };
}

function verticalEdges(
  bodyId: string,
  featureId: string,
  sketchId: string,
): EdgeRef[] {
  const side = (n: number) => `f:${featureId}:s:${sketchId}-l${n}`;
  return [
    [1, 2],
    [2, 3],
    [3, 4],
    [1, 4],
  ].map(([a, b]) => ({
    kind: "edge",
    bodyId,
    edgeName: `e[${side(a!)}|${side(b!)}]`,
  }));
}

function fillet(id: string, edges: EdgeRef[], radius: number): FilletFeature {
  return { ...meta(id), type: "fillet", edges, radius };
}

function document(id: string, features: Feature[]): CadDocument {
  return {
    ...createEmptyDocument(id, id),
    createdAt: STAMP,
    modifiedAt: STAMP,
    features,
    timelinePosition: features.length,
  };
}

export function manyFeaturePart(n = 100): CadDocument {
  const columns = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / columns));
  const baseSk = rect("baseSk", 0, 0, columns * PITCH, rows * PITCH);
  const features: Feature[] = [baseSk, extrude("base", baseSk, 10, "newBody")];
  for (let k = 0; k < n; k++) {
    const offset = (PITCH - POCKET) / 2;
    const sk = rect(
      `sk${k}`,
      (k % columns) * PITCH + offset,
      Math.floor(k / columns) * PITCH + offset,
      POCKET,
      POCKET,
    );
    features.push(
      sk,
      extrude(`cut${k}`, sk, 5, "cut"),
      fillet(`fil${k}`, verticalEdges("b:base", `cut${k}`, sk.id), 0.5),
    );
  }
  return document(`perf-many-feature-${n}`, features);
}

export function manyBodyPart(): CadDocument {
  const boxSk = rect("boxSk", 0, 0, BOX, BOX);
  const row = Array.from({ length: 24 }, (_, i) => `b:px:b:box:${i + 1}`);
  const pattern = (
    id: string,
    axis: "X" | "Y",
    bodies: string[],
    count: number,
  ): LinearPatternFeature => ({
    ...meta(id),
    type: "linearPattern",
    bodies,
    direction: { kind: "axis", axis },
    count,
    spacing: BODY_SPACING,
    combine: false,
  });
  return document("perf-many-body", [
    boxSk,
    extrude("box", boxSk, 5, "newBody"),
    fillet("fil", verticalEdges("b:box", "box", "boxSk"), 1),
    pattern("px", "X", ["b:box"], 25),
    pattern("py", "Y", ["b:box", ...row], 40),
  ]);
}
