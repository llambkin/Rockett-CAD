import type { EdgeRef, Vec3 } from "@rockett/shared";
import { computeEdgeNames, type NamedBody } from "./naming.js";
import {
  edges,
  faces,
  getKernel,
  lengthOf,
  pnt,
  shapeHash,
  vec,
} from "./kernel.js";

/** Follow smooth continuations and tiny connecting steps, stopping at corners and ambiguous branches. */
export function tangentEdges(body: NamedBody, seeds: EdgeRef[]): EdgeRef[] {
  const names = computeEdgeNames(body).byName,
    k = getKernel();
  const ends = new Map<string, { p: Vec3; d: Vec3 }[]>();
  const lengths = new Map<string, number>();
  const faceEdges = faces(body.shape).map(
    (face) => new Set(edges(face).map(shapeHash)),
  );
  for (const ref of seeds) {
    if (ref.bodyId !== body.bodyId)
      throw new Error("All edges must belong to the same body");
    if (!names.has(ref.edgeName))
      throw new Error(`referenced edge no longer exists: ${ref.edgeName}`);
  }
  for (const [name, edge] of names) {
    const curve = new k.BRepAdaptor_Curve_2(edge),
      p = pnt(0, 0, 0),
      d = vec(0, 0, 0);
    try {
      const endpoints = [curve.FirstParameter(), curve.LastParameter()].map(
        (t, i) => {
          curve.D1(t, p, d);
          const length = Math.hypot(d.X(), d.Y(), d.Z());
          const sign = (i === 0 ? 1 : -1) / length;
          return {
            p: [p.X(), p.Y(), p.Z()] as Vec3,
            d: [d.X() * sign, d.Y() * sign, d.Z() * sign] as Vec3,
          };
        },
      );
      if (endpoints.every((e) => e.d.every(Number.isFinite))) {
        ends.set(name, endpoints);
        lengths.set(name, lengthOf(edge));
      }
    } catch {
      /* Singular/degenerated edges do not establish a tangent continuation. */
    } finally {
      curve.delete();
      p.delete();
      d.delete();
    }
  }
  const chosen = new Set(seeds.map((r) => r.edgeName)),
    queue = [...chosen];
  const coincident = (a: Vec3, b: Vec3) =>
    Math.hypot(...a.map((v, j) => v - b[j]!)) < 1e-6;
  const continues = (a: Vec3, b: Vec3) =>
    a.reduce((sum, v, j) => sum + v * b[j]!, 0) < -Math.cos(Math.PI / 180);
  for (let i = 0; i < queue.length; i++) {
    for (const end of ends.get(queue[i]!) ?? []) {
      const candidates = [...ends].filter(
        ([name, endpoints]) =>
          name !== queue[i] &&
          endpoints.some(
            (other) =>
              Math.hypot(...end.p.map((v, j) => v - other.p[j]!)) < 1e-6 &&
              end.d.reduce((sum, v, j) => sum + v * other.d[j]!, 0) <
                -Math.cos(Math.PI / 180),
          ),
      );
      if (candidates.length === 1 && !chosen.has(candidates[0]![0])) {
        chosen.add(candidates[0]![0]);
        queue.push(candidates[0]![0]);
      }
      if (candidates.length !== 0) continue;
      // A tiny step between otherwise parallel edges is common after joining
      // separately dimensioned sketch regions. Include its real connecting
      // edge (never bridge empty space), so the chamfer contour stays complete.
      const bridges: string[][] = [];
      for (const [name, endpoints] of ends) {
        if (
          name === queue[i] ||
          lengths.get(name)! > Math.min(0.01, lengths.get(queue[i]!)! * 0.01)
        )
          continue;
        const at = endpoints.findIndex((other) => coincident(end.p, other.p));
        if (at < 0) continue;
        const far = endpoints[1 - at]!;
        const neighbours = [...ends].filter(
          ([n, es]) =>
            n !== name &&
            n !== queue[i] &&
            es.some((e) => coincident(far.p, e.p) && continues(end.d, e.d)) &&
            faceEdges.some((face) =>
              [queue[i]!, name, n].every((id) =>
                face.has(shapeHash(names.get(id)!)),
              ),
            ),
        );
        // Stop at junctions rather than guessing a path through another feature.
        if (neighbours.length !== 1) continue;
        const [next] = neighbours[0]!;
        if (lengths.get(name)! > lengths.get(next)! * 0.01) continue;
        bridges.push([name, next]);
      }
      if (bridges.length === 1)
        for (const name of bridges[0]!) {
          if (!chosen.has(name)) {
            chosen.add(name);
            queue.push(name);
          }
        }
    }
  }
  return [...chosen].map((edgeName) => ({
    kind: "edge",
    bodyId: body.bodyId,
    edgeName,
  }));
}
