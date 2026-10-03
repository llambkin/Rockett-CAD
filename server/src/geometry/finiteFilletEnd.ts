import assert from "node:assert/strict";
import {
  getKernel,
  edges,
  vertices,
  pnt,
  dir,
  shapeList,
  progress,
  planarFacePlane,
  type Shape,
  type Own,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { V } from "./frames.js";
import type { Vec3 } from "@rockett/shared";
import type { GuidePatch } from "./filletEndCurves.js";
import type { FilletEnd } from "./filletBoundaries.js";
import { originalCarrierMetric } from "./originalCarrierMetric.js";
import { trimFiniteCap } from "./finiteCapTrim.js";
import { nativeBoundaryCurves } from "./nativeBoundaryCurves.js";

export type CapSegment = {
  edge: Shape;
  contact: Shape;
  neighbor: Shape;
  carrier?: Shape;
};

export function finiteFilletEnd(
  sourceFaces: Shape[],
  patch: GuidePatch,
  index: number,
  old: Shape,
  out: Vec3,
  own: Own,
): FilletEnd {
  const k = getKernel(),
    at = vertexPoint(old),
    plane = own(new k.gp_Pln_3(own(pnt(...at)), own(dir(...out)))),
    support = own(new k.BRepBuilderAPI_MakeFace_3(plane)),
    carrier = own(support.Face());
  const op = own(new k.BRepAlgoAPI_Section_3(patch.face, carrier, false));
  op.Approximation(true);
  op.ComputePCurveOn1(true);
  op.ComputePCurveOn2(true);
  op.SetNonDestructive(true);
  op.Build(progress());
  assert(op.IsDone());
  const arcs = edges(own(op.Shape())).map(own);
  assert.equal(arcs.length, 1);
  const arc = arcs[0]!,
    contacts = vertices(arc).map(own);
  assert.equal(contacts.length, 2);
  const curves = nativeBoundaryCurves(own);
  const segments = contacts.map((contact) =>
    capSegment(patch, old, arc, contact, own),
  );
  const orientation = V.dot(
    V.cross(
      V.sub(vertexPoint(contacts[0]!), at),
      V.sub(vertexPoint(contacts[1]!), at),
    ),
    out,
  );
  assert(orientation !== 0);
  const first = orientation > 0 ? 0 : 1,
    last = 1 - first;
  const boundary = [
    curves.orient(segments[first]!.edge, old),
    curves.orient(arc, contacts[first]!),
    curves.orient(segments[last]!.edge, contacts[last]!),
  ];
  const wire = own(new k.BRepBuilderAPI_MakeWire_1());
  wire.Add_3(own(shapeList(boundary)));
  assert(wire.IsDone());
  const madeWire = own(wire.Wire());
  assert.equal(edges(madeWire).map(own).length, 3);
  const face = own(k.TopoDS.Face_1(own(carrier.EmptyCopied()))),
    builder = own(new k.BRep_Builder());
  builder.Add(face, madeWire);
  builder.NaturalRestriction(face, false);
  k.BRepLib.SameParameter_3(face, k.BRep_Tool.Tolerance_1(face), true);
  const trimmed = trimFiniteCap(
    sourceFaces,
    patch,
    old,
    face,
    arc,
    segments,
    own,
  );
  const attached = sourceSegments(
    sourceFaces,
    patch,
    old,
    trimmed.segments,
    own,
  );
  return {
    index,
    old,
    boundary: trimmed.boundary,
    sourceEdits: trimmed.edits,
    termination: { face: trimmed.cap, segments: attached },
  };
}

function sourceSegments(
  sourceFaces: Shape[],
  patch: GuidePatch,
  old: Shape,
  segments: CapSegment[],
  own: Own,
) {
  const sources = sourceFaces.filter(
    (source) =>
      !patch.neighbors.some((neighbor) => neighbor.IsSame(source)) &&
      vertices(source)
        .map(own)
        .some((vertex) => vertex.IsSame(old)),
  );
  assert(sources.length > 0);
  const attached = segments.map((segment) => {
    if (!segment.carrier) return { ...segment, source: null };
    const owners = sources.filter((face) =>
      edges(face)
        .map(own)
        .some((edge) => edge.IsSame(segment.carrier)),
    );
    assert.equal(owners.length, 1);
    return { ...segment, source: owners[0]! };
  });
  return attached;
}

function capSegment(
  patch: GuidePatch,
  old: Shape,
  arc: Shape,
  contact: Shape,
  own: Own,
) {
  const k = getKernel();
  const neighbors = patch.neighbors.filter((face) => {
    const plane = planarFacePlane(face);
    assert(plane);
    return (
      Math.abs(
        V.dot(V.sub(vertexPoint(contact), plane.origin), plane.normal),
      ) <= k.BRep_Tool.Tolerance_2(arc)
    );
  });
  assert.equal(neighbors.length, 1);
  const neighbor = neighbors[0]!;
  const candidates = edges(neighbor)
    .map(own)
    .filter(
      (edge) =>
        !edge.IsSame(patch.edge) &&
        vertices(edge)
          .map(own)
          .some((vertex) => vertex.IsSame(old)) &&
        originalCarrierMetric(edge, own)(contact) <=
          k.BRep_Tool.Tolerance_2(edge) + k.BRep_Tool.Tolerance_3(contact),
    );
  assert(candidates.length <= 1);
  const original = candidates[0];
  const edge = original
    ? nativeBoundaryCurves(own).carrierEdge(original, old, contact)
    : own(own(new k.BRepBuilderAPI_MakeEdge_2(old, contact)).Edge());
  return { edge, contact, neighbor, carrier: original };
}
