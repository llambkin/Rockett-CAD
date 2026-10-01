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
import { V } from "./frames.js";
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

  const plane = planarFacePlane(face);
  assert(plane);
  const contacts = endSeams.map((end) => {
    const candidates = end.boundary
      .flatMap(({ edge }) => vertices(edge).map(own))
      .filter(
        (vertex, index, all) =>
          all.findIndex((other) => other.IsSame(vertex)) === index,
      )
      .filter(
        (v) =>
          Math.abs(V.dot(V.sub(vertexPoint(v), plane.origin), plane.normal)) <=
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
  const lines = edges(patch.face)
    .map(own)
    .filter(
      (e) =>
        own(new k.BRepAdaptor_Curve_2(e)).GetType() ===
          k.GeomAbs_CurveType.GeomAbs_Line &&
        vertices(e)
          .map(own)
          .every(
            (v) =>
              Math.abs(
                V.dot(V.sub(vertexPoint(v), plane.origin), plane.normal),
              ) <= k.BRep_Tool.Tolerance_2(e),
          ),
    );
  assert.equal(lines.length, 1);
  const start = contacts.find((c) => c.old.IsSame(beginning(patch.edge))),
    finish = contacts.find((c) => c.old.IsSame(ending(patch.edge)));
  assert(start && finish);
  const edge = carrierEdge(lines[0]!, start.new, finish.new);
  transfer(lines[0]!, edge, patch.face);
  return { face, contacts, edge, oldLine: lines[0]! };
}
