import { storedSurfaceCurve } from "./storedSurfaceCurve.js";
import { finiteFilletEnd } from "./finiteFilletEnd.js";
import { UNIT_DOT_TOL, type Vec3 } from "@rockett/shared";
import {
  getKernel,
  dir,
  edges,
  vertices,
  planarFacePlane,
  pnt,
  type Shape,
  type Own,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import {
  cylinderOf,
  section,
  sectionCarrier,
  surfaceGap,
} from "./blendSides.js";
import { nativeBoundaryCurves } from "./nativeBoundaryCurves.js";
import { originalCarrierMetric } from "./originalCarrierMetric.js";
import { axisAngle } from "./axisAngle.js";
import { moduleSphereCorner } from "./sphereFilletCorner.js";
import type { FilletEnd } from "./filletBoundaries.js";

export type GuidePatch = {
  edge: Shape;
  face: Shape;
  points: [Vec3, Vec3];
  neighbors: Shape[];
};

function planeStrip(domain: any) {
  return domain.GetType() === getKernel().GeomAbs_SurfaceType.GeomAbs_Plane;
}

function stripRun(domain: any, own: Own) {
  const k = getKernel(),
    type = domain.GetType(),
    torus = type === k.GeomAbs_SurfaceType.GeomAbs_Torus,
    plane = planeStrip(domain),
    cone = type === k.GeomAbs_SurfaceType.GeomAbs_Cone,
    prism = type === k.GeomAbs_SurfaceType.GeomAbs_SurfaceOfExtrusion,
    named = torus ? "Torus" : plane ? "Plane" : cone ? "Cone" : "Cylinder",
    surface = prism ? null : own(domain[named]()),
    position = own(
      surface
        ? surface.Position()
        : new k.gp_Ax3_5(own(domain.Value(0, 0)), own(domain.Direction())),
    ),
    slant = cone ? Math.cos(surface.SemiAngle()) : 1;
  const [u, v] = [
    [domain.FirstUParameter(), domain.LastUParameter()],
    [domain.FirstVParameter(), domain.LastVParameter()],
  ] as [[number, number], [number, number]];
  if (torus)
    return {
      at: axisAngle(position, u, own),
      span: u,
      bound: (selected: number, opposite: number) => (selected + opposite) / 2,
      rect: (first: number, last: number) => [first, last, ...v] as const,
    };
  const origin = own(position.Location()),
    along = own(plane ? position.YDirection() : position.Direction());
  return {
    at: (point: Vec3) =>
      V.dot(V.sub(point, [origin.X(), origin.Y(), origin.Z()]), [
        along.X(),
        along.Y(),
        along.Z(),
      ]) / slant,
    span: v,
    bound: (selected: number, opposite: number) =>
      !cone ? opposite : selected > opposite ? v[0] : v[1],
    rect: (first: number, last: number) => [...u, first, last] as const,
  };
}

function endpointDomain(patch: GuidePatch, vertex: Shape, own: Own) {
  const k = getKernel(),
    location = own(new k.TopLoc_Location_1()),
    surface = own(k.BRep_Tool.Surface_1(patch.face, location));
  const run = stripRun(own(new k.BRepAdaptor_Surface_2(patch.face, true)), own);
  const other = vertices(patch.edge)
    .map(own)
    .find((v) => !v.IsSame(vertex));
  if (!other) throw new Error("the fillet guide has no opposite endpoint");
  const selected = run.at(vertexPoint(vertex)),
    opposite = run.at(vertexPoint(other)),
    bound = run.bound(selected, opposite);
  const [first, last] =
    selected > opposite
      ? [Math.max(run.span[0], bound), run.span[1]]
      : [run.span[0], Math.min(run.span[1], bound)];
  if (!(first < last))
    throw new Error("the fillet endpoint domain has no finite span");
  const make = own(
    new k.BRepBuilderAPI_MakeFace_14(
      surface,
      ...run.rect(first, last),
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
    const { origin, axis } = cylinderOf(source, own)!;
    const axial = vertices(patch.face)
      .map(own)
      .map(vertexPoint)
      .map((point) => V.dot(V.sub(point, origin), axis));
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
    cylinder = cylinderOf(patch.face, own);
  if (!cylinder) throw new Error("the fillet corner support is not a cylinder");
  const vOf = (point: Vec3) =>
    V.dot(V.sub(point, cylinder.origin), cylinder.axis);
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
          .map((candidate, index) => ({ patch: candidate, index }))
          .filter((entry) =>
            vertices(entry.patch.edge)
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
    : grownTerminal(
        terminalBoundary(sourceFaces, patch, index, old, own),
        patch,
        own,
      );
}

function grownTerminal(end: FilletEnd, patch: GuidePatch, own: Own) {
  const k = getKernel(),
    curves = nativeBoundaryCurves(own);
  const growth = patch.neighbors
    .filter((neighbor) => !planarFacePlane(neighbor))
    .flatMap((neighbor) => {
      const gap = surfaceGap(neighbor, own);
      const touching = end.boundary.flatMap(({ edge, source }) =>
        vertices(edge)
          .map(own)
          .filter(
            (vertex) =>
              gap(vertexPoint(vertex)) <= k.BRep_Tool.Tolerance_2(edge),
          )
          .map((contact) => ({ contact, source })),
      );
      const { contact, source } = touching[0] ?? {};
      if (touching.length !== 1 || !contact || !source)
        throw new Error("the chamfer end has no single curved contact");
      const carried = edges(neighbor)
        .map(own)
        .some(
          (edge) =>
            !edge.IsSame(patch.edge) &&
            vertices(edge)
              .map(own)
              .some((vertex) => vertex.IsSame(end.old)) &&
            originalCarrierMetric(edge, own)(contact) <=
              k.BRep_Tool.Tolerance_2(edge) + k.BRep_Tool.Tolerance_3(contact),
        );
      if (carried) return [];
      const arc = sectionCarrier(
        neighbor,
        sourceCarrier(source, patch, own),
        [end.old, contact],
        own,
      );
      const edge = curves.carrierEdge(arc, end.old, contact);
      curves.transfer(arc, edge, neighbor);
      return [{ edge, source, neighbor }];
    });
  return growth.length ? { ...end, growth } : end;
}
function guideAxis(patch: GuidePatch) {
  return V.normalize(V.sub(patch.points[1], patch.points[0]));
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
    const k = getKernel();
    const collinear =
      (planeStrip(own(new k.BRepAdaptor_Surface_2(a.patch.face, true))) ||
        own(k.BRep_Tool.Surface_2(a.patch.face))
          .get()
          .isAliasOf(own(k.BRep_Tool.Surface_2(b.patch.face)).get())) &&
      1 - Math.abs(V.dot(guideAxis(a.patch), guideAxis(b.patch))) <=
        UNIT_DOT_TOL;
    const across = () =>
      own(
        own(
          new k.BRepBuilderAPI_MakeFace_3(
            own(
              new k.gp_Pln_3(
                own(pnt(...vertexPoint(old))),
                own(dir(...guideAxis(a.patch))),
              ),
            ),
          ),
        ).Face(),
      );
    const curves = section(
      endpointDomain(a.patch, old, own),
      collinear ? across() : endpointDomain(b.patch, old, own),
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
