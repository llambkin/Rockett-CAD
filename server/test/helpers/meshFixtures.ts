type Vec3 = [number, number, number];

export interface Mesh {
  vertices: Vec3[];
  triangles: [number, number, number][];
}

export function cube(size = 10): Mesh {
  const s = size;
  return {
    vertices: [
      [0, 0, 0],
      [s, 0, 0],
      [s, s, 0],
      [0, s, 0],
      [0, 0, s],
      [s, 0, s],
      [s, s, s],
      [0, s, s],
    ],
    triangles: [
      [0, 2, 1],
      [0, 3, 2],
      [0, 1, 5],
      [0, 5, 4],
      [1, 2, 6],
      [1, 6, 5],
      [2, 3, 7],
      [2, 7, 6],
      [3, 0, 4],
      [3, 4, 7],
      [4, 5, 6],
      [4, 6, 7],
    ],
  };
}

export function sphere(slices: number, rings: number, radius = 10): Mesh {
  const vertices: Vec3[] = [[0, 0, radius]];
  for (let i = 1; i < rings; i++) {
    const theta = (Math.PI * i) / rings;
    for (let j = 0; j < slices; j++) {
      const phi = (2 * Math.PI * j) / slices;
      vertices.push([
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(theta),
      ]);
    }
  }
  const south = vertices.push([0, 0, -radius]) - 1;
  const at = (ring: number, slice: number) =>
    1 + (ring - 1) * slices + (slice % slices);
  const triangles: Mesh["triangles"] = [];
  for (let j = 0; j < slices; j++) {
    triangles.push([0, at(1, j), at(1, j + 1)]);
    triangles.push([south, at(rings - 1, j + 1), at(rings - 1, j)]);
    for (let i = 1; i < rings - 1; i++)
      triangles.push(
        [at(i, j), at(i + 1, j), at(i + 1, j + 1)],
        [at(i, j), at(i + 1, j + 1), at(i, j + 1)],
      );
  }
  return { vertices, triangles };
}

export function strip(count: number): Mesh {
  const vertices: Vec3[] = [];
  for (let i = 0; i <= count; i++) vertices.push([i, 0, 0], [i, 1, 0]);
  const triangles: Mesh["triangles"] = [];
  for (let i = 0; i < count; i++) triangles.push([2 * i, 2 * i + 2, 2 * i + 1]);
  return { vertices, triangles };
}

export function binaryStl({ vertices, triangles }: Mesh): Buffer<ArrayBuffer> {
  const out = Buffer.alloc(84 + 50 * triangles.length);
  out.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, t) =>
    triangle.forEach((v, corner) =>
      vertices[v]!.forEach((c, axis) =>
        out.writeFloatLE(c, 84 + 50 * t + 12 + 12 * corner + 4 * axis),
      ),
    ),
  );
  return out;
}

export function asciiStl({ vertices, triangles }: Mesh): string {
  const facets = triangles.map(
    (triangle) =>
      `facet normal 0 0 0\nouter loop\n${triangle
        .map((v) => `vertex ${vertices[v]!.join(" ")}`)
        .join("\n")}\nendloop\nendfacet\n`,
  );
  return `solid mesh\n${facets.join("")}endsolid mesh\n`;
}
