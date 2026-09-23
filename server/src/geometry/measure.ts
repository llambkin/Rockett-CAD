/**
 * Measurement: distances/angles between persistent topology references.
 */

import type { MeasureRequest, MeasureResult, Vec3 } from "@rockett/shared";
import { areaOf, getKernel, lengthOf, progress, type Shape } from "./kernel.js";
import { computeEdgeNames, computeVertexNames, findFace } from "./naming.js";
import type { EvalState } from "./features.js";

interface Resolved {
  kind: string;
  shape: Shape;
  info: MeasureResult["items"][number];
}

function resolveRef(
  state: EvalState,
  ref: MeasureRequest["refs"][number],
): Resolved {
  const k = getKernel();
  const body = state.bodies.get(ref.bodyId);
  if (!body) throw new Error(`body ${ref.bodyId} not found`);
  if (ref.kind === "face") {
    const face = findFace(body, ref.faceName);
    if (!face) throw new Error(`face ${ref.faceName} not found`);
    const info: Resolved["info"] = { kind: "face", area: areaOf(face) };
    const surf = new k.BRepAdaptor_Surface_2(face, false);
    if (surf.GetType() === k.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      const cyl = surf.Cylinder();
      info.radius = cyl.Radius();
      info.diameter = cyl.Radius() * 2;
    }
    surf.delete();
    return { kind: "face", shape: face, info };
  }
  if (ref.kind === "edge") {
    const names = computeEdgeNames(body);
    const edge = names.byName.get(ref.edgeName);
    if (!edge) throw new Error(`edge ${ref.edgeName} not found`);
    const info: Resolved["info"] = { kind: "edge", length: lengthOf(edge) };
    const curve = new k.BRepAdaptor_Curve_2(edge);
    if (curve.GetType() === k.GeomAbs_CurveType.GeomAbs_Circle) {
      const circ = curve.Circle();
      info.radius = circ.Radius();
      info.diameter = circ.Radius() * 2;
    }
    curve.delete();
    return { kind: "edge", shape: edge, info };
  }
  const names = computeVertexNames(body);
  const vertex = names.byName.get(ref.vertexName);
  if (!vertex) throw new Error(`vertex ${ref.vertexName} not found`);
  const p = k.BRep_Tool.Pnt(vertex);
  const position: Vec3 = [p.X(), p.Y(), p.Z()];
  p.delete();
  return {
    kind: "vertex",
    shape: vertex,
    info: { kind: "vertex", position },
  };
}

function faceNormal(state: EvalState, shape: Shape): Vec3 | null {
  const k = getKernel();
  const surf = new k.BRepAdaptor_Surface_2(shape, false);
  if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Plane) {
    surf.delete();
    return null;
  }
  const pln = surf.Plane();
  const d = pln.Axis().Direction();
  const out: Vec3 = [d.X(), d.Y(), d.Z()];
  surf.delete();
  return out;
}

function edgeDirection(shape: Shape): Vec3 | null {
  const k = getKernel();
  const curve = new k.BRepAdaptor_Curve_2(shape);
  if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Line) {
    curve.delete();
    return null;
  }
  const p1 = curve.Value(curve.FirstParameter());
  const p2 = curve.Value(curve.LastParameter());
  const v: Vec3 = [p2.X() - p1.X(), p2.Y() - p1.Y(), p2.Z() - p1.Z()];
  const n = Math.hypot(...v) || 1;
  p1.delete();
  p2.delete();
  curve.delete();
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function measure(state: EvalState, req: MeasureRequest): MeasureResult {
  const k = getKernel();
  const resolved = req.refs.slice(0, 2).map((r) => resolveRef(state, r));
  const result: MeasureResult = { items: resolved.map((r) => r.info) };

  if (resolved.length === 2) {
    const dist = new k.BRepExtrema_DistShapeShape_2(
      resolved[0]!.shape,
      resolved[1]!.shape,
      k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
      k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
      progress(),
    );
    dist.Perform(progress());
    if (dist.IsDone() && dist.NbSolution() > 0) {
      result.distance = dist.Value();
      const p1 = dist.PointOnShape1(1);
      const p2 = dist.PointOnShape2(1);
      result.deltaX = Math.abs(p2.X() - p1.X());
      result.deltaY = Math.abs(p2.Y() - p1.Y());
      result.deltaZ = Math.abs(p2.Z() - p1.Z());
      p1.delete();
      p2.delete();
    }
    dist.delete();

    // angle between two planar faces / linear edges
    const dirOf = (r: Resolved): Vec3 | null =>
      r.kind === "face"
        ? faceNormal(state, r.shape)
        : r.kind === "edge"
          ? edgeDirection(r.shape)
          : null;
    const dirA = dirOf(resolved[0]!);
    const dirB = dirOf(resolved[1]!);
    if (dirA && dirB) {
      const dot = Math.abs(
        dirA[0] * dirB[0] + dirA[1] * dirB[1] + dirA[2] * dirB[2],
      );
      result.angleDeg = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    }
  }
  return result;
}
