import assert from "node:assert/strict";
import {
  getKernel,
  edges,
  vertices,
  progress,
  type Shape,
  type Own,
} from "./kernel.js";
import { storedSurfaceCurve } from "./storedSurfaceCurve.js";
import { nativeBoundaryCurves } from "./nativeBoundaryCurves.js";
import { originalCarrierMetric } from "./originalCarrierMetric.js";
import { planarFaceBoundary } from "./faceBoundary.js";
import type { CapSegment } from "./finiteFilletEnd.js";
import type { GuidePatch } from "./filletEndCurves.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";

function hasCurve(edge: Shape, face: Shape, own: Own) {
  const k = getKernel(),
    location = own(new k.TopLoc_Location_1());
  const surface = own(k.BRep_Tool.Surface_1(face, location));
  try {
    storedSurfaceCurve(edge, surface, location, own);
    return true;
  } catch {
    return false;
  }
}

function section(patch: GuidePatch, cap: Shape, sources: Shape[], own: Own) {
  const k = getKernel(),
    builder = own(new k.BRep_Builder());
  const tool = own(new k.TopoDS_Compound()),
    source = own(new k.TopoDS_Compound());
  builder.MakeCompound(tool);
  builder.MakeCompound(source);
  const domain = own(new k.BRepAdaptor_Surface_2(patch.face, true));
  const frame = own(own(domain.Cylinder()).Position());
  const origin = own(frame.Location()),
    direction = own(frame.Direction());
  const axial = patch.points.map((point) =>
    V.dot(V.sub(point, [origin.X(), origin.Y(), origin.Z()]), [
      direction.X(),
      direction.Y(),
      direction.Z(),
    ]),
  );
  const location = own(new k.TopLoc_Location_1()),
    raw = own(k.BRep_Tool.Surface_1(patch.face, location));
  const bounded = own(
    own(
      new k.BRepBuilderAPI_MakeFace_14(
        raw,
        domain.FirstUParameter(),
        domain.LastUParameter(),
        Math.min(...axial),
        Math.max(...axial),
        k.BRep_Tool.Tolerance_1(patch.face),
      ),
    ).Face(),
  );
  bounded.Location_2(location, false);
  builder.Add(tool, bounded);
  builder.Add(tool, cap);
  sources.forEach((face) => builder.Add(source, face));
  const query = own(new k.BRepAlgoAPI_Section_3(tool, source, false));
  query.SetNonDestructive(true);
  query.Approximation(true);
  query.ComputePCurveOn1(true);
  query.ComputePCurveOn2(true);
  query.Build(progress());
  assert(query.IsDone());
  return edges(own(query.Shape())).map(own);
}

function trimPath(
  seed: Shape,
  output: Shape[],
  source: Shape,
  patch: GuidePatch,
  own: Own,
) {
  const k = getKernel(),
    curves = nativeBoundaryCurves(own);
  const points = vertices(seed).map(own);
  const choices = output.filter(
    (edge) =>
      !edge.IsSame(seed) &&
      hasCurve(edge, source, own) &&
      hasCurve(edge, patch.face, own) &&
      vertices(edge)
        .map(own)
        .some((v) => points.some((p) => p.IsSame(v))),
  );
  assert.equal(choices.length, 1);
  const module = choices[0]!;
  const junctions = vertices(module)
    .map(own)
    .filter((v) => points.some((p) => p.IsSame(v)));
  assert.equal(junctions.length, 1);
  const junction = junctions[0]!;
  const capEnd = points.find((v) => !v.IsSame(junction))!;
  const moduleEnd = vertices(module)
    .map(own)
    .find((v) => !v.IsSame(junction))!;
  const carriers = edges(source)
    .map(own)
    .filter((old) => {
      return [capEnd, moduleEnd].every((vertex) => {
        const distance = own(
          new k.BRepExtrema_DistShapeShape_2(
            old,
            vertex,
            k.Extrema_ExtFlag.Extrema_ExtFlag_MIN,
            k.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad,
            progress(),
          ),
        );
        assert(distance.IsDone());
        return (
          distance.Value() <=
          k.BRep_Tool.Tolerance_2(old) + k.BRep_Tool.Tolerance_3(vertex)
        );
      });
    });
  assert.equal(carriers.length, 1);
  return {
    seed,
    module,
    junction,
    capEnd,
    moduleEnd,
    carrier: carriers[0]!,
    curves,
  };
}

