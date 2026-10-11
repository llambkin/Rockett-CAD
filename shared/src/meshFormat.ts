import type {
  EdgeInfo,
  FaceInfo,
  MeshedBody,
  MeshPayload,
  Vec3,
  VertexInfo,
} from "./api.js";

const MAGIC = "RKM1";
const PREFIX_BYTES = 8;

type MeshEdge<P> = Omit<EdgeInfo, "polyline"> & { polyline: P };

export type MeshSource = {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
  edges: MeshEdge<ArrayLike<number>>[];
  vertices: VertexInfo[];
} & ({ faces: FaceInfo[] } | { triangles: string[] });

export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faces: FaceInfo[];
  edges: MeshEdge<Float32Array>[];
  vertices: VertexInfo[];
}

interface MeshHeader {
  positions: number;
  normals: number;
  indices: number;
  faces: FaceInfo[];
  triangles?: string[];
  edges: (Omit<EdgeInfo, "polyline"> & { offset: number; count: number })[];
  vertices: VertexInfo[];
}

function triangleFaces(
  names: string[],
  at: Float32Array,
  normals: Float32Array,
): FaceInfo[] {
  return names.map((name, t) => {
    const corner = (c: number): Vec3 => [
      at[9 * t + 3 * c]!,
      at[9 * t + 3 * c + 1]!,
      at[9 * t + 3 * c + 2]!,
    ];
    const [p, q, r] = [corner(0), corner(1), corner(2)];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]] as const;
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]] as const;
    const area =
      Math.hypot(
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ) / 2;
    const normal: Vec3 = [
      normals[9 * t]!,
      normals[9 * t + 1]!,
      normals[9 * t + 2]!,
    ];
    return {
      name,
      start: 3 * t,
      count: 3,
      surface: { type: "plane", origin: p, normal },
      area,
    };
  });
}

export function encodeMesh(mesh: MeshSource): Uint8Array<ArrayBuffer> {
  let polylineCount = 0;
  const edges = mesh.edges.map(({ polyline, ...edge }) => {
    const entry = { ...edge, offset: polylineCount, count: polyline.length };
    polylineCount += polyline.length;
    return entry;
  });
  const header: MeshHeader = {
    positions: mesh.positions.length,
    normals: mesh.normals.length,
    indices: mesh.indices.length,
    ...("faces" in mesh
      ? { faces: mesh.faces }
      : { faces: [], triangles: mesh.triangles }),
    edges,
    vertices: mesh.vertices,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const values =
    header.positions + header.normals + header.indices + polylineCount;
  const bytes = new Uint8Array(PREFIX_BYTES + json.length + 4 * values);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(MAGIC));
  view.setUint32(4, json.length, true);
  bytes.set(json, PREFIX_BYTES);
  let at = PREFIX_BYTES + json.length;
  const write = (source: ArrayLike<number>, float: boolean) => {
    for (let i = 0; i < source.length; i++, at += 4) {
      if (float) view.setFloat32(at, source[i]!, true);
      else view.setUint32(at, source[i]!, true);
    }
  };
  write(mesh.positions, true);
  write(mesh.normals, true);
  write(mesh.indices, false);
  for (const edge of mesh.edges) write(edge.polyline, true);
  return bytes;
}

