import { UNIT_DOT_TOL } from "@rockett/shared";
import { getKernel, edges, vertices, type Shape, type Own } from "./kernel.js";
import { storedSurfaceCurve } from "./storedSurfaceCurve.js";
import type { GuidePatch } from "./filletEndCurves.js";
import type { FilletEnd } from "./filletBoundaries.js";
import type { mixedFilletHistory } from "./mixedFilletHistory.js";

function shareModuleCurve(edge: Shape, native: Shape, module: Shape, own: Own) {
  const k = getKernel(),
    a = own(own(new k.BRepAdaptor_Surface_2(native, true)).Cylinder()),
    b = own(own(new k.BRepAdaptor_Surface_2(module, true)).Cylinder()),
    fa = own(a.Position()),
    fb = own(b.Position()),
    tol = k.BRep_Tool.Tolerance_2(edge);
  if (
    own(fa.Location()).Distance(own(fb.Location())) > tol ||
    Math.abs(a.Radius() - b.Radius()) > tol ||
    fa.Direct() !== fb.Direct()
  )
    throw new Error(
      "the native terminal cylinder has a different module parameter frame",
    );
  for (const direction of ["Direction", "XDirection", "YDirection"])
    if (own(fa[direction]()).Dot(own(fb[direction]())) < 1 - UNIT_DOT_TOL)
      throw new Error(
        "the native terminal cylinder has a different module parameter direction",
      );
  const location = own(new k.TopLoc_Location_1()),
    surface = own(k.BRep_Tool.Surface_1(native, location)),
    targetLocation = own(new k.TopLoc_Location_1()),
    target = own(k.BRep_Tool.Surface_1(module, targetLocation)),
    { pc } = storedSurfaceCurve(edge, surface, location, own);
  if (!targetLocation.IsIdentity())
    throw new Error(
      "the module terminal parameter frame is not in world coordinates",
    );
  const builder = own(new k.BRep_Builder());
  builder.UpdateEdge_5(edge, pc, target, targetLocation, tol);
}
export function nativeOtherEnds(
  history: ReturnType<typeof mixedFilletHistory>,
  patches: GuidePatch[],
  indices: number[],
  own: Own,
): FilletEnd[] {
  const k = getKernel(),
    ends: FilletEnd[] = [];
  patches.forEach((patch, index) => {
    const oldVertices = vertices(patch.edge).map(own);
    for (const native of history.generated[indices[index]!]!)
      for (const edge of edges(native).map(own)) {
        const owners = [
          ...history.cells,
          ...history.source
            .filter((entry) =>
              oldVertices.some((vertex) =>
                nativeSourceEnd(entry.original, vertex, own),
              ),
            )
            .flatMap((entry) =>
              entry.faces.map((face) => ({ face, from: [entry.original] })),
            ),
        ].filter((cell) =>
          edges(cell.face)
            .map(own)
            .some((candidate) => candidate.IsSame(edge)),
        );
        if (!owners.length) continue;
        const candidates = oldVertices.filter((old) =>
          owners.some((owner) =>
            owner.from.some((source) =>
              source.ShapeType() === k.TopAbs_ShapeEnum.TopAbs_VERTEX
                ? source.IsSame(old)
                : vertices(source)
                    .map(own)
                    .some((vertex) => vertex.IsSame(old)),
            ),
          ),
        );
        if (candidates.length !== 1)
          throw new Error(
            "the native terminal has missing or duplicate original endpoint provenance",
          );
        shareModuleCurve(edge, native, patch.face, own);
        const old = candidates[0]!;
        let end = ends.find(
          (known) => known.index === index && known.old.IsSame(old),
        );
        if (!end) {
          end = { index, old, boundary: [] };
          ends.push(end);
        }
        if (end.boundary.some((part) => part.edge.IsSame(edge)))
          throw new Error("the native terminal boundary is duplicated");
        end.boundary.push({ edge, source: null });
      }
  });
  return ends;
}

export function nativeSourceEnd(face: Shape, vertex: Shape, own: Own) {
  return edges(face)
    .map(own)
    .some(
      (boundary) =>
        getKernel().BRep_Tool.Degenerated(boundary) &&
        vertices(boundary)
          .map(own)
          .some((endpoint) => endpoint.IsSame(vertex)),
    );
}
