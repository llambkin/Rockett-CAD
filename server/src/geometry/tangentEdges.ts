import { LINEAR_TOL, type EdgeRef, type Vec3 } from "@rockett/shared";
import { chamferContinuity } from "./planarChamfer.js";
import { computeEdgeNames, type NamedBody } from "./naming.js";
import {
  edges,
  faces,
  getKernel,
  lengthOf,
  pnt,
  shapeHash,
  scoped,
  release,
  type Shape,
  vec,
} from "./kernel.js";

function edgeEnds(edge: Shape): { p: Vec3; d: Vec3 }[] {
  const k = getKernel(),
    curve = new k.BRepAdaptor_Curve_2(edge),
    p = pnt(0, 0, 0),
    d = vec(0, 0, 0);
  try {
    const result = [curve.FirstParameter(), curve.LastParameter()].map(
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
    return result.every((end) => end.d.every(Number.isFinite)) ? result : [];
  } catch {
    return [];
  } finally {
    curve.delete();
    p.delete();
    d.delete();
  }
}

export function tangentEdges(
  body: NamedBody,
  seeds: EdgeRef[],
  chamfer = false,
): EdgeRef[] {
  const names = computeEdgeNames(body).byName;
  try {
    const compatible = chamfer ? chamferContinuity(body, names) : () => true;
    const ends = new Map<string, { p: Vec3; d: Vec3 }[]>();
    const lengths = new Map<string, number>();
    const faceEdges = scoped((own) =>
      faces(body.shape)
        .map(own)
        .map((face) => new Set(edges(face).map(own).map(shapeHash))),
    );
    for (const ref of seeds) {
      if (ref.bodyId !== body.bodyId)
        throw new Error("All edges must belong to the same body");
      if (!names.has(ref.edgeName))
        throw new Error(`referenced edge no longer exists: ${ref.edgeName}`);
    }
    for (const [name, edge] of names) {
      const endpoints = edgeEnds(edge);
      if (endpoints.length) {
        ends.set(name, endpoints);
        lengths.set(name, lengthOf(edge));
      }
    }

    const chosen = new Set(seeds.map((r) => r.edgeName)),
      queue = [...chosen];
    const coincident = (a: Vec3, b: Vec3) =>
      Math.hypot(...a.map((v, j) => v - b[j]!)) < LINEAR_TOL;
    const continues = (a: Vec3, b: Vec3) =>
      a.reduce((sum, v, j) => sum + v * b[j]!, 0) < -Math.cos(Math.PI / 180);
    for (let i = 0; i < queue.length; i++) {
      for (const end of ends.get(queue[i]!) ?? []) {
        const candidates = [...ends].filter(
          ([name, endpoints]) =>
            name !== queue[i] &&
            endpoints.some(
              (other) =>
                coincident(end.p, other.p) && continues(end.d, other.d),
            ) &&
            compatible(queue[i]!, name),
        );
        if (candidates.length === 1 && !chosen.has(candidates[0]![0])) {
          chosen.add(candidates[0]![0]);
          queue.push(candidates[0]![0]);
        }
        if (candidates.length !== 0) continue;
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
              compatible(queue[i]!, n) &&
              faceEdges.some((face) =>
                [queue[i]!, name, n].every((id) =>
                  face.has(shapeHash(names.get(id)!)),
                ),
              ),
          );
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
  } finally {
    release(names.values());
  }
}

export function collectEdges(
  body: NamedBody,
  byName: Map<string, Shape>,
  refs: EdgeRef[],
  tangentChain: boolean | undefined,
  label: string,
): { edge: Shape; name: string }[] {
  const resolve = (ref: EdgeRef) => {
    if (ref.bodyId !== body.bodyId)
      throw new Error(`all ${label} edges must belong to the same body`);
    const edge = byName.get(ref.edgeName);
    if (!edge)
      throw new Error(`referenced edge no longer exists: ${ref.edgeName}`);
    return { edge, name: ref.edgeName };
  };
  const seeds = refs.map(resolve);
  return tangentChain
    ? tangentEdges(body, refs, label === "chamfer").map(resolve)
    : seeds;
}
