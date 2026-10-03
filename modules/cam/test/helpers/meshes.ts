import type { Tool } from "../../src/shared/tools.js";
import type { Mesh } from "../../src/surface/dropCutter.js";

export const base = {
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

export const tools: Tool[] = [
  { ...base, id: "flat", name: "6 mm flat", kind: "flat" },
  { ...base, id: "ball", name: "6 mm ball", kind: "ball" },
  { ...base, id: "bull", name: "6 mm bull", kind: "bull", cornerRadius: 1 },
];

export function grid(
  size: number,
  cells: number,
  height: (x: number, y: number) => number,
): Mesh {
  const positions: number[] = [];
  for (let i = 0; i <= cells; i++)
    for (let j = 0; j <= cells; j++) {
      const x = -size / 2 + (size * i) / cells;
      const y = -size / 2 + (size * j) / cells;
      positions.push(x, y, height(x, y));
    }
  const at = (i: number, j: number) => i * (cells + 1) + j;
  const indices: number[] = [];
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < cells; j++)
      indices.push(
        at(i, j),
        at(i + 1, j),
        at(i + 1, j + 1),
        at(i, j),
        at(i + 1, j + 1),
        at(i, j + 1),
      );
  return { positions, indices };
}

export function samples(from: number, to: number, count: number): number[] {
  return Array.from(
    { length: count },
    (_, i) => from + ((to - from) * i) / (count - 1),
  );
}
