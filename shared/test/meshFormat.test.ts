import { expect, it } from "vitest";
import { decodeMesh, encodeMesh, type MeshSource } from "../src/index.js";

const sample: MeshSource = {
  positions: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10],
  normals: [0, 0, -1, 0, 0, -1, 0, 0, -1, 0.5, 0.5, 0.5],
  indices: [0, 2, 1, 0, 1, 3],
  faces: [
    {
      name: "f:base",
      start: 0,
      count: 3,
      surface: { type: "plane", origin: [0, 0, 0], normal: [0, 0, -1] },
      area: 50,
    },
    {
      name: "f:side",
      start: 3,
      count: 3,
      surface: {
        type: "cylinder",
        origin: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 0.1,
      },
      area: 0.123456789,
    },
  ],
  edges: [
    {
      name: "e:line",
      polyline: [0, 0, 0, 10, 0, 0],
      length: 10,
      curve: { type: "line", a: [0, 0, 0], b: [10, 0, 0] },
    },
    {
      name: "e:arc",
      polyline: [10, 0, 0, 0, 10, 0, 0, 0, 10],
      length: 15.707963267948966,
      curve: {
        type: "circle",
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 10,
        start: [10, 0, 0],
        sweep: 1.5707963267948966,
      },
    },
    { name: "e:empty", polyline: [], length: 0, curve: { type: "other" } },
  ],
  vertices: [{ name: "v:0", position: [0, 0, 0] }],
};

function gridBody(columns: number, rows: number): MeshSource {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= columns; c++) {
      const theta = (c / columns) * Math.PI * 2;
      const phi = (r / rows) * Math.PI;
      const n = [
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ];
      normals.push(...n);
      positions.push(...n.map((v) => v * 37.3));
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c;
      const b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return {
    positions,
    normals,
    indices,
    faces: [
      {
        name: "f:sphere",
        start: 0,
        count: indices.length,
        surface: { type: "other" },
        area: 17484.03,
      },
    ],
    edges: [
      {
        name: "e:seam",
        polyline: positions.slice(0, 3 * (columns + 1)),
        length: 234.37,
        curve: { type: "other" },
      },
    ],
    vertices: [],
  };
}

it("round trips a sample mesh exactly", () => {
  expect(decodeMesh(encodeMesh(sample))).toEqual({
    positions: Float32Array.from(sample.positions),
    normals: Float32Array.from(sample.normals),
    indices: Uint32Array.from(sample.indices),
    faces: sample.faces,
    edges: sample.edges.map((e) => ({
      ...e,
      polyline: Float32Array.from(e.polyline),
    })),
    vertices: sample.vertices,
  });
});

it("rejects a wrong magic", () => {
  const bytes = encodeMesh(sample);
  bytes[3] = "2".charCodeAt(0);
  expect(() => decodeMesh(bytes)).toThrow(/magic/);
});

it("rejects truncated buffers", () => {
  const bytes = encodeMesh(sample);
  for (const length of [0, 3, 6, 20, bytes.length - 1]) {
    expect(() => decodeMesh(bytes.subarray(0, length))).toThrow();
  }
});

it("rejects trailing bytes", () => {
  const bytes = encodeMesh(sample);
  const longer = new Uint8Array(bytes.length + 4);
  longer.set(bytes);
  expect(() => decodeMesh(longer)).toThrow(/length/);
});

it("encodes a 2,000-triangle body to less than half its JSON size", () => {
  const body = gridBody(40, 25);
  expect(body.indices.length / 3).toBe(2000);
  const encoded = encodeMesh(body);
  expect(encoded.byteLength).toBeLessThan(JSON.stringify(body).length / 2);
  expect(decodeMesh(encoded).indices).toEqual(Uint32Array.from(body.indices));
});
