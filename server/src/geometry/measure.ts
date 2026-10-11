/**
 * Measurement: distances/angles between persistent topology references.
 */

import {
  ValidationError,
  type MeasureRequest,
  type MeasureResult,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  scoped,
  areaOf,
  faces,
  getKernel,
  lengthOf,
  progress,
  volumeOf,
  type Shape,
} from "./kernel.js";
import {
  computeEdgeNames,
  computeVertexNames,
  type NamedBody,
} from "./naming.js";
import type { EvalState } from "./features.js";

interface Resolved {
  kind: string;
  shape: Shape;
  info: MeasureResult["items"][number];
}

type Ref = MeasureRequest["refs"][number];

const refKey = (r: Ref) =>
  [
    r.kind,
    r.bodyId,
    r.kind === "body"
      ? ""
      : r.kind === "face"
        ? r.faceName
        : r.kind === "edge"
          ? r.edgeName
          : r.vertexName,
  ].join("\0");

function faceIndex(body: NamedBody): Map<string, Shape> {
  const index = new Map<string, Shape>();
  for (const face of faces(body.shape)) {
    const name = body.names.get(face);
    if (name !== undefined && !index.has(name)) index.set(name, face);
  }
  return index;
}

function resolveRef(
  state: EvalState,
  ref: Ref,
  facesOf: (body: NamedBody) => Map<string, Shape>,
): Resolved {
  const k = getKernel();
  const body = state.bodies.get(ref.bodyId);
  if (!body) throw new ValidationError(`body ${ref.bodyId} not found`);
  if (ref.kind === "body")
    return {
      kind: "body",
      shape: body.shape,
      info: { kind: "body", volume: volumeOf(body.shape) },
    };
  if (ref.kind === "face") {
    const face = facesOf(body).get(ref.faceName);
    if (!face) throw new ValidationError(`face ${ref.faceName} not found`);
    const info: Resolved["info"] = { kind: "face", area: areaOf(face) };
    const surf = acquire(new k.BRepAdaptor_Surface_2(face, false));
    if (surf.GetType() === k.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      const cyl = acquire(surf.Cylinder());
      info.radius = cyl.Radius();
      info.diameter = cyl.Radius() * 2;
    }

    return { kind: "face", shape: face, info };
  }
  if (ref.kind === "edge") {
    const names = computeEdgeNames(body);
    const edge = names.byName.get(ref.edgeName);
    if (!edge) throw new ValidationError(`edge ${ref.edgeName} not found`);
    const info: Resolved["info"] = { kind: "edge", length: lengthOf(edge) };
    const curve = acquire(new k.BRepAdaptor_Curve_2(edge));
    if (curve.GetType() === k.GeomAbs_CurveType.GeomAbs_Circle) {
      const circ = acquire(curve.Circle());
      info.radius = circ.Radius();
      info.diameter = circ.Radius() * 2;
    }

    return { kind: "edge", shape: edge, info };
  }
  const names = computeVertexNames(body);
  const vertex = names.byName.get(ref.vertexName);
  if (!vertex) throw new ValidationError(`vertex ${ref.vertexName} not found`);
  const p = acquire(k.BRep_Tool.Pnt(vertex));
  const position: Vec3 = [p.X(), p.Y(), p.Z()];

  return {
    kind: "vertex",
    shape: vertex,
    info: { kind: "vertex", position },
  };
}

function faceNormal(state: EvalState, shape: Shape): Vec3 | null {
  const k = getKernel();
  const surf = acquire(new k.BRepAdaptor_Surface_2(shape, false));
  if (surf.GetType() !== k.GeomAbs_SurfaceType.GeomAbs_Plane) {
    return null;
  }
  const pln = acquire(surf.Plane());
  const d = acquire(acquire(pln.Axis()).Direction());
  const out: Vec3 = [d.X(), d.Y(), d.Z()];

  return out;
}

function edgeDirection(shape: Shape): Vec3 | null {
  const k = getKernel();
  const curve = acquire(new k.BRepAdaptor_Curve_2(shape));
  if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Line) {
    return null;
  }
  const p1 = acquire(curve.Value(curve.FirstParameter()));
  const p2 = acquire(curve.Value(curve.LastParameter()));
  const v: Vec3 = [p2.X() - p1.X(), p2.Y() - p1.Y(), p2.Z() - p1.Z()];
  const n = Math.hypot(...v) || 1;

  return [v[0] / n, v[1] / n, v[2] / n];
}

export function measure(state: EvalState, req: MeasureRequest): MeasureResult {
  return scoped(() => {
    const k = getKernel();
    if (
      req.refs.length > 2 &&
      req.refs.some((r) => r.kind === "edge" || r.kind === "vertex")
    )
      throw new ValidationError("edge and vertex refs need at most 2 refs");
    const indexes = new Map<string, Map<string, Shape>>();
    const facesOf = (body: NamedBody) => {
      let index = indexes.get(body.bodyId);
      if (!index) indexes.set(body.bodyId, (index = faceIndex(body)));
      return index;
    };
    const memo = new Map<string, Resolved>();
    const resolved = req.refs.map((r) => {
      const key = refKey(r);
      let found = memo.get(key);
      if (!found) memo.set(key, (found = resolveRef(state, r, facesOf)));
      return found;
    });
    const result: MeasureResult = { items: resolved.map((r) => r.info) };

    if (resolved.length === 2) {
      const dist = acquire(
        new k.BRepExtrema_DistShapeShape_2(
          resolved[0]!.shape,
          resolved[1]!.shape,
          k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
          k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
          progress(),
        ),
      );
      dist.Perform(progress());
      if (dist.IsDone() && dist.NbSolution() > 0) {
        result.distance = dist.Value();
        const p1 = acquire(dist.PointOnShape1(1));
        const p2 = acquire(dist.PointOnShape2(1));
        result.deltaX = Math.abs(p2.X() - p1.X());
        result.deltaY = Math.abs(p2.Y() - p1.Y());
        result.deltaZ = Math.abs(p2.Z() - p1.Z());
      }

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
  });
}
