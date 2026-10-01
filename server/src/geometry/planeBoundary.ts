import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import { V } from "./frames.js";
import {
  bboxOf,
  edges,
  planarFacePlane,
  getKernel,
  pnt,
  vec,
  type Shape,
  type Own,
} from "./kernel.js";

export function planeBoundarySample(edge: Shape, normal: Vec3, own: Own) {
  const k = getKernel();
  const curve = own(new k.BRepAdaptor_Curve_2(edge));
  const point = own(pnt(0, 0, 0));
  const derivative = own(vec(0, 0, 0));
  curve.D1(
    (curve.FirstParameter() + curve.LastParameter()) / 2,
    point,
    derivative,
  );
  const sign =
    edge.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
  const tangent: Vec3 = [
    sign * derivative.X(),
    sign * derivative.Y(),
    sign * derivative.Z(),
  ];
  return { point, into: V.normalize(V.cross(normal, tangent)) };
}

const NATIVE_STEP = 1e-4;
export function planarInteriorPoints(face: Shape, own: Own): Shape[] {
  const k = getKernel();
  const plane = planarFacePlane(face);
  if (!plane) return [];
  const points: Shape[] = [];
  const box = bboxOf(face);
  const limit = V.norm(V.sub(box.max, box.min));
  const faceTolerance = k.BRep_Tool.Tolerance_1(face);
  for (const edge of edges(face).map(own)) {
    const { point, into } = planeBoundarySample(edge, plane.normal, own);
    const edgeTolerance = k.BRep_Tool.Tolerance_2(edge);
    const sum = edgeTolerance + faceTolerance;
    const adjustment =
      Math.max(edgeTolerance, faceTolerance) > NATIVE_STEP / 10 ? sum : 0;
    let step = Math.max(NATIVE_STEP, 2 * sum) + adjustment;
    let interior: Shape | null = null;
    while (step <= limit) {
      const candidate = own(
        pnt(
          point.X() + step * into[0],
          point.Y() + step * into[1],
          point.Z() + step * into[2],
        ),
      );
      const classifier = own(
        new k.BRepClass_FaceClassifier_4(
          face,
          candidate,
          LINEAR_TOL,
          false,
          0.1,
        ),
      );
      if (classifier.State() !== k.TopAbs_State.TopAbs_IN) break;
      interior = candidate;
      step *= 2;
    }
    if (interior) points.push(interior);
  }
  return points;
}
