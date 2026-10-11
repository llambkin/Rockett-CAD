import type { MeshedBody } from "@rockett/shared";

export function meshedBody(patch: Partial<MeshedBody> = {}): MeshedBody {
  return {
    bodyId: "b1",
    name: "Body1",
    meshKey: "fixture",
    bbox: { min: [0, 0, 0], max: [10, 10, 10] },
    positions: [],
    normals: [],
    indices: [],
    faces: [],
    edges: [],
    vertices: [],
    ...patch,
  };
}
