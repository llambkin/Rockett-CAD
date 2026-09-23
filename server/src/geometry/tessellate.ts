/**
 * B-Rep → viewport tessellation.
 *
 * The triangle mesh is a *visualisation* of the CAD model. Every face's
 * triangles are grouped and tagged with the face's persistent name, and every
 * edge is emitted as a polyline tagged with its persistent name, so the
 * client can do CAD-topology selection (body/face/edge/vertex) on the mesh.
 */

import { createHash } from "node:crypto";
import type {
  BodyPayload,
  EdgeInfo,
  FaceInfo,
  VertexInfo,
  Vec3,
} from "@rockett/shared";
import {
  bboxOf,
  getKernel,
  lengthOf,
  release,
  scoped,
  shapeHash,
  type Shape,
} from "./kernel.js";
import { meshShape } from "./mesh.js";
import {
  computeEdgeNames,
  computeVertexNames,
  type NamedBody,
} from "./naming.js";

export interface TessellationOptions {
  /** Linear deflection in mm. */
  linear?: number;
  /** Angular deflection in radians. */
  angular?: number;
}

export function tessellateBody(
  body: NamedBody,
  meta: { name: string; visible: boolean },
  opts: TessellationOptions = {},
): BodyPayload {
  const k = getKernel();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceInfos: FaceInfo[] = [];
  const bbox = bboxOf(body.shape);

  const meshes = meshShape(body.shape, {
    linear: opts.linear ?? viewportDeflection(bbox),
    angular: opts.angular ?? 0.35,
  });
  try {
    for (const m of meshes) {
      const start = indices.length;
      const vertexOffset = positions.length / 3;
      for (let i = 0; i < m.positions.length; i++) {
        positions.push(m.positions[i]!);
        normals.push(m.normals[i]!);
      }

      const P = m.positions;
      let area = 0;
      for (let i = 0; i < m.indices.length; i += 3) {
        const a = m.indices[i]! * 3,
          b = m.indices[i + 1]! * 3,
          c = m.indices[i + 2]! * 3;
        indices.push(
          vertexOffset + m.indices[i]!,
          vertexOffset + m.indices[i + 1]!,
          vertexOffset + m.indices[i + 2]!,
        );
        const ux = P[b]! - P[a]!,
          uy = P[b + 1]! - P[a + 1]!,
          uz = P[b + 2]! - P[a + 2]!;
        const vx = P[c]! - P[a]!,
          vy = P[c + 1]! - P[a + 1]!,
          vz = P[c + 2]! - P[a + 2]!;
        area +=
          Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) /
          2;
      }

      faceInfos.push({
        name: body.names.get(shapeHash(m.face)) ?? "?",
        start,
        count: indices.length - start,
        surface: surfaceInfo(m.face),
        area,
      });
    }
  } finally {
    release(meshes.map((m) => m.face));
  }

  const edgeNames = computeEdgeNames(body).byName;
  const edgeInfos: EdgeInfo[] = [];
  try {
    for (const [name, edge] of edgeNames) {
      const polyline = sampleEdge(edge);
      if (polyline.length < 6) continue;
      edgeInfos.push({
        name,
        polyline,
        length: lengthOf(edge),
        curve: curveInfo(edge),
      });
    }
  } finally {
    release(edgeNames.values());
  }

  const vertexNames = computeVertexNames(body).byName;
  const vertexInfos: VertexInfo[] = [];
  try {
    for (const [name, vertex] of vertexNames) {
      const p = k.BRep_Tool.Pnt(vertex);
      vertexInfos.push({ name, position: [p.X(), p.Y(), p.Z()] });
      p.delete();
    }
  } finally {
    release(vertexNames.values());
  }

  const mesh = {
    positions,
    normals,
    indices,
    faces: faceInfos,
    edges: edgeInfos,
    vertices: vertexInfos,
    bbox,
  };
  return {
    bodyId: body.bodyId,
    name: meta.name,
    visible: meta.visible,
    meshKey: createHash("sha256").update(JSON.stringify(mesh)).digest("hex"),
    ...mesh,
  };
}

