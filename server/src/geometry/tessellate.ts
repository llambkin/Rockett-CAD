/**
 * B-Rep → viewport tessellation.
 *
 * The triangle mesh is a *visualisation* of the CAD model. Every face's
 * triangles are grouped and tagged with the face's persistent name, and every
 * edge is emitted as a polyline tagged with its persistent name, so the
 * client can do CAD-topology selection (body/face/edge/vertex) on the mesh.
 */

import type { BodyPayload, EdgeInfo, FaceInfo, VertexInfo, Vec3 } from "@rockett/shared";
import {
  bboxOf,
  getKernel,
  lengthOf,
  shapeHash,
  faces as facesOf,
  type Shape,
} from "./kernel.js";
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
  opts: TessellationOptions = {}
): BodyPayload {
  const k = getKernel();
  const linear = opts.linear ?? 0.08;
  const angular = opts.angular ?? 0.35;

  // (Re)mesh. IncrementalMesh caches on the shape; calling again with the
  // same parameters is cheap.
  const mesh = new k.BRepMesh_IncrementalMesh_2(
    body.shape,
    linear,
    false,
    angular,
    false
  );
  mesh.delete();

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceInfos: FaceInfo[] = [];

  const reversedEnum = k.TopAbs_Orientation.TopAbs_REVERSED;

  for (const face of facesOf(body.shape)) {
    const name = body.names.get(shapeHash(face)) ?? "?";
    const loc = new k.TopLoc_Location_1();
    const triHandle = k.BRep_Tool.Triangulation(face, loc, 0);
    if (triHandle.IsNull()) {
      loc.delete();
      triHandle.delete();
      continue;
    }
    const tri = triHandle.get();
    const trsf = loc.Transformation();
    const reversed = face.Orientation_1() === reversedEnum;

    const start = indices.length;
    const vertexOffset = positions.length / 3;

    tri.ComputeNormals();

    const nbNodes = tri.NbNodes();
    for (let i = 1; i <= nbNodes; i++) {
      const p = tri.Node(i).Transformed(trsf);
      positions.push(p.X(), p.Y(), p.Z());
      p.delete();
      const d = tri.Normal_1(i).Transformed(trsf);
      const sgn = reversed ? -1 : 1;
      normals.push(sgn * d.X(), sgn * d.Y(), sgn * d.Z());
      d.delete();
    }

    const nbTris = tri.NbTriangles();
    let area = 0;
    for (let i = 1; i <= nbTris; i++) {
      const t = tri.Triangle(i);
      let a = t.Value(1),
        b = t.Value(2),
        c = t.Value(3);
      t.delete();
      if (reversed) [b, c] = [c, b];
      const ia = vertexOffset + a - 1;
      const ib = vertexOffset + b - 1;
      const ic = vertexOffset + c - 1;
      indices.push(ia, ib, ic);
      // approximate area from triangles
      const ax = positions[ia * 3],
        ay = positions[ia * 3 + 1],
        az = positions[ia * 3 + 2];
      const bx = positions[ib * 3],
        by = positions[ib * 3 + 1],
        bz = positions[ib * 3 + 2];
      const cx = positions[ic * 3],
        cy = positions[ic * 3 + 1],
        cz = positions[ic * 3 + 2];
      const ux = bx - ax,
        uy = by - ay,
        uz = bz - az;
      const vx = cx - ax,
        vy = cy - ay,
        vz = cz - az;
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      area += Math.hypot(nx, ny, nz) / 2;
    }

    faceInfos.push({
      name,
      start,
      count: indices.length - start,
      surface: surfaceInfo(face),
      area,
    });

    trsf.delete();
    loc.delete();
    triHandle.delete();
  }

  // --- edges ---
  const edgeNames = computeEdgeNames(body);
  const edgeInfos: EdgeInfo[] = [];
  for (const [name, edge] of edgeNames.byName) {
    const polyline = sampleEdge(edge);
    if (polyline.length < 6) continue;
    edgeInfos.push({
      name,
      polyline,
      length: lengthOf(edge),
      curve: curveInfo(edge),
    });
  }

  // --- vertices ---
  const vertexNames = computeVertexNames(body);
  const vertexInfos: VertexInfo[] = [];
  for (const [name, vertex] of vertexNames.byName) {
    const p = k.BRep_Tool.Pnt(vertex);
    vertexInfos.push({ name, position: [p.X(), p.Y(), p.Z()] });
    p.delete();
  }

  return {
    bodyId: body.bodyId,
    name: meta.name,
    visible: meta.visible,
    positions,
    normals,
    indices,
    faces: faceInfos,
    edges: edgeInfos,
    vertices: vertexInfos,
    bbox: bboxOf(body.shape),
  };
}

function surfaceInfo(face: Shape): FaceInfo["surface"] {
  const k = getKernel();
  try {
    const surf = new k.BRepAdaptor_Surface_2(face, false);
    const type = surf.GetType();
    if (type === k.GeomAbs_SurfaceType.GeomAbs_Plane) {
      const pln = surf.Plane();
      const axis = pln.Axis();
      const locP = pln.Location();
      const d = axis.Direction();
      const reversed =
        face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED;
      const sgn = reversed ? -1 : 1;
      const out: FaceInfo["surface"] = {
        type: "plane",
        origin: [locP.X(), locP.Y(), locP.Z()] as Vec3,
        normal: [sgn * d.X(), sgn * d.Y(), sgn * d.Z()] as Vec3,
      };
      surf.delete();
      return out;
    }
    if (type === k.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      const cyl = surf.Cylinder();
      const axis = cyl.Axis();
      const locP = cyl.Location();
      const d = axis.Direction();
      const out: FaceInfo["surface"] = {
        type: "cylinder",
        origin: [locP.X(), locP.Y(), locP.Z()] as Vec3,
        axis: [d.X(), d.Y(), d.Z()] as Vec3,
        radius: cyl.Radius(),
      };
      surf.delete();
      return out;
    }
    surf.delete();
  } catch {
    // fall through
  }
  return { type: "other" };
}

export function curveInfo(edge: Shape): EdgeInfo["curve"] {
  const k = getKernel();
  try {
    const curve = new k.BRepAdaptor_Curve_2(edge);
    const type = curve.GetType();
    if (type === k.GeomAbs_CurveType.GeomAbs_Line) {
      const p1 = curve.Value(curve.FirstParameter());
      const p2 = curve.Value(curve.LastParameter());
      const out: EdgeInfo["curve"] = {
        type: "line",
        a: [p1.X(), p1.Y(), p1.Z()] as Vec3,
        b: [p2.X(), p2.Y(), p2.Z()] as Vec3,
      };
      p1.delete();
      p2.delete();
      curve.delete();
      return out;
    }
    if (type === k.GeomAbs_CurveType.GeomAbs_Circle) {
      const circ = curve.Circle();
      const c = circ.Location();
      const ax = circ.Axis();
      const d = ax.Direction();
      const start = curve.Value(curve.FirstParameter());
      const end = curve.Value(curve.LastParameter());
      const out: EdgeInfo["curve"] = {
        type: "circle",
        center: [c.X(), c.Y(), c.Z()] as Vec3,
        axis: [d.X(), d.Y(), d.Z()] as Vec3,
        radius: circ.Radius(),
        start: [start.X(), start.Y(), start.Z()],
        end: [end.X(), end.Y(), end.Z()],
        sweep: curve.LastParameter() - curve.FirstParameter(),
      };
      start.delete();
      end.delete();
      curve.delete();
      return out;
    }
    curve.delete();
  } catch {
    // fall through
  }
  return { type: "other" };
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
