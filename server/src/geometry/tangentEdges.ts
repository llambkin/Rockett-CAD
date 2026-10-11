import {
  compareNames,
  LINEAR_TOL,
  type EdgeRef,
  type Vec3,
} from "@rockett/shared";
import { ShapeMap } from "./shapeMap.js";
import { computeEdgeNames, type NamedBody } from "./naming.js";
import { surfaceNormal } from "./signature.js";
import {
  acquire,
  edges,
  faces,
  getKernel,
  lengthOf,
  pnt,
  scoped,
  vec,
  type Shape,
} from "./kernel.js";

const PARALLEL = Math.cos(Math.PI / 180);
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, v, j) => sum + v * b[j]!, 0);
const continues = (a: Vec3, b: Vec3) => dot(a, b) < -PARALLEL;
const coincident = (a: Vec3, b: Vec3) =>
  Math.hypot(...a.map((v, j) => v - b[j]!)) < LINEAR_TOL;

function recordEdgeEnds(
  edge: Shape,
  name: string,
  ends: Map<string, { p: Vec3; d: Vec3 }[]>,
  lengths: Map<string, number>,
): void {
  const k = getKernel();
  scoped(() => {
    const curve = acquire(new k.BRepAdaptor_Curve_2(edge)),
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
      return;
    }
  });
}

function normalsAlong(edge: Shape, face: Shape): Vec3[] {
  const k = getKernel();
  return scoped((own) => {
    const ends = [own(new k.gp_Pnt2d_1()), own(new k.gp_Pnt2d_1())] as const;
    k.BRep_Tool.UVPoints_2(edge, face, ...ends);
    const surface = own(new k.BRepAdaptor_Surface_2(face, true));
    return ends.map(
      (uv) => surfaceNormal(face, surface, [uv.X(), uv.Y()]).normal,
    );
  });
}

function namedFaceEdges(
  body: NamedBody,
  names: Map<string, Shape>,
): {
  faceNames: (string | undefined)[];
  faceEdges: Set<string | undefined>[];
  smoothJoins: Set<string>;
} {
  const k = getKernel();
  return scoped((own) => {
    const edgeNames = new ShapeMap<string>();
    own({ delete: () => edgeNames.release() });
    for (const [name, edge] of names) edgeNames.set(edge, name);
    const sides = new Map<string, (Vec3[] | undefined)[]>();
    const faceNames: (string | undefined)[] = [];
    const faceEdges = faces(body.shape).map((face) => {
      faceNames.push(body.names.get(own(face)));
      return new Set(
        edges(face).map((edge) => {
          const name = edgeNames.get(own(edge));
          if (name === undefined) return name;
          const seam = k.BRep_Tool.IsClosed_2(edge, face);
          sides.set(name, [
            ...(sides.get(name) ?? []),
            seam ? undefined : normalsAlong(edge, face),
          ]);
          return name;
        }),
      );
    });
    const smoothJoins = new Set<string>();
    for (const [name, normals] of sides) {
      const [a, b] = normals;
      if (
        normals.includes(undefined) ||
        (normals.length === 2 &&
          a!.every((n, end) => dot(n, b![end]!) > PARALLEL))
      )
        smoothJoins.add(name);
    }
    return { faceNames, faceEdges, smoothJoins };
  });
}

export function sharpEdgesByFace(body: NamedBody): Map<string, string[]> {
  return scoped(() => {
    const names = computeEdgeNames(body).byName;
    const { faceNames, faceEdges, smoothJoins } = namedFaceEdges(body, names);
    const byFace = new Map<string, Set<string>>();
    faceNames.forEach((face, i) => {
      if (face === undefined) return;
      const sharp = byFace.get(face) ?? new Set<string>();
      for (const edge of faceEdges[i]!)
        if (edge !== undefined && !smoothJoins.has(edge)) sharp.add(edge);
      byFace.set(face, sharp);
    });
    return new Map(
      [...byFace].map(([face, sharp]) => [
        face,
        [...sharp].toSorted(compareNames),
      ]),
    );
  });
}

export function tangentEdges(body: NamedBody, seeds: EdgeRef[]): EdgeRef[] {
  return scoped(() => {
    const names = computeEdgeNames(body).byName;
    const ends = new Map<string, { p: Vec3; d: Vec3 }[]>();
    const lengths = new Map<string, number>();
    const { faceEdges, smoothJoins } = namedFaceEdges(body, names);
    for (const ref of seeds) {
      if (ref.bodyId !== body.bodyId)
        throw new Error("All edges must belong to the same body");
      if (!names.has(ref.edgeName))
        throw new Error(`referenced edge no longer exists: ${ref.edgeName}`);
    }
    for (const [name, edge] of names) recordEdgeEnds(edge, name, ends, lengths);
    const chosen = new Set(seeds.map((r) => r.edgeName)),
      queue = [...chosen];
    for (let i = 0; i < queue.length; i++) {
      for (const end of ends.get(queue[i]!) ?? []) {
        const candidates = [...ends].filter(
          ([name, endpoints]) =>
            name !== queue[i] &&
            !smoothJoins.has(name) &&
            endpoints.some(
              (other) =>
                coincident(end.p, other.p) && continues(end.d, other.d),
            ),
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
              faceEdges.some((face) =>
                [queue[i]!, name, n].every((id) => face.has(id)),
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
  });
}
