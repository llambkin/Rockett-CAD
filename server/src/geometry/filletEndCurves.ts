import { storedSurfaceCurve } from "./storedSurfaceCurve.js";
import { finiteFilletEnd } from "./finiteFilletEnd.js";
import type { Vec3 } from "@rockett/shared";
import {
  getKernel,
  edges,
  vertices,
  planarFacePlane,
  progress,
  type Shape,
  type Own,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import { moduleSphereCorner } from "./sphereFilletCorner.js";
import type { FilletEnd } from "./filletBoundaries.js";

export type GuidePatch = {
  edge: Shape;
  face: Shape;
  points: [Vec3, Vec3];
  neighbors: Shape[];
};

function section(a: Shape, b: Shape, own: Own) {
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

function endpointDomain(patch: GuidePatch, vertex: Shape, own: Own) {
  const k = getKernel(),
    location = own(new k.TopLoc_Location_1()),
    surface = own(k.BRep_Tool.Surface_1(patch.face, location));
  const domain = own(new k.BRepAdaptor_Surface_2(patch.face, true)),
    cylinder = own(domain.Cylinder()),
    axis = own(cylinder.Axis()),
    centre = own(axis.Location()),
    direction = own(axis.Direction());
  const origin: Vec3 = [centre.X(), centre.Y(), centre.Z()],
    normal: Vec3 = [direction.X(), direction.Y(), direction.Z()];
  const vOf = (point: Vec3) => V.dot(V.sub(point, origin), normal);
  const other = vertices(patch.edge)
    .map(own)
    .find((v) => !v.IsSame(vertex));
  if (!other) throw new Error("the fillet guide has no opposite endpoint");
  const selected = vOf(vertexPoint(vertex)),
    opposite = vOf(vertexPoint(other));
  const first =
    selected > opposite
      ? Math.max(domain.FirstVParameter(), opposite)
      : domain.FirstVParameter();
  const last =
    selected > opposite
      ? domain.LastVParameter()
      : Math.min(domain.LastVParameter(), opposite);
  if (!(first < last))
    throw new Error("the fillet endpoint domain has no finite span");
  const make = own(
    new k.BRepBuilderAPI_MakeFace_14(
      surface,
      domain.FirstUParameter(),
      domain.LastUParameter(),
      first,
      last,
      k.BRep_Tool.Tolerance_1(patch.face),
    ),
  );
  if (!make.IsDone())
    throw new Error("the fillet endpoint domain could not be built");
  const face = own(make.Face());
  face.Location_2(location, false);
  return face;
}

function sourceCarrier(source: Shape, patch: GuidePatch, own: Own) {
  const k = getKernel(),
    location = own(new k.TopLoc_Location_1()),
    surface = own(k.BRep_Tool.Surface_1(source, location)),
    domain = own(new k.BRepAdaptor_Surface_2(source, true));
  let make: Shape;
  if (domain.GetType() === k.GeomAbs_SurfaceType.GeomAbs_Plane) {
    make = own(
      new k.BRepBuilderAPI_MakeFace_8(surface, k.BRep_Tool.Tolerance_1(source)),
    );
  } else if (domain.GetType() === k.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
    const cylinder = own(domain.Cylinder()),
      axis = own(cylinder.Axis()),
      centre = own(axis.Location()),
      direction = own(axis.Direction());
    const origin: Vec3 = [centre.X(), centre.Y(), centre.Z()],
      normal: Vec3 = [direction.X(), direction.Y(), direction.Z()];
    const axial = vertices(patch.face)
      .map(own)
      .map(vertexPoint)
      .map((point) => V.dot(V.sub(point, origin), normal));
    make = own(
      new k.BRepBuilderAPI_MakeFace_14(
        surface,
        domain.FirstUParameter(),
        domain.LastUParameter(),
        Math.min(domain.FirstVParameter(), ...axial),
        Math.max(domain.LastVParameter(), ...axial),
        k.BRep_Tool.Tolerance_1(source),
      ),
    );
  } else return source;
  if (!make.IsDone())
    throw new Error("the fillet terminal surface could not be built");
  const face = own(make.Face());
  face.Location_2(location, false);
  return face;
}

function moduleCap(patch: GuidePatch, old: Shape, own: Own) {
  const k = getKernel(),
    domain = own(new k.BRepAdaptor_Surface_2(patch.face, true)),
    cylinder = own(domain.Cylinder()),
    axis = own(cylinder.Axis()),
    centre = own(axis.Location()),
    direction = own(axis.Direction());
  const origin: Vec3 = [centre.X(), centre.Y(), centre.Z()],
    normal: Vec3 = [direction.X(), direction.Y(), direction.Z()];
  const vOf = (point: Vec3) => V.dot(V.sub(point, origin), normal);
  const other = vertices(patch.edge)
    .map(own)
    .find((v) => !v.IsSame(old));
  if (!other) throw new Error("the fillet guide has no opposite endpoint");
  const v =
    vOf(vertexPoint(old)) < vOf(vertexPoint(other))
      ? domain.FirstVParameter()
      : domain.LastVParameter();
  const choices = edges(patch.face)
    .map(own)
    .filter((edge) => {
      const curve = own(new k.BRepAdaptor_Curve_2(edge));
      if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Circle) return false;
      const centre = own(own(curve.Circle()).Location());
      return (
        Math.abs(vOf([centre.X(), centre.Y(), centre.Z()]) - v) <=
        k.BRep_Tool.Tolerance_2(edge)
      );
    });
  if (choices.length !== 1)
    throw new Error("the fillet support has an ambiguous endpoint boundary");
  return choices[0];
}

type Incident = { patch: GuidePatch; index: number }[];
function cornerBoundary(
  sourceFaces: Shape[],
  incident: Incident,
  old: Shape,
  radius: number,
  own: Own,
) {
  const planes = sourceFaces
    .filter((face) =>
      vertices(face)
        .map(own)
        .some((vertex) => vertex.IsSame(old)),
    )
    .map((face) => ({ face, plane: planarFacePlane(face) }));
  if (planes.length !== 3 || planes.some((plane) => !plane.plane))
    throw new Error("the fillet corner has inconsistent planar incidence");
  const corner = moduleSphereCorner(
    vertexPoint(old),
    planes.map((plane) => plane.plane!.normal) as [Vec3, Vec3, Vec3],
    radius,
    incident.map(({ patch, index }) => ({
      index,
      face: patch.face,
      planes: patch.neighbors.map((face) =>
        planes.findIndex((plane) => plane.face.IsSame(face)),
      ) as [number, number],
      cap: moduleCap(patch, old, own),
    })),
    own,
  );
  return corner;
}

function terminalBoundary(
  sourceFaces: Shape[],
  patch: GuidePatch,
  index: number,
  old: Shape,
  own: Own,
) {
  const source = sourceFaces.filter(
    (face) =>
      !patch.neighbors.some((neighbor) => neighbor.IsSame(face)) &&
      vertices(face)
        .map(own)
        .some((vertex) => vertex.IsSame(old)),
  );
  const domain = endpointDomain(patch, old, own);
  if (source.length > 1)
    return compositeTerminal(source, domain, index, old, patch, own);
  const candidates = source.flatMap((face) =>
    section(domain, sourceCarrier(face, patch, own), own).map((edge) => ({
      index,
      old,
      source: face,
      edge,
    })),
  );
  if (candidates.length !== 1)
    throw new Error("the fillet terminal boundary incidence is ambiguous");
  const chosen = candidates[0]!;
  return {
    index,
    old,
    boundary: [{ edge: chosen.edge, source: chosen.source }],
  };
}

function compositeTerminal(
  source: Shape[],
  domain: Shape,
  index: number,
  old: Shape,
  patch: GuidePatch,
  own: Own,
): FilletEnd {
  const k = getKernel(),
    compound = own(new k.TopoDS_Compound()),
    builder = own(new k.BRep_Builder());
  builder.MakeCompound(compound);
  source.forEach((face) =>
    builder.Add(
      compound,
      planarFacePlane(face) ? sourceCarrier(face, patch, own) : face,
    ),
  );
  const curves = section(domain, compound, own);
  if (!curves.length)
    throw new Error("the fillet source boundary has no material-domain curves");
  const boundary = curves.map((edge) => {
    const sources = source.filter((face) => {
      const location = own(new k.TopLoc_Location_1()),
        surface = own(k.BRep_Tool.Surface_1(face, location));
      try {
        storedSurfaceCurve(edge, surface, location, own);
        return true;
      } catch {
        return false;
      }
    });
    if (sources.length !== 1)
      throw new Error(
        "the fillet boundary has missing or duplicate source ownership",
      );
    return { edge, source: sources[0]! };
  });
  return { index, old, boundary };
}

export function filletEndCurves(
  sourceFaces: Shape[],
  patches: GuidePatch[],
  radius: number,
  own: Own,
  terminations: { selection: number; endpoint: number; out: Vec3 }[] = [],
  nativeEnds: FilletEnd[] = [],
) {
  const ends: FilletEnd[] = [],
    corners: Shape[] = [],
    handled: Shape[] = [];
  patches.forEach((patch) =>
    vertices(patch.edge)
      .map(own)
      .forEach((old) => {
        if (handled.some((vertex) => vertex.IsSame(old))) return;
        handled.push(old);
        const native = nativeVertexEnds(nativeEnds, patches, old, own);
        if (native.length) {
          ends.push(...native);
          return;
        }
        const incident = patches
          .map((patch, index) => ({ patch, index }))
          .filter(({ patch }) =>
            vertices(patch.edge)
              .map(own)
              .some((vertex) => vertex.IsSame(old)),
          );
        const junction = junctionEnds(
          sourceFaces,
          incident,
          old,
          radius,
          terminations,
          own,
        );
        ends.push(...junction.ends);
        corners.push(...junction.corners);
      }),
  );
  return {
    ends,
    corners: corners.concat(
      ends.flatMap((end) => (end.termination ? [end.termination.face] : [])),
    ),
  };
}

function nativeVertexEnds(
  nativeEnds: FilletEnd[],
  patches: GuidePatch[],
  old: Shape,
  own: Own,
) {
  const native = nativeEnds.filter((end) => end.old.IsSame(old));
  if (!native.length) return native;
  const memberships = patches.flatMap((patch, index) =>
    vertices(patch.edge)
      .map(own)
      .some((vertex) => vertex.IsSame(old))
      ? [index]
      : [],
  );
  if (
    native.length !== memberships.length ||
    memberships.some(
      (index) => native.filter((end) => end.index === index).length !== 1,
    )
  )
    throw new Error(
      "the native terminal has missing or duplicate guide incidence",
    );
  return native;
}
function terminalForGuide(
  sourceFaces: Shape[],
  incident: Incident[number],
  old: Shape,
  terminations: { selection: number; endpoint: number; out: Vec3 }[],
  own: Own,
): FilletEnd {
  const { patch, index } = incident;
  const endpoints = vertices(patch.edge).map(own);
  const matches = terminations.filter(
    (end) => end.selection === index && endpoints[end.endpoint]?.IsSame(old),
  );
  if (matches.length > 1)
    throw new Error("the finite fillet endpoint is duplicated");
  return matches[0]
    ? finiteFilletEnd(sourceFaces, patch, index, old, matches[0].out, own)
    : terminalBoundary(sourceFaces, patch, index, old, own);
}
function junctionEnds(
  sourceFaces: Shape[],
  incident: Incident,
  old: Shape,
  radius: number,
  terminations: { selection: number; endpoint: number; out: Vec3 }[],
  own: Own,
): { ends: FilletEnd[]; corners: Shape[] } {
  if (incident.length === 1)
    return {
      ends: [
        terminalForGuide(sourceFaces, incident[0]!, old, terminations, own),
      ],
      corners: [],
    };
  if (incident.length === 2) {
    const [a, b] = incident as [Incident[number], Incident[number]];
    const curves = section(
      endpointDomain(a.patch, old, own),
      endpointDomain(b.patch, old, own),
      own,
    );
    if (curves.length !== 1)
      throw new Error("the connected fillet boundary incidence is ambiguous");
    return {
      ends: incident.map(({ index }) => ({
        index,
        old,
        boundary: [{ source: null, edge: curves[0]! }],
      })),
      corners: [],
    };
  }
  if (incident.length === 3) {
    const corner = cornerBoundary(sourceFaces, incident, old, radius, own);
    return {
      ends: corner.ends.map((end) => ({
        index: end.index,
        old,
        boundary: [{ source: null, edge: end.edge }],
      })),
      corners: [corner.face],
    };
  }
  throw new Error("the fillet corner has no shared boundary owner");
}
