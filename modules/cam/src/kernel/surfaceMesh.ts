import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type { Placement } from "../shared/setup.js";
import type { Mesh } from "../surface/dropCutter.js";
import { read, shapes, toSetup } from "./regions.js";

export const CHORD_FRACTION = 0.25;
export const CACHED_MESHES = 8;

export type SurfaceMeshInput = {
  bodies: { identity: string; brep: string }[];
  modelToSetup: Placement;
  tolerance: number;
};

type FaceMesh = { positions: Float64Array; indices: Uint32Array };

const ANGLE = 0.5;
const cache = new Map<string, Mesh>();

function faces(
  scope: KernelJobScope,
  text: string,
  at: Placement,
  chord: number,
) {
  const { oc, own } = scope;
  const body = toSetup(scope, read(scope, text, "surfaceMesh"), at);
  const mesher = own(
    new oc.BRepMesh_IncrementalMesh_2(body, chord, false, ANGLE, false),
  );
  if (!mesher.IsDone()) throw new Error("surface mesh failed on a body");
  return [...shapes(scope, body, "TopAbs_FACE")].map((face): FaceMesh => {
    const mesh = oc.meshFace(own(oc.TopoDS.Face_1(face)));
    if (!mesh) throw new Error("surface mesh left a face without triangles");
    return mesh;
  });
}

function joined(parts: FaceMesh[]): Mesh {
  const positions = new Float64Array(
    parts.reduce((sum, part) => sum + part.positions.length, 0),
  );
  const indices = new Uint32Array(
    parts.reduce((sum, part) => sum + part.indices.length, 0),
  );
  let points = 0;
  let corners = 0;
  for (const part of parts) {
    positions.set(part.positions, points);
    indices.set(
      part.indices.map((index) => index + points / 3),
      corners,
    );
    points += part.positions.length;
    corners += part.indices.length;
  }
  return { positions, indices };
}

export default defineKernelJobs({
  "rockett.cam.surfaceMesh": (input: SurfaceMeshInput, scope): Mesh => {
    if (!(input.tolerance > 0 && Number.isFinite(input.tolerance)))
      throw new RangeError("surface mesh tolerance must be a number above 0");
    const chord = input.tolerance * CHORD_FRACTION;
    const { rotation, translation } = input.modelToSetup;
    const key = JSON.stringify([
      input.bodies.map(({ identity }) => identity),
      rotation,
      translation,
      chord,
    ]);
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const mesh = joined(
      input.bodies.flatMap(({ brep }, index) => {
        const parts = faces(scope, brep, input.modelToSetup, chord);
        scope.progress(index + 1, input.bodies.length, "surface mesh");
        return parts;
      }),
    );
    cache.set(key, mesh);
    if (cache.size > CACHED_MESHES) cache.delete(cache.keys().next().value!);
    return mesh;
  },
});
