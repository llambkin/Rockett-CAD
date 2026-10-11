import assert from "node:assert/strict";
import type { Vec3 } from "@rockett/shared";
import {
  getKernel,
  edges,
  vertices,
  planarFacePlane,
  type Shape,
  type Own,
} from "./kernel.js";
import { vertexPoint } from "./featureState.js";
import { axisAngle } from "./axisAngle.js";
import { sectionCarrier, surfaceGap } from "./blendSides.js";
import type { FilletEnd } from "./filletBoundaries.js";
import type { nativeBoundaryCurves } from "./nativeBoundaryCurves.js";
export type Patch = { edge: Shape; face: Shape; points: [Vec3, Vec3] };
type Curves = ReturnType<typeof nativeBoundaryCurves>;
export function guideGraph(
  sourceFaces: Shape[],
  patches: Patch[],
  ends: FilletEnd[],
  curves: Curves,
  own: Own,
  refuse: () => never,
) {
  return patches.map((patch, index) => {
    const guideVertices = vertices(patch.edge).map(own);
    const endSeams = guideVertices.map((vertex) => {
      const choices = ends.filter(
        (end) => end.index === index && end.old.IsSame(vertex),
      );
      assert.equal(choices.length, 1);
      const chosen = choices[0];
      assert(chosen);
      return chosen;
    });
    assert.equal(
      ends.filter((end) => end.index === index).length,
      guideVertices.length,
    );
    assert(
      endSeams[0]!.boundary.every((a) =>
        endSeams[1]!.boundary.every((b) => !a.edge.IsSame(b.edge)),
      ),
    );
    const neighbors = sourceFaces
      .filter((f) =>
        edges(f)
          .map(own)
          .some((e) => e.IsSame(patch.edge)),
      )
      .map((face) => guideNeighbor(patch, endSeams, face, curves, own, refuse));
    return { ...patch, endSeams, neighbors };
  });
}
export type Graph = ReturnType<typeof guideGraph>;

function guideNeighbor(
  patch: Patch,
  endSeams: FilletEnd[],
  face: Shape,
  curves: Curves,
  own: Own,
  refuse: () => never,
) {
  const k = getKernel();
  const { beginning, ending, carrierEdge, transfer } = curves;

  const gap = surfaceGap(face, own);
  const contacts = endSeams.map((end) => {
    const candidates = end.boundary
      .flatMap(({ edge }) => vertices(edge).map(own))
      .filter(
        (vertex, index, all) =>
          all.findIndex((other) => other.IsSame(vertex)) === index,
      )
      .filter(
        (v) =>
          gap(vertexPoint(v)) <=
          Math.max(
            ...end.boundary.map(({ edge }) => k.BRep_Tool.Tolerance_2(edge)),
          ),
      );
    if (!candidates.length) refuse();
    assert.equal(candidates.length, 1);
    const contact = candidates[0];
    assert(contact);
    return { old: end.old, new: contact };
  });
  const contactTypes = new Set([
    k.GeomAbs_CurveType.GeomAbs_Line,
    k.GeomAbs_CurveType.GeomAbs_Circle,
  ]);
  const lines = edges(patch.face)
    .map(own)
    .filter(
      (e) =>
        contactTypes.has(own(new k.BRepAdaptor_Curve_2(e)).GetType()) &&
        vertices(e)
          .map(own)
          .every((v) => gap(vertexPoint(v)) <= k.BRep_Tool.Tolerance_2(e)),
    );
  assert.equal(lines.length, 1);
  const start = contacts.find((c) => c.old.IsSame(beginning(patch.edge))),
    finish = contacts.find((c) => c.old.IsSame(ending(patch.edge)));
  assert(start && finish);
  const carrier = planarFacePlane(face)
    ? lines[0]!
    : sectionCarrier(patch.face, face, [start.new, finish.new], own);
  if (
    own(new k.BRepAdaptor_Curve_2(carrier)).GetType() !==
    own(new k.BRepAdaptor_Curve_2(lines[0]!)).GetType()
  )
    throw new Error("the fillet contact carrier is not exact");
  const edge = carrierEdge(
    carrier,
    ...inCarrierOrder(carrier, start.new, finish.new, own),
  );
  transfer(carrier, edge, patch.face);
  if (carrier !== lines[0]) transfer(carrier, edge, face);
  return { face, contacts, edge, oldLine: lines[0]! };
}

function inCarrierOrder(
  carrier: Shape,
  start: Shape,
  finish: Shape,
  own: Own,
): [Shape, Shape] {
  const k = getKernel(),
    curve = own(new k.BRepAdaptor_Curve_2(carrier));
  if (curve.GetType() !== k.GeomAbs_CurveType.GeomAbs_Circle)
    return [start, finish];
  const angle = axisAngle(
    own(own(curve.Circle()).Position()),
    [curve.FirstParameter(), curve.LastParameter()],
    own,
  );
  const reversed =
    carrier.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED;
  return angle(vertexPoint(start)) < angle(vertexPoint(finish)) === !reversed
    ? [start, finish]
    : [finish, start];
}
