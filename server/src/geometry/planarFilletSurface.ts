import type { Vec3 } from "@rockett/shared";
import type { FilletSection } from "./blendModule.js";
import { V } from "./frames.js";
import {
  bboxOf,
  dir,
  edges,
  getKernel,
  pnt,
  vertices,
  type Shape,
  type Own,
} from "./kernel.js";

function alignCapCurve(
  edge: Shape,
  direction: Vec3,
  radial: Vec3,
  radius: number,
  own: Own,
) {
  const k = getKernel();
  const curve = own(new k.BRepAdaptor_Curve_2(edge));
  if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Circle) return;
  const circle = own(curve.Circle());
  const frame = own(
    new k.gp_Ax2_2(
      own(circle.Location()),
      own(dir(...direction)),
      own(dir(...V.scale(V.cross(direction, radial), -1))),
    ),
  );
  const first = curve.FirstParameter() + Math.PI / 2;
  const last = curve.LastParameter() + Math.PI / 2;
  const make = own(
    new k.BRepBuilderAPI_MakeEdge_9(
      own(new k.gp_Circ_2(frame, radius)),
      first,
      last,
    ),
  );
  if (!make.IsDone())
    throw new Error("the fillet cap curve could not be built");
  const replacement = own(k.BRep_Tool.Curve_2(own(make.Edge()), 0, 0));
  const pcurve = own(new k.Handle_Geom2d_Curve_1());
  const surface = own(new k.Handle_Geom_Surface_1());
  k.BRep_Tool.CurveOnSurface_4(
    edge,
    pcurve,
    surface,
    own(new k.TopLoc_Location_1()),
    0,
    0,
    1,
  );
  if (pcurve.IsNull())
    throw new Error("the fillet cap curve has no surface parameterization");
  const ends = vertices(edge)
    .map(own)
    .map((vertex) => ({
      vertex,
      parameter: k.BRep_Tool.Parameter_2(vertex, edge) + Math.PI / 2,
    }));
  pcurve.get().Translate_1(own(new k.gp_Vec2d_4(-Math.PI / 2, 0)));
  const builder = own(new k.BRep_Builder());
  builder.UpdateEdge_1(edge, replacement, k.BRep_Tool.Tolerance_2(edge));
  builder.Range_1(edge, first, last, false);
  for (const { vertex, parameter } of ends)
    builder.UpdateVertex_2(
      vertex,
      parameter,
      edge,
      k.BRep_Tool.Tolerance_3(vertex),
    );
}

export function stripFrame(
  origin: Vec3,
  axis: Vec3,
  [a, b]: [Vec3, Vec3],
  own: Own,
) {
  const k = getKernel();
  const frame = own(
    new k.gp_Ax3_3(own(pnt(...origin)), own(dir(...axis)), own(dir(...a))),
  );
  const y = own(frame.YDirection());
  if (V.dot([y.X(), y.Y(), y.Z()], b) < 0) frame.YReverse();
  return frame;
}

export function boundsReach(
  bounds: ReturnType<typeof bboxOf>,
  origin: Vec3,
  axis: Vec3,
) {
  return Array.from({ length: 8 }, (_, mask) =>
    V.dot(
      V.sub(
        [
          mask & 1 ? bounds.max[0] : bounds.min[0],
          mask & 2 ? bounds.max[1] : bounds.min[1],
          mask & 4 ? bounds.max[2] : bounds.min[2],
        ],
        origin,
      ),
      axis,
    ),
  );
}

export function planarFilletSurface(
  sections: [FilletSection, FilletSection],
  axis: Vec3,
  radius: number,
  own: Own,
  bounds: ReturnType<typeof bboxOf>,
): { face: Shape; centre: Vec3; axis: Vec3 } {
  const k = getKernel();
  const centre = sections[0].centre;
  const a = V.normalize(V.sub(sections[0].contacts[0], centre));
  const b = V.normalize(V.sub(sections[0].contacts[1], centre));
  const direction = axis;
  const circleDirection = V.normalize(V.cross(a, b));
  const frame = stripFrame(centre, direction, [a, b], own);
  const span = boundsReach(bounds, centre, direction);
  const make = own(
    new k.BRepBuilderAPI_MakeFace_10(
      own(new k.gp_Cylinder_2(frame, radius)),
      0,
      Math.acos(V.dot(a, b)),
      Math.min(...span),
      Math.max(...span),
    ),
  );
  if (!make.IsDone())
    throw new Error("the planar fillet surface could not be built");
  const face = own(make.Face());
  if (!frame.Direct()) face.Reverse();
  for (const edge of edges(face).map(own))
    alignCapCurve(edge, circleDirection, a, radius, own);
  k.BRepLib.SameParameter_3(face, k.BRep_Tool.Tolerance_1(face), true);
  return { face, centre, axis: direction };
}