function viewportDeflection({ min, max }: ReturnType<typeof bboxOf>): number {
  const diagonal = Math.hypot(
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  );
  return Math.min(0.5, Math.max(0.005, 0.0005 * diagonal));
}

function surfaceInfo(face: Shape): FaceInfo["surface"] {
  const k = getKernel();
  try {
    return scoped((own): FaceInfo["surface"] => {
      const surf = own(new k.BRepAdaptor_Surface_2(face, false));
      const type = surf.GetType();
      if (type === k.GeomAbs_SurfaceType.GeomAbs_Plane) {
        const pln = own(surf.Plane());
        const locP = own(pln.Location());
        const d = own(own(pln.Axis()).Direction());
        const reversed =
          face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED;
        const sgn = reversed ? -1 : 1;
        return {
          type: "plane",
          origin: [locP.X(), locP.Y(), locP.Z()] as Vec3,
          normal: [sgn * d.X(), sgn * d.Y(), sgn * d.Z()] as Vec3,
        };
      }
      if (type === k.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        const cyl = own(surf.Cylinder());
        const locP = own(cyl.Location());
        const d = own(own(cyl.Axis()).Direction());
        return {
          type: "cylinder",
          origin: [locP.X(), locP.Y(), locP.Z()] as Vec3,
          axis: [d.X(), d.Y(), d.Z()] as Vec3,
          radius: cyl.Radius(),
        };
      }
      return { type: "other" };
    });
  } catch {
    return { type: "other" };
  }
}

export function curveInfo(edge: Shape): EdgeInfo["curve"] {
  const k = getKernel();
  try {
    return scoped((own): EdgeInfo["curve"] => {
      const curve = own(new k.BRepAdaptor_Curve_2(edge));
      const type = curve.GetType();
      if (type === k.GeomAbs_CurveType.GeomAbs_Line) {
        const p1 = own(curve.Value(curve.FirstParameter()));
        const p2 = own(curve.Value(curve.LastParameter()));
        return {
          type: "line",
          a: [p1.X(), p1.Y(), p1.Z()] as Vec3,
          b: [p2.X(), p2.Y(), p2.Z()] as Vec3,
        };
      }
      if (type === k.GeomAbs_CurveType.GeomAbs_Circle) {
        const circ = own(curve.Circle());
        const c = own(circ.Location());
        const d = own(own(circ.Axis()).Direction());
        const start = own(curve.Value(curve.FirstParameter()));
        const end = own(curve.Value(curve.LastParameter()));
        return {
          type: "circle",
          center: [c.X(), c.Y(), c.Z()] as Vec3,
          axis: [d.X(), d.Y(), d.Z()] as Vec3,
          radius: circ.Radius(),
          start: [start.X(), start.Y(), start.Z()],
          end: [end.X(), end.Y(), end.Z()],
          sweep: curve.LastParameter() - curve.FirstParameter(),
        };
      }
      return { type: "other" };
    });
  } catch {
    return { type: "other" };
  }
}

function sampleEdge(edge: Shape): number[] {
  const k = getKernel();
  const out: number[] = [];
  try {
    const curve = new k.BRepAdaptor_Curve_2(edge);
    const first = curve.FirstParameter();
    const last = curve.LastParameter();
    const type = curve.GetType();
    let samples = 32;
    if (type === k.GeomAbs_CurveType.GeomAbs_Line) samples = 1;
    else if (type === k.GeomAbs_CurveType.GeomAbs_Circle) {
      const span = Math.abs(last - first);
      samples = Math.max(8, Math.ceil((span / (Math.PI * 2)) * 64));
    }
    for (let i = 0; i <= samples; i++) {
      const t = first + ((last - first) * i) / samples;
      const p = curve.Value(t);
      out.push(p.X(), p.Y(), p.Z());
      p.delete();
    }
    curve.delete();
  } catch {
    return [];
  }
  return out;
}
