import { LINEAR_TOL, UNIT_DOT_TOL, type Vec3 } from "@rockett/shared";
import type { ChamferSide } from "./blendModule.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import {
  edges,
  getKernel,
  planarFacePlane,
  progress,
  vertices,
  type Own,
  type Shape,
} from "./kernel.js";
import { nativeBoundaryCurves } from "./nativeBoundaryCurves.js";
import { originalCarrierMetric } from "./originalCarrierMetric.js";
import { planeBoundarySample } from "./planeBoundary.js";

export type PlanarSide = ChamferSide & { face: Shape };

export function section(a: Shape, b: Shape, own: Own) {
  const k = getKernel(),
    operation = own(new k.BRepAlgoAPI_Section_3(a, b, false));
  operation.Approximation(true);
  operation.ComputePCurveOn1(true);
  operation.ComputePCurveOn2(true);
  operation.SetNonDestructive(true);
  operation.Build(progress());
  if (!operation.IsDone())
    throw new Error("the fillet end curves could not be built");
  return edges(own(operation.Shape())).map(own);
}

export function sectionCarrier(
  a: Shape,
  b: Shape,
  through: [Shape, Shape],
  own: Own,
) {
  const k = getKernel(),
    curves = nativeBoundaryCurves(own);
  const found = section(a, b, own).filter((edge) => {
    const distance = originalCarrierMetric(edge, own);
    return through.every(
      (vertex) =>
        distance(vertex) <=
        k.BRep_Tool.Tolerance_2(edge) + k.BRep_Tool.Tolerance_3(vertex),
    );
  });
  if (found.length !== 1)
    throw new Error("the chamfer contact has no single curved carrier");
  const edge = curves.orient(found[0]!, curves.beginning(found[0]!));
  const along = V.dot(
    V.sub(
      vertexPoint(curves.ending(edge)),
      vertexPoint(curves.beginning(edge)),
    ),
    V.sub(vertexPoint(through[1]), vertexPoint(through[0])),
  );
  return along > 0 ? edge : curves.orient(edge, curves.ending(edge));
}

export function cylinderOf(face: Shape, own: Own) {
  const k = getKernel(),
    domain = own(new k.BRepAdaptor_Surface_2(face, false));
  if (domain.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Cylinder) return null;
  const cylinder = own(domain.Cylinder());
  return {
    ...revolutionFrame(face, own(cylinder.Position()), own),
    radius: cylinder.Radius(),
  };
}

function revolutionFrame(face: Shape, position: any, own: Own) {
  const k = getKernel(),
    centre = own(position.Location()),
    direction = own(position.Direction());
  return {
    origin: [centre.X(), centre.Y(), centre.Z()] as Vec3,
    axis: [direction.X(), direction.Y(), direction.Z()] as Vec3,
    outward:
      (face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1) *
      (position.Direct() ? 1 : -1),
  };
}

export function radial(cylinder: { origin: Vec3; axis: Vec3 }, point: Vec3) {
  const offset = V.sub(point, cylinder.origin);
  return V.sub(offset, V.scale(cylinder.axis, V.dot(offset, cylinder.axis)));
}

export function surfaceGap(face: Shape, own: Own) {
  const plane = planarFacePlane(face);
  if (plane)
    return (point: Vec3) =>
      Math.abs(V.dot(V.sub(point, plane.origin), plane.normal));
  const cylinder = cylinderOf(face, own);
  if (!cylinder)
    throw new Error("the blend neighbour is neither a plane nor a cylinder");
  return (point: Vec3) =>
    Math.abs(V.norm(radial(cylinder, point)) - cylinder.radius);
}

function cylinderSide(face: Shape, ends: Vec3[], own: Own) {
  const cylinder = cylinderOf(face, own);
  if (
    !cylinder ||
    1 - Math.abs(V.dot(cylinder.axis, V.normalize(V.sub(ends[1]!, ends[0]!)))) >
      UNIT_DOT_TOL
  )
    return null;
  return {
    normal: V.scale(V.normalize(radial(cylinder, ends[0]!)), cylinder.outward),
    radius: cylinder.outward * cylinder.radius,
  };
}

function curveSides(
  edge: Shape,
  original: Shape[],
  own: Own,
  sideOf: (face: Shape) => { normal: Vec3; radius: number } | null,
  type = getKernel().GeomAbs_CurveType.GeomAbs_Line,
): PlanarSide[] | null {
  const k = getKernel();
  const guide = own(new k.BRepAdaptor_Curve_2(edge));
  if (guide.GetType() !== type) return null;
  const neighboring = original.flatMap((face) => {
    const occurrence = edges(face)
      .map(own)
      .find((e) => e.IsSame(edge));
    return occurrence ? [{ face, occurrence }] : [];
  });
  if (neighboring.length !== 2) return null;
  const sides: PlanarSide[] = [];
  for (const { face, occurrence } of neighboring) {
    const side = sideOf(face);
    if (!side) return null;
    sides.push({
      face,
      ...side,
      into: planeBoundarySample(occurrence, side.normal, own).into,
    });
  }
  return sides.every((side) => side.radius) ? null : sides;
}

