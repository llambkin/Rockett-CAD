import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import {
  acquire,
  faceCentroid,
  getKernel,
  listToArray,
  pnt,
  scoped,
  shapeHash,
  vec,
  vertices as verticesOf,
  type Shape,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";

export interface OpenEnd {
  at: Vec3;
  out: Vec3;
}

function outward(edge: Shape, vertex: Shape): OpenEnd {
  return scoped(() => {
    const k = getKernel();
    const at = vertexPoint(vertex);
    const curve = acquire(new k.BRepAdaptor_Curve_2(edge));
    const p = pnt(0, 0, 0);
    const d = vec(0, 0, 0);
    const [start, end] = [curve.FirstParameter(), curve.LastParameter()];
    curve.D1(start, p, d);
    const atStart = V.norm(V.sub([p.X(), p.Y(), p.Z()], at)) < LINEAR_TOL;
    curve.D1(atStart ? start : end, p, d);
    const along = V.normalize([d.X(), d.Y(), d.Z()]);

    return { at, out: atStart ? V.scale(along, -1) : along };
  });
}

function capsEnd(face: Shape, end: OpenEnd): boolean {
  const k = getKernel();
  return scoped((own) => {
    const typed = own(k.TopoDS.Face_1(face));
    const surface = own(new k.BRepAdaptor_Surface_2(typed, true));
    const [u0, u1] = [surface.FirstUParameter(), surface.LastUParameter()];
    const [v0, v1] = [surface.FirstVParameter(), surface.LastVParameter()];
    const onPlane = (at: Vec3) =>
      Math.abs(V.dot(V.sub(at, end.at), end.out)) <= LINEAR_TOL;
    const samples = [0, 0.5, 1].flatMap((s) =>
      [0, 0.5, 1].map((t) => {
        const p = own(surface.Value(u0 + s * (u1 - u0), v0 + t * (v1 - v0)));
        return [p.X(), p.Y(), p.Z()] as Vec3;
      }),
    );
    return [faceCentroid(typed), ...samples].every(onPlane);
  });
}

export function contourEndReferences(
  op: any,
  sourceEdges: { edge: Shape }[],
  spilled: Set<number>,
): (OpenEnd & { selection: number; endpoint: number })[] {
  return scoped(() => {
    const chosen = new Set(sourceEdges.map(({ edge }) => shapeHash(edge)));
    const touches = new Map<number, { vertex: Shape; edge: Shape }[]>();
    for (const { edge } of sourceEdges) {
      for (const vertex of verticesOf(edge)) {
        const hash = shapeHash(vertex);
        touches.set(hash, [...(touches.get(hash) ?? []), { vertex, edge }]);
      }
    }
    const continued = new Set<number>();
    for (let c = 1; c <= op.NbContours(); c++) {
      for (let e = 1; e <= op.NbEdges(c); e++) {
        const edge = acquire(op.Edge(c, e));
        if (!chosen.has(shapeHash(edge))) {
          const vertices = verticesOf(edge);
          for (const vertex of vertices) continued.add(shapeHash(vertex));
        }
      }
    }
    const ends = [...touches]
      .filter(
        ([hash, list]) =>
          list.length === 1 && (continued.has(hash) || spilled.has(hash)),
      )
      .map(([, [only]]) => ({
        ...outward(only!.edge, only!.vertex),
        selection: sourceEdges.findIndex((source) =>
          source.edge.IsSame(only!.edge),
        ),
        endpoint: verticesOf(only!.edge).findIndex((vertex) =>
          vertex.IsSame(only!.vertex),
        ),
      }));
    return ends;
  });
}

export function spilledEnds(op: any): Set<number> {
  return scoped(() => {
    const touches = new Map<number, number>();
    const ends: { vertex: Shape; edge: Shape }[] = [];
    for (let c = 1; c <= op.NbContours(); c++) {
      if (!op.Closed(c))
        ends.push(
          { vertex: acquire(op.FirstVertex(c)), edge: acquire(op.Edge(c, 1)) },
          {
            vertex: acquire(op.LastVertex(c)),
            edge: acquire(op.Edge(c, op.NbEdges(c))),
          },
        );
      for (let e = 1; e <= op.NbEdges(c); e++) {
        const edge = acquire(op.Edge(c, e));
        const vertices = verticesOf(edge);
        for (const vertex of vertices) {
          const hash = shapeHash(vertex);
          touches.set(hash, (touches.get(hash) ?? 0) + 1);
        }
      }
    }
    const spilled = new Set<number>();
    for (const { vertex, edge } of ends) {
      const hash = shapeHash(vertex);
      if (touches.get(hash) !== 1) continue;
      const generated = listToArray(op.Generated(vertex));
      const end = generated.length > 0 ? outward(edge, vertex) : null;
      if (end && !generated.every((face) => capsEnd(face, end)))
        spilled.add(hash);
    }

    return spilled;
  });
}

export function openEnds(
  op: any,
  sourceEdges: { edge: Shape }[],
  spilled: Set<number>,
): OpenEnd[] {
  return contourEndReferences(op, sourceEdges, spilled).map(({ at, out }) => ({
    at,
    out,
  }));
}
