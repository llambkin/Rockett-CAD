import { describe, expect, it } from "vitest";
import type { Tool } from "../src/shared/tools.js";
import { dropCutter, indexMesh, type Mesh } from "../src/surface/dropCutter.js";
import { base, grid, samples, tools } from "./helpers/meshes.js";

type Vec = [number, number, number];

const SPHERE = 10;

function shape(tool: Tool) {
  const corner =
    tool.kind === "ball"
      ? tool.diameter / 2
      : tool.kind === "bull"
        ? tool.cornerRadius
        : 0;
  return { flat: tool.diameter / 2 - corner, corner };
}

function sphere(bands: number, segments: number): Mesh {
  const positions = [0, 0, SPHERE];
  for (let i = 1; i < bands; i++)
    for (let j = 0; j < segments; j++) {
      const polar = (Math.PI * i) / bands;
      const around = (2 * Math.PI * j) / segments;
      positions.push(
        SPHERE * Math.sin(polar) * Math.cos(around),
        SPHERE * Math.sin(polar) * Math.sin(around),
        SPHERE * Math.cos(polar),
      );
    }
  positions.push(0, 0, -SPHERE);
  const last = positions.length / 3 - 1;
  const at = (i: number, j: number) => 1 + (i - 1) * segments + (j % segments);
  const indices: number[] = [];
  for (let j = 0; j < segments; j++) {
    indices.push(0, at(1, j), at(1, j + 1));
    indices.push(last, at(bands - 1, j + 1), at(bands - 1, j));
    for (let i = 1; i < bands - 1; i++)
      indices.push(
        at(i, j),
        at(i + 1, j),
        at(i + 1, j + 1),
        at(i, j),
        at(i + 1, j + 1),
        at(i, j + 1),
      );
  }
  return { positions, indices };
}

function point(mesh: Mesh, index: number): Vec {
  return [0, 1, 2].map((k) => Number(mesh.positions[3 * index + k])) as Vec;
}

function chordError(mesh: Mesh): number {
  let worst = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      point(mesh, Number(mesh.indices[t + k])),
    ) as [Vec, Vec, Vec];
    const u = a.map((v, k) => b[k]! - v);
    const v = a.map((w, k) => c[k]! - w);
    const n = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const plane = Math.abs(n[0]! * a[0] + n[1]! * a[1] + n[2]! * a[2]);
    worst = Math.max(worst, SPHERE - plane / Math.hypot(...n));
  }
  return worst;
}

function sphereGap(tool: Tool, x: number, y: number, tip: number): number {
  const { flat, corner } = shape(tool);
  const out = Math.max(0, Math.hypot(x, y) - flat);
  return Math.abs(Math.hypot(out, tip + corner) - (SPHERE + corner));
}

function sphereTip(tool: Tool, x: number, y: number): number {
  const { flat, corner } = shape(tool);
  const out = Math.max(0, Math.hypot(x, y) - flat);
  return Math.sqrt((SPHERE + corner) ** 2 - out ** 2) - corner;
}

