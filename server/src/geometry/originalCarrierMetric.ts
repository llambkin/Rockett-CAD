import assert from "node:assert/strict";
import { getKernel, type Shape, type Own } from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import type { Vec3 } from "@rockett/shared";

export function originalCarrierMetric(old: Shape, own: Own) {
  const k = getKernel();
  const curve = own(new k.BRepAdaptor_Curve_2(old));
  const kind = curve.GetType();
  let carrierDistance: (contact: Shape) => number;
  if (kind === k.GeomAbs_CurveType.GeomAbs_Line) {
    const point = own(new k.gp_Pnt_1()),
      direction = own(new k.gp_Vec_1());
    curve.D1(curve.FirstParameter(), point, direction);
    const p: Vec3 = [point.X(), point.Y(), point.Z()],
      d: Vec3 = [direction.X(), direction.Y(), direction.Z()];
    carrierDistance = (contact) => {
      const t =
        curve.FirstParameter() +
        V.dot(V.sub(vertexPoint(contact), p), d) / direction.SquareMagnitude();
      return own(curve.Value(t)).Distance(own(k.BRep_Tool.Pnt(contact)));
    };
  } else if (kind === k.GeomAbs_CurveType.GeomAbs_Circle) {
    const circle = own(curve.Circle()),
      centre = own(circle.Location()),
      axis = own(circle.Axis()),
      direction = own(axis.Direction());
    const origin: Vec3 = [centre.X(), centre.Y(), centre.Z()],
      normal: Vec3 = [direction.X(), direction.Y(), direction.Z()];
    carrierDistance = (contact) => {
      const offset = V.sub(vertexPoint(contact), origin),
        height = V.dot(offset, normal),
        radial = V.sub(offset, V.scale(normal, height));
      return Math.hypot(height, V.norm(radial) - circle.Radius());
    };
  } else {
    assert.equal(kind, k.GeomAbs_CurveType.GeomAbs_Ellipse);
    const point = own(new k.gp_Pnt_1()),
      first = own(new k.gp_Vec_1()),
      second = own(new k.gp_Vec_1());
    curve.D2(0, point, first, second);
    const major: Vec3 = [-second.X(), -second.Y(), -second.Z()],
      minor: Vec3 = [first.X(), first.Y(), first.Z()],
      origin: Vec3 = [
        point.X() + second.X(),
        point.Y() + second.Y(),
        point.Z() + second.Z(),
      ],
      majorRadius = V.norm(major),
      minorRadius = V.norm(minor),
      xx = V.scale(major, 1 / majorRadius),
      yy = V.scale(minor, 1 / minorRadius);
    carrierDistance = (contact) => {
      const at = vertexPoint(contact),
        offset = V.sub(at, origin);
      const parameter = Math.atan2(
        V.dot(offset, yy) / minorRadius,
        V.dot(offset, xx) / majorRadius,
      );
      const expected = V.add(
        origin,
        V.add(
          V.scale(xx, majorRadius * Math.cos(parameter)),
          V.scale(yy, minorRadius * Math.sin(parameter)),
        ),
      );
      return V.norm(V.sub(at, expected));
    };
  }

  return carrierDistance;
}