export function decodeMesh(bytes: Uint8Array): BodyMesh {
  if (bytes.length < PREFIX_BYTES) throw new Error("mesh is truncated");
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) {
    throw new Error(`mesh magic is not ${MAGIC}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerEnd = PREFIX_BYTES + view.getUint32(4, true);
  if (headerEnd > bytes.length) throw new Error("mesh is truncated");
  const header: MeshHeader = JSON.parse(
    new TextDecoder().decode(bytes.subarray(PREFIX_BYTES, headerEnd)),
  );
  const polylineCount = header.edges.reduce((sum, e) => sum + e.count, 0);
  const counts = [
    header.positions,
    header.normals,
    header.indices,
    polylineCount,
  ];
  if (!counts.every((c) => Number.isSafeInteger(c) && c >= 0)) {
    throw new Error("mesh header counts are invalid");
  }
  const expected = headerEnd + 4 * counts.reduce((sum, c) => sum + c, 0);
  if (bytes.length !== expected) {
    throw new Error(`mesh length ${bytes.length} is not ${expected}`);
  }
  let at = headerEnd;
  const read = <T extends Float32Array | Uint32Array>(
    out: T,
    float: boolean,
  ) => {
    for (let i = 0; i < out.length; i++, at += 4) {
      out[i] = float ? view.getFloat32(at, true) : view.getUint32(at, true);
    }
    return out;
  };
  const positions = read(new Float32Array(header.positions), true);
  const normals = read(new Float32Array(header.normals), true);
  const indices = read(new Uint32Array(header.indices), false);
  const triangles = header.triangles;
  if (
    triangles &&
    (9 * triangles.length !== positions.length ||
      9 * triangles.length !== normals.length ||
      3 * triangles.length !== indices.length)
  ) {
    throw new Error("mesh triangles do not match its arrays");
  }
  const polylines = read(new Float32Array(polylineCount), true);
  const edges = header.edges.map(({ offset, count, ...edge }) => {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset + count > polylineCount
    ) {
      throw new Error(`mesh edge ${edge.name} is out of range`);
    }
    return { ...edge, polyline: polylines.subarray(offset, offset + count) };
  });
  return {
    positions,
    normals,
    indices,
    faces: triangles
      ? triangleFaces(triangles, positions, normals)
      : header.faces,
    edges,
    vertices: header.vertices,
  };
}

const MESH_FIELDS = [
  "positions",
  "normals",
  "indices",
  "faces",
  "edges",
  "vertices",
] as const satisfies (keyof MeshPayload)[];

const binaries = new WeakMap<object, Uint8Array>();
const coarseLevels = new WeakMap<Uint8Array, Uint8Array>();

function numbers(view: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < view.length; i++) out.push(view[i]!);
  return out;
}

export function meshPayloadOf(bytes: Uint8Array): MeshPayload {
  const mesh = decodeMesh(bytes);
  return {
    positions: numbers(mesh.positions),
    normals: numbers(mesh.normals),
    indices: numbers(mesh.indices),
    faces: mesh.faces,
    edges: mesh.edges.map((edge) => ({
      ...edge,
      polyline: numbers(edge.polyline),
    })),
    vertices: mesh.vertices,
  };
}

export function lazyMesh<T extends object>(
  head: T,
  binary: Uint8Array,
): T & MeshPayload {
  let mesh: MeshPayload | undefined;
  const read = () => (mesh ??= meshPayloadOf(binary));
  const body = Object.defineProperties(
    head,
    Object.fromEntries(
      MESH_FIELDS.map((key) => [
        key,
        { enumerable: true, get: () => read()[key] },
      ]),
    ),
  ) as T & MeshPayload;
  binaries.set(body, binary);
  return body;
}

export function withCoarse(binary: Uint8Array, coarse?: Uint8Array) {
  if (coarse) coarseLevels.set(binary, coarse);
  return binary;
}

export function coarseOf(body: object): Uint8Array | undefined {
  const binary = binaries.get(body);
  return binary && coarseLevels.get(binary);
}

export function meshBinary(body: MeshSource): Uint8Array {
  return binaries.get(body) ?? encodeMesh(body);
}

export function meshHead<T extends MeshedBody>(
  body: T,
): Omit<T, keyof MeshPayload> {
  const fields: readonly string[] = MESH_FIELDS;
  return Object.fromEntries(
    Object.keys(body)
      .filter((key) => !fields.includes(key))
      .map((key) => [key, body[key as keyof T]]),
  ) as Omit<T, keyof MeshPayload>;
}
