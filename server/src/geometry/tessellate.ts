/**
 * B-Rep → viewport tessellation.
 *
 * The triangle mesh is a *visualisation* of the CAD model. Every face's
 * triangles are grouped and tagged with the face's persistent name, and every
 * edge is emitted as a polyline tagged with its persistent name, so the
 * client can do CAD-topology selection (body/face/edge/vertex) on the mesh.
 */

import { createHash } from "node:crypto";
import {
  compareNames,
  type BodyPayload,
  type EdgeInfo,
  type FaceInfo,
  type RefSignature,
  type VertexInfo,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  getKernel,
  lengthOf,
  scoped,
  type Shape,
} from "./kernel.js";
import { meshShape, type FaceMesh } from "./mesh.js";
import {
  computeEdgeNames,
  computeVertexNames,
  edgeName,
  instanceName,
  nameVertices,
  vertexFaces,
  type NamedBody,
  type VertexFaces,
} from "./naming.js";

export interface TessellationOptions {
  /** Linear deflection in mm. */
  linear?: number;
  /** Angular deflection in radians. */
  angular?: number;
}

function appendFaceMesh(
  body: NamedBody,
  m: FaceMesh,
  positions: number[],
  normals: number[],
  indices: number[],
  faceInfos: FaceInfo[],
): void {
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
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }

  faceInfos.push({
    name: body.names.get(m.face) ?? "?",
    start,
    count: indices.length - start,
    surface: surfaceInfo(m.face),
    area,
  });
}

export function tessellateBody(
  body: NamedBody,
  meta: { name: string },
  opts: TessellationOptions = {},
): BodyPayload {
  return scoped(() => {
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

    for (const mesh of meshes)
      appendFaceMesh(body, mesh, positions, normals, indices, faceInfos);

    const edgeNames = computeEdgeNames(body).byName;
    const edgeInfos: EdgeInfo[] = [];

    for (const [name, edge] of edgeNames) {
      const polyline = Array.from<number>(k.sampleEdge(edge));
      if (polyline.length < 6) continue;
      edgeInfos.push({
        name,
        polyline,
        length: lengthOf(edge),
        curve: curveInfo(edge),
      });
    }

    const vertexNames = computeVertexNames(body).byName;
    const vertexInfos: VertexInfo[] = [];

    for (const [name, vertex] of vertexNames) {
      const p = acquire(k.BRep_Tool.Pnt(vertex));
      vertexInfos.push({ name, position: [p.X(), p.Y(), p.Z()] });
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
      meshKey: createHash("sha256").update(JSON.stringify(mesh)).digest("hex"),
      ...mesh,
    };
  });
}

const sourceVertices = new WeakMap<NamedBody, VertexFaces[]>();

function vertexFacesOf(body: NamedBody): VertexFaces[] {
  const known = sourceVertices.get(body);
  if (known) return known;
  return scoped(() => {
    const entries = vertexFaces(body);
    const found = entries.map(({ faces, position }) => ({ faces, position }));
    sourceVertices.set(body, found);
    return found;
  });
}

export function movePayload(
  source: BodyPayload,
  bodyId: string,
  {
    offset,
    prefix,
    source: from,
  }: { offset: Vec3; prefix: string; source: NamedBody },
): BodyPayload | undefined {
  const faceNames = source.faces.map((f) => f.name);
  if (
    new Set(faceNames).size < faceNames.length ||
    faceNames.some((n) => n === "?" || n === "seam" || /[|[\]]/.test(n))
  )
    return undefined;
  const at = (p: Vec3): Vec3 => [
    p[0] + offset[0],
    p[1] + offset[1],
    p[2] + offset[2],
  ];
  const along = (xs: number[]) => xs.map((x, i) => x + offset[i % 3]!);
  const version = from.names.version;
  const renamed = new Map(
    faceNames.map((n) => [n, instanceName(prefix, n, version)]),
  );
  const named = (n: string) =>
    renamed.get(n) ?? instanceName(prefix, n, version);
  const adjacent = (n: string) =>
    n.replace(/^e\[(.*)\]/, (_, inner: string) =>
      edgeName(
        inner
          .split("|")
          .filter((f) => f !== "seam")
          .map(named),
      ),
    );
  return {
    ...source,
    bodyId,
    meshKey: createHash("sha256")
      .update(JSON.stringify([source.meshKey, offset, prefix]))
      .digest("hex"),
    positions: along(source.positions),
    faces: source.faces.map((f) => ({
      ...f,
      name: named(f.name),
      surface:
        f.surface.type === "other"
          ? f.surface
          : { ...f.surface, origin: at(f.surface.origin) },
    })),
    edges: source.edges
      .map((e) => ({
        ...e,
        name: adjacent(e.name),
        polyline: along(e.polyline),
        curve: movedCurve(e.curve, at),
      }))
      .sort((a, b) => compareNames(a.name, b.name)),
    vertices: nameVertices(
      vertexFacesOf(from).map((v) => ({
        faces: v.faces.map(named),
        position: at(v.position),
      })),
      version,
    ).map(([v, name]) => ({ name, position: v.position })),
    bbox: { min: at(source.bbox.min), max: at(source.bbox.max) },
  };
}

function movedCurve(
  curve: EdgeInfo["curve"],
  at: (p: Vec3) => Vec3,
): EdgeInfo["curve"] {
  if (curve.type === "line")
    return { ...curve, a: at(curve.a), b: at(curve.b) };
  if (curve.type === "other") return curve;
  return {
    ...curve,
    center: at(curve.center),
    ...(curve.start && { start: at(curve.start) }),
    ...(curve.end && { end: at(curve.end) }),
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

const SURFACE_TYPES = [
  ["GeomAbs_Plane", "plane"],
  ["GeomAbs_Cylinder", "cylinder"],
  ["GeomAbs_Cone", "cone"],
  ["GeomAbs_Sphere", "sphere"],
  ["GeomAbs_Torus", "torus"],
  ["GeomAbs_BSplineSurface", "bspline"],
] as const;

export function surfaceType(surf: any): RefSignature["type"] {
  const types = getKernel().GeomAbs_SurfaceType;
  const type = surf.GetType();
  return SURFACE_TYPES.find(([name]) => types[name] === type)?.[1] ?? "other";
}

function surfaceInfo(face: Shape): FaceInfo["surface"] {
  const k = getKernel();
  try {
    return scoped((own): FaceInfo["surface"] => {
      const surf = own(new k.BRepAdaptor_Surface_2(face, false));
      const type = surfaceType(surf);
      if (type === "plane") {
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
      if (type === "cylinder") {
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
