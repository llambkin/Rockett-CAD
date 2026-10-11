import assert from "node:assert/strict";
import { getKernel, vertices, type Shape, type Own } from "./kernel.js";
import { storedSurfaceCurve } from "./storedSurfaceCurve.js";

export function nativeBoundaryCurves(own: Own) {
  const k = getKernel();
  const beginning = (e: Shape) => own(k.TopExp.FirstVertex(e, true));
  const ending = (e: Shape) => own(k.TopExp.LastVertex(e, true));
  const orient = (e: Shape, start: Shape) => {
    const edge = own(k.TopoDS.Edge_1(e));
    edge.Orientation_2(k.TopAbs_Orientation.TopAbs_FORWARD);
    if (!beginning(edge).IsSame(start))
      edge.Orientation_2(k.TopAbs_Orientation.TopAbs_REVERSED);
    assert(beginning(edge).IsSame(start));
    return edge;
  };
  const builder = own(new k.BRep_Builder());
  const transfer = (old: Shape, edge: Shape, face: Shape) => {
    const location = own(new k.TopLoc_Location_1()),
      surface = own(k.BRep_Tool.Surface_1(face, location));
    const { pc } = storedSurfaceCurve(old, surface, location, own);
    builder.UpdateEdge_5(
      edge,
      pc,
      surface,
      location,
      k.BRep_Tool.Tolerance_2(edge),
    );
  };
  const carrierEdge = (old: Shape, start: Shape, end: Shape) => {
    const handle = own(k.BRep_Tool.Curve_2(old, 0, 0));
    const reversed =
      old.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED;
    const make = own(
      new k.BRepBuilderAPI_MakeEdge_27(
        handle,
        reversed ? end : start,
        reversed ? start : end,
      ),
    );
    assert(make.IsDone());
    const edge = own(make.Edge());
    assert(
      vertices(edge)
        .map(own)
        .some((v) => v.IsSame(start)),
    );
    assert(
      vertices(edge)
        .map(own)
        .some((v) => v.IsSame(end)),
    );
    return orient(edge, start);
  };
  return { beginning, ending, orient, transfer, carrierEdge };
}
