import { getKernel, type Shape, type Own } from "./kernel.js";

export function storedSurfaceCurve(
  edge: Shape,
  expected: Shape,
  expectedLocation: Shape,
  own: Own,
) {
  const k = getKernel();
  for (let index = 1; ; index++) {
    const pc = own(new k.Handle_Geom2d_Curve_1()),
      surface = own(new k.Handle_Geom_Surface_1()),
      location = own(new k.TopLoc_Location_1());
    k.BRep_Tool.CurveOnSurface_4(edge, pc, surface, location, 0, 0, index);
    if (surface.IsNull())
      throw new Error("the boundary has no stored surface curve in this frame");
    if (
      !surface.get().isAliasOf(expected.get()) ||
      !location.IsEqual(expectedLocation)
    )
      continue;
    if (pc.IsNull())
      throw new Error("the boundary has no stored parameter curve");
    return { pc, surface, location };
  }
}