function trimmedCircle(arc: Shape, start: Shape, finish: Shape, own: Own) {
  const native = getKernel(),
    oldCurve = own(new native.BRepAdaptor_Curve_2(arc)),
    circle = own(oldCurve.Circle()),
    frame = own(circle.Position()),
    origin = own(frame.Location()),
    x = own(frame.XDirection()),
    y = own(frame.YDirection());
  const parameter = (vertex: Shape) => {
    const offset = V.sub(vertexPoint(vertex), [
      origin.X(),
      origin.Y(),
      origin.Z(),
    ]);
    let value = Math.atan2(
      V.dot(offset, [y.X(), y.Y(), y.Z()]),
      V.dot(offset, [x.X(), x.Y(), x.Z()]),
    );
    while (value < oldCurve.FirstParameter()) value += 2 * Math.PI;
    assert(value <= oldCurve.LastParameter());
    return value;
  };
  const parameters = [parameter(start), parameter(finish)];
  const orderedVertices =
    parameters[0]! < parameters[1]! ? [start, finish] : [finish, start];
  const trimmedArc = own(
    own(
      new native.BRepBuilderAPI_MakeEdge_29(
        own(native.BRep_Tool.Curve_2(arc, 0, 0)),
        orderedVertices[0],
        orderedVertices[1],
        Math.min(...parameters),
        Math.max(...parameters),
      ),
    ).Edge(),
  );
  return trimmedArc;
}

function sourceEdits(
  sources: Shape[],
  source: Shape,
  path: ReturnType<typeof trimPath>,
  own: Own,
) {
  const { curves, carrier, capEnd, moduleEnd, seed, module, junction } = path;
  const a = vertexPoint(curves.beginning(carrier)),
    b = vertexPoint(curves.ending(carrier)),
    axis = V.sub(b, a);
  const ordered = [capEnd, moduleEnd].toSorted((x, y) =>
    V.dot(V.sub(vertexPoint(x), vertexPoint(y)), axis),
  );
  const start = ordered[0]!,
    finish = ordered[1]!;
  const middle = start.IsSame(capEnd)
    ? [curves.orient(seed, capEnd), curves.orient(module, junction)]
    : [curves.orient(module, moduleEnd), curves.orient(seed, junction)];
  const ends = [
    curves.carrierEdge(carrier, curves.beginning(carrier), start),
    curves.carrierEdge(carrier, finish, curves.ending(carrier)),
  ];
  const edits = sources
    .filter((face) =>
      edges(face)
        .map(own)
        .some((edge) => edge.IsSame(carrier)),
    )
    .map((face) => ({
      face,
      edge: carrier,
      replacement: face.IsSame(source) ? [ends[0]!, ...middle, ends[1]!] : ends,
    }));
  return edits;
}

export function trimFiniteCap(
  sources: Shape[],
  patch: GuidePatch,
  old: Shape,
  cap: Shape,
  arc: Shape,
  segments: CapSegment[],
  own: Own,
) {
  const candidates = sources.filter(
    (face) => !patch.neighbors.some((n) => n.IsSame(face)),
  );
  const output = section(patch, cap, candidates, own);
  const seeds = output.flatMap((edge) => {
    if (!hasCurve(edge, cap, own)) return [];
    const owners = candidates.filter(
      (face) =>
        hasCurve(edge, face, own) &&
        !vertices(face)
          .map(own)
          .some((v) => v.IsSame(old)),
    );
    assert(owners.length <= 1);
    return owners.length ? [{ edge, source: owners[0]! }] : [];
  });
  if (!seeds.length)
    return {
      cap,
      arc,
      segments,
      boundary: [{ edge: arc, source: null }],
      edits: [],
    };
  assert.equal(seeds.length, 1);
  const { edge: seed, source } = seeds[0]!;
  const path = trimPath(seed, output, source, patch, own);
  const { curves, junction, capEnd, module } = path;
  const changed = segments.filter(
    (segment) =>
      originalCarrierMetric(segment.edge, own)(capEnd) <=
      getKernel().BRep_Tool.Tolerance_2(segment.edge) +
        getKernel().BRep_Tool.Tolerance_3(capEnd),
  );
  assert.equal(changed.length, 1);
  const segment = changed[0]!;
  const unchanged = segments.find((part) => part !== segment)!;
  const trimmedArc = trimmedCircle(arc, unchanged.contact, junction, own);
  curves.transfer(arc, trimmedArc, patch.face);
  curves.transfer(arc, trimmedArc, cap);
  const trimmedSegment = curves.carrierEdge(segment.edge, old, capEnd);
  const capFace = planarFaceBoundary(
    cap,
    [
      {
        edge: arc,
        replacement: [
          curves.orient(trimmedArc, unchanged.contact),
          curves.orient(seed, junction),
        ],
      },
      { edge: segment.edge, replacement: [trimmedSegment] },
    ],
    own,
  );
  const edits = sourceEdits(sources, source, path, own);
  return {
    cap: capFace,
    arc: trimmedArc,
    segments: segments.map((part) =>
      part === segment
        ? { ...part, edge: trimmedSegment, contact: capEnd }
        : part,
    ),
    boundary: [
      { edge: trimmedArc, source: null },
      { edge: module, source: null },
    ],
    edits,
  };
}