describe("dropCutter", () => {
  const coarse = sphere(12, 24);
  const chord = chordError(coarse);
  const ball = indexMesh(coarse);

  it("stays within the chord error of the sphere offset surface", () => {
    expect(chord).toBeGreaterThan(0.1);
    for (const tool of tools)
      for (const x of samples(-12.9, 12.9, 37))
        for (const y of samples(-12.9, 12.9, 37)) {
          if (Math.hypot(x, y) >= SPHERE + 3 - chord) continue;
          const tip = dropCutter(ball, tool, x, y);
          expect(sphereGap(tool, x, y, tip)).toBeLessThanOrEqual(chord + 1e-6);
          expect(tip).toBeLessThanOrEqual(sphereTip(tool, x, y) + 1e-6);
        }
  });

  it("touches sphere vertices exactly where the contact is a vertex", () => {
    for (const tool of tools) {
      const { flat, corner } = shape(tool);
      for (const index of [0, 1, 5, 30, 57, 100]) {
        const v = point(coarse, index);
        const across = Math.hypot(v[0], v[1]);
        const out = across ? 1 + flat / across : 0;
        const x = v[0] * out + (corner * v[0]) / SPHERE;
        const y = v[1] * out + (corner * v[1]) / SPHERE;
        const tip = dropCutter(ball, tool, x, y);
        expect(tip).toBeCloseTo(sphereTip(tool, x, y), 6);
      }
    }
  });

  it("returns minus infinity out of reach of every triangle", () => {
    for (const tool of tools)
      expect(dropCutter(ball, tool, SPHERE + 3.01, 0)).toBe(-Infinity);
  });

  it("matches the offset of a tilted plane", () => {
    const [gx, gy, z0] = [0.6, -0.35, 1];
    const plane = indexMesh(grid(40, 20, (x, y) => z0 + gx * x + gy * y));
    const length = Math.hypot(gx, gy, 1);
    const [nx, ny, nz] = [-gx / length, -gy / length, 1 / length];
    for (const tool of tools) {
      const { flat, corner } = shape(tool);
      const rise = (corner + flat * Math.hypot(nx, ny)) / nz - corner;
      for (const x of samples(-14, 14, 29))
        for (const y of samples(-14, 14, 29)) {
          const tip = dropCutter(plane, tool, x, y);
          expect(Math.abs(tip - (z0 + gx * x + gy * y + rise))).toBeLessThan(
            1e-6,
          );
        }
    }
  });

  it("touches a lone triangle on each edge and at a vertex", () => {
    const positions = [0, 0, 0, 10, 0, 0, 0, 10, 0];
    const expected = [0, Math.sqrt(9 - 2.5 ** 2) - 3, Math.sqrt(0.75) - 1];
    for (const indices of [
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
    ]) {
      const lone = indexMesh({ positions, indices });
      tools.forEach((tool, n) => {
        expect(dropCutter(lone, tool, -2.5, 3)).toBeCloseTo(expected[n]!, 9);
        expect(dropCutter(lone, tool, 3, -2.5)).toBeCloseTo(expected[n]!, 9);
        expect(dropCutter(lone, tool, -1.5, -2)).toBeCloseTo(expected[n]!, 9);
      });
    }
  });

  it("agrees with testing every triangle on its own", () => {
    const wave = grid(30, 40, (x, y) => 4 * Math.sin(x / 4) * Math.cos(y / 5));
    const alone = Array.from({ length: wave.indices.length / 3 }, (_, t) =>
      indexMesh({
        positions: wave.positions,
        indices: Array.from(wave.indices).slice(3 * t, 3 * t + 3),
      }),
    );
    const surface = indexMesh(wave);
    for (const tool of tools)
      for (const x of samples(-13, 13, 10))
        for (const y of samples(-13, 13, 10)) {
          const each = Math.max(
            ...alone.map((mesh) => dropCutter(mesh, tool, x, y)),
          );
          expect(dropCutter(surface, tool, x, y)).toBeCloseTo(each, 9);
        }
  });

  it("touches the top of a triangle collapsed to a vertical needle", () => {
    const needle = indexMesh({
      positions: [0, 0, 0, 0, 0, 2, 0, 0, 5],
      indices: [0, 1, 2],
    });
    expect(dropCutter(needle, tools[0]!, 1, 0)).toBe(5);
    expect(dropCutter(needle, tools[1]!, 1, 0)).toBeCloseTo(
      2 + Math.sqrt(8),
      12,
    );
  });

  it("refuses tools other than flat, ball and bull", () => {
    const vbit: Tool = {
      ...base,
      id: "v",
      name: "90 degree v-bit",
      kind: "vbit",
      tipAngle: 90,
    };
    expect(() => dropCutter(ball, vbit, 0, 0)).toThrow(RangeError);
  });

  it("refuses indices outside the mesh and coordinates that are not finite", () => {
    expect(() =>
      indexMesh({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3] }),
    ).toThrow(RangeError);
    expect(() =>
      indexMesh({
        positions: [0, 0, 0, 1, 0, Number.NaN, 0, 1, 0],
        indices: [0, 1, 2],
      }),
    ).toThrow(RangeError);
  });
});