function planeSide(face: Shape) {
  const plane = planarFacePlane(face);
  return plane && { normal: plane.normal, radius: 0 };
}

export function planeSides(edge: Shape, original: Shape[], own: Own) {
  return curveSides(edge, original, own, planeSide);
}

export function chamferSides(edge: Shape, original: Shape[], own: Own) {
  const ends = vertices(edge).map(own).map(vertexPoint);
  return curveSides(
    edge,
    original,
    own,
    (face) => planeSide(face) ?? cylinderSide(face, ends, own),
  );
}

function guideCircle(edge: Shape, own: Own) {
  const k = getKernel(),
    guide = own(new k.BRepAdaptor_Curve_2(edge)),
    circle = own(guide.Circle()),
    axis = own(own(circle.Axis()).Direction()),
    centre = own(circle.Location()),
    mid = own(
      guide.EvalD0((guide.FirstParameter() + guide.LastParameter()) / 2),
    );
  return {
    axis: [axis.X(), axis.Y(), axis.Z()] as Vec3,
    centre: [centre.X(), centre.Y(), centre.Z()] as Vec3,
    radius: circle.Radius(),
    mid: [mid.X(), mid.Y(), mid.Z()] as Vec3,
  };
}

function aboutAxis(
  circle: ReturnType<typeof guideCircle>,
  frame: { origin: Vec3; axis: Vec3 },
) {
  return (
    1 - Math.abs(V.dot(circle.axis, frame.axis)) <= UNIT_DOT_TOL &&
    V.norm(radial(frame, circle.centre)) <= LINEAR_TOL
  );
}

function circleSide(face: Shape, edge: Shape, own: Own) {
  const cylinder = cylinderOf(face, own);
  if (!cylinder) return null;
  const circle = guideCircle(edge, own);
  if (
    !aboutAxis(circle, cylinder) ||
    Math.abs(circle.radius - cylinder.radius) > LINEAR_TOL
  )
    return null;
  return {
    normal: V.scale(
      V.normalize(radial(cylinder, circle.mid)),
      cylinder.outward,
    ),
    radius: cylinder.outward * cylinder.radius,
  };
}

function coneSide(face: Shape, edge: Shape, own: Own) {
  const k = getKernel(),
    domain = own(new k.BRepAdaptor_Surface_2(face, false));
  if (domain.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Cone) return null;
  const cone = own(domain.Cone()),
    frame = revolutionFrame(face, own(cone.Position()), own),
    circle = guideCircle(edge, own);
  if (!aboutAxis(circle, frame)) return null;
  const angle = cone.SemiAngle();
  return {
    normal: V.scale(
      V.sub(
        V.scale(V.normalize(radial(frame, circle.mid)), Math.cos(angle)),
        V.scale(frame.axis, Math.sin(angle)),
      ),
      frame.outward,
    ),
    radius: 0,
  };
}

export function circleSides(edge: Shape, original: Shape[], own: Own) {
  const sides = curveSides(
    edge,
    original,
    own,
    (face) =>
      planeSide(face) ??
      circleSide(face, edge, own) ??
      coneSide(face, edge, own),
    getKernel().GeomAbs_CurveType.GeomAbs_Circle,
  );
  return sides?.some((side) => side.radius) ? sides : null;
}

export function torusSides(edge: Shape, original: Shape[], own: Own) {
  return vertices(edge).map(own).length === 1
    ? circleSides(edge, original, own)
    : null;
}

function ellipseSide(face: Shape, edge: Shape, own: Own) {
  const k = getKernel(),
    cylinder = cylinderOf(face, own);
  if (!cylinder) return null;
  const guide = own(new k.BRepAdaptor_Curve_2(edge)),
    ellipse = own(guide.Ellipse()),
    centre = own(ellipse.Location()),
    minor = own(own(ellipse.YAxis()).Direction()),
    mid = own(
      guide.EvalD0((guide.FirstParameter() + guide.LastParameter()) / 2),
    );
  if (
    V.norm(radial(cylinder, [centre.X(), centre.Y(), centre.Z()])) >
      LINEAR_TOL ||
    Math.abs(ellipse.MinorRadius() - cylinder.radius) > LINEAR_TOL ||
    Math.abs(V.dot([minor.X(), minor.Y(), minor.Z()], cylinder.axis)) >
      UNIT_DOT_TOL
  )
    return null;
  return {
    normal: V.scale(
      V.normalize(radial(cylinder, [mid.X(), mid.Y(), mid.Z()])),
      cylinder.outward,
    ),
    radius: cylinder.outward * cylinder.radius,
  };
}

export function ellipseSides(edge: Shape, original: Shape[], own: Own) {
  if (vertices(edge).map(own).length !== 1) return null;
  const sides = curveSides(
    edge,
    original,
    own,
    (face) => planeSide(face) ?? ellipseSide(face, edge, own),
    getKernel().GeomAbs_CurveType.GeomAbs_Ellipse,
  );
  return sides?.some((side) => side.radius) ? sides : null;
}
