import {
  detectProfiles,
  type SketchFeature,
  type Feature,
  type ExtrudeFeature,
} from "@rockett/shared";
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
