import { fileURLToPath } from "node:url";
import {
  createEmptyDocument,
  detectProfiles,
  type ExtrudeFeature,
  type Feature,
  type SketchFeature,
} from "@rockett/shared";
import { initKernel } from "../../src/geometry/kernel.js";
import { dropEngine, engineFor } from "../../src/geometry/engine.js";
import { stepFixture } from "./stepFixture.js";

export const meta = (id: string) => ({ id, name: id, suppressed: false });

export function rect(
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
    ...meta(`${id}Sk`),
    type: "sketch",
    plane: { kind: "origin", plane: "XY" },
    constraints: [],
    entities: [
      ...corners.map(([p, x, y]) => ({
        id: `${id}Sk-${p}`,
        kind: "point" as const,
        x,
        y,
      })),
      ...corners.map(([p], i) => ({
        id: `${id}Sk-l${i + 1}`,
        kind: "line" as const,
        p1: `${id}Sk-${p}`,
        p2: `${id}Sk-${corners[(i + 1) % 4]![0]}`,
      })),
    ],
  };
}

export function box(
  id: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
  d: number,
  operation: ExtrudeFeature["operation"] = "newBody",
): Feature[] {
  const sketch = rect(id, x0, y0, w, h);
  return [
    sketch,
    {
      ...meta(id),
      type: "extrude",
      profiles: [
        {
          sketchId: sketch.id,
          profileId: detectProfiles(sketch.entities)[0]!.id,
        },
      ],
      distance: d,
      direction: "normal",
      operation,
    },
  ];
}

export const TIMELINES: Record<string, () => Feature[]> = {
  join: () => [
    ...box("box", 0, 0, 20, 30, 10),
    ...box("tool", 10, 10, 20, 30, 10, "join"),
  ],
  splitCut: () => [
    ...box("box", 0, 0, 20, 30, 10),
    ...box("slot", 5, -5, 3, 40, 10, "cut"),
  ],
  circularPattern: () => [
    ...box("ring", 10, -5, 10, 10, 10),
    {
      ...meta("cpat"),
      type: "circularPattern",
      bodies: ["b:ring"],
      axis: { kind: "originAxis", axis: "Z" },
      count: 4,
      totalAngle: 360,
      combine: true,
    },
  ],
  fillet: () => [
    ...box("box", 0, 0, 20, 30, 10),
    {
      ...meta("fil"),
      type: "fillet",
      edges: [
        {
          kind: "edge",
          bodyId: "b:box",
          edgeName: "e[f:box:s:boxSk-l1|f:box:s:boxSk-l2]",
        },
      ],
      radius: 2,
    },
  ],
  stepImport: () => [
    {
      ...meta("step"),
      type: "importStep",
      filename: "two.step",
      data: stepFixture(true),
    },
  ],
};

export type NameDump = Record<
  string,
  {
    statuses: string[];
    bodies: {
      bodyId: string;
      faces: string[];
      edges: string[];
      vertices: string[];
    }[];
  }
>;

export function dumpNames(order = Object.keys(TIMELINES)): NameDump {
  const dump: NameDump = {};
  for (const key of order) {
    const doc = createEmptyDocument(`names-${key}`, key);
    doc.features = TIMELINES[key]!();
    doc.timelinePosition = doc.features.length;
    const result = engineFor(doc.id).evaluate(doc);
    dropEngine(doc.id);
    dump[key] = {
      statuses: result.featureStatuses.map((s) => s.status),
      bodies: result.bodies.map((b) => ({
        bodyId: b.bodyId,
        faces: b.faces.map((f) => f.name),
        edges: b.edges.map((e) => e.name),
        vertices: b.vertices.map((v) => v.name),
      })),
    };
  }
  return dump;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initKernel();
  process.stdout.write(
    JSON.stringify(dumpNames(Object.keys(TIMELINES).reverse())),
    () => process.exit(0),
  );
}
