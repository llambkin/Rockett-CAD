import type { EdgeInfo, FaceInfo, VertexInfo } from "./api.js";

const MAGIC = "RKM1";
const PREFIX_BYTES = 8;

type MeshEdge<P> = Omit<EdgeInfo, "polyline"> & { polyline: P };

export interface MeshSource {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
  faces: FaceInfo[];
  edges: MeshEdge<ArrayLike<number>>[];
  vertices: VertexInfo[];
}

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
  edges: (Omit<EdgeInfo, "polyline"> & { offset: number; count: number })[];
  vertices: VertexInfo[];
}

export function encodeMesh(mesh: MeshSource): Uint8Array {
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
    faces: mesh.faces,
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
    faces: header.faces,
    edges,
    vertices: header.vertices,
  };
}
