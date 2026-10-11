/**
 * B-Rep → viewport tessellation.
 *
 * The triangle mesh is a *visualisation* of the CAD model. Every face's
 * triangles are grouped and tagged with the face's persistent name, and every
 * edge is emitted as a polyline tagged with its persistent name, so the
 * client can do CAD-topology selection (body/face/edge/vertex) on the mesh.
 */

import {
  coarseOf,
  compareNames,
  encodeMesh,
  lazyMesh,
  meshHead,
  meshPayloadOf,
  withCoarse,
  type EdgeInfo,
  type FaceInfo,
  type MeshedBody,
  type MeshPayload,
  type MeshSource,
  type RefSignature,
  type VertexInfo,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  diagonal,
  getKernel,
  lengthOf,
  scoped,
  type Shape,
} from "./kernel.js";
import { curveInfo } from "./edgeCurve.js";
import { meshDetached, meshShape, type FaceMesh } from "./mesh.js";
import { drawnTriangles } from "./meshBody.js";
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
import { sha256 } from "../store/jsonStore.js";

export interface TessellationOptions {
  /** Linear deflection in mm. */
  linear?: number;
  /** Angular deflection in radians. */
  angular?: number;
}

const COARSE = 12;
const COARSE_MIN_TRIANGLES = 1024;

type Level = Pick<MeshPayload, "positions" | "normals" | "indices" | "faces">;

function appendFaceMesh(
  body: NamedBody,
  m: FaceMesh,
  { positions, normals, indices, faces }: Level,
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

  faces.push({
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
): MeshedBody {
  const { bbox, coarse, ...mesh }: Tessellated = body.mesh
    ? drawnTriangles(body.mesh)
    : tessellateShape(body, opts);
  const binary = encodeMesh(mesh);
  const meshKey = sha256(binary);
  return lazyMesh(
    { bodyId: body.bodyId, name: meta.name, meshKey, bbox },
    withCoarse(binary, coarse && encodeMesh({ ...mesh, ...coarse })),
  );
}

type Tessellated = MeshSource & { bbox: MeshedBody["bbox"]; coarse?: Level };

function meshLevel(body: NamedBody, meshes: FaceMesh[]): Level {
  const level: Level = { positions: [], normals: [], indices: [], faces: [] };
  for (const mesh of meshes) appendFaceMesh(body, mesh, level);
  return level;
}

function tessellateShape(body: NamedBody, opts: TessellationOptions) {
  return scoped((): Tessellated => {
    const k = getKernel();
    const bbox = bboxOf(body.shape);
    const linear = opts.linear ?? viewportDeflection(bbox);
    const angular = opts.angular ?? 0.35;
    const fine = meshLevel(body, meshShape(body.shape, { linear, angular }));
    const coarse =
      fine.indices.length >= 3 * COARSE_MIN_TRIANGLES
        ? meshLevel(
            body,
            meshDetached(body.shape, {
              linear: linear * COARSE,
              angular: angular * COARSE,
            }),
          )
        : undefined;

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

    return {
      ...fine,
      edges: edgeInfos,
      vertices: vertexInfos,
      bbox,
      ...(coarse &&
        coarse.indices.length > 0 &&
        2 * coarse.indices.length <= fine.indices.length && { coarse }),
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
  source: MeshedBody,
  bodyId: string,
  {
    offset,
    prefix,
    source: from,
  }: { offset: Vec3; prefix: string; source: NamedBody },
): MeshedBody | undefined {
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
  const face = (f: FaceInfo): FaceInfo => ({
    ...f,
    name: named(f.name),
    surface:
      f.surface.type === "other"
        ? f.surface
        : { ...f.surface, origin: at(f.surface.origin) },
  });
  const moved: MeshedBody = {
    ...source,
    bodyId,
    meshKey: sha256(JSON.stringify([source.meshKey, offset, prefix])),
    positions: along(source.positions),
    faces: source.faces.map(face),
    edges: source.edges
      .map((e) => ({
        ...e,
        name: adjacent(e.name),
        polyline: along(e.polyline),
        curve: movedCurve(e.curve, at),
      }))
      .toSorted((a, b) => compareNames(a.name, b.name)),
    vertices: nameVertices(
      vertexFacesOf(from).map((v) => ({
        faces: v.faces.map(named),
        position: at(v.position),
      })),
      version,
    ).map(([v, name]) => ({ name, position: v.position })),
    bbox: { min: at(source.bbox.min), max: at(source.bbox.max) },
  };
  return withMovedCoarse(source, moved, along, face);
}

function withMovedCoarse(
  source: MeshedBody,
  moved: MeshedBody,
  along: (xs: number[]) => number[],
  face: (f: FaceInfo) => FaceInfo,
): MeshedBody {
  const coarse = coarseOf(source);
  if (!coarse) return moved;
  const level = coarseLevelOf(coarse);
  return lazyMesh(
    meshHead(moved),
    withCoarse(
      encodeMesh(moved),
      encodeMesh({
        ...moved,
        positions: along(level.positions),
        normals: level.normals,
        indices: level.indices,
        faces: level.faces.map(face),
      }),
    ),
  );
}

const coarseSources = new WeakMap<Uint8Array, MeshPayload>();

function coarseLevelOf(binary: Uint8Array): MeshPayload {
  const known = coarseSources.get(binary);
  if (known) return known;
  const level = meshPayloadOf(binary);
  coarseSources.set(binary, level);
  return level;
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

function viewportDeflection(box: ReturnType<typeof bboxOf>): number {
  return Math.min(0.5, Math.max(0.005, 0.0005 * diagonal(box)));
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
